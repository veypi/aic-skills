/*
 * engine.js — headless timeline video engine for the `video/1` document format.
 * ES module, zero dependencies. NO toolbar, NO injected CSS, NOTHING on window.
 *
 *   import {Video} from './engine.js'
 *   const v = new Video()
 *   v.assets['image/logo.png'] = 'data:image/png;base64,...'   // host fills data URLs
 *   v.load(doc)
 *   const node = v.buildFrame(frameNumber)                     // detached DOM (scaled by host)
 *   v.on('statechange', ...)
 *
 * The engine is TIME-DRIVEN: buildFrame(frame) is deterministic — the same
 * frame number always produces the same DOM, so preview (rAF) and export
 * (per-frame encode) share one render path.
 *
 * Timeline model (Remotion-style frame semantics):
 *   doc.fps, each scene has duration (seconds) → durationInFrames,
 *   totalFrames = Σ scene frames; frame → (sceneIndex, localT seconds).
 *
 * Animation vocabulary per element:
 *   fx.enter  {type, enterDur, delay}        entrance (fade/up/down/slide/zoom)
 *   fx.exit   {type, exitDur}                exit before scene end
 *   fx.countUp                               numbers roll from 0
 *   keyframes [{t, x?, y?, scale?, rotation?, opacity?}]  scene-local seconds
 * Scene transition: `transition` + `transitionIn` (seconds) — the outgoing
 * scene's background crossfades while the incoming scene's content animates in.
 */

export const VERSION = "1.0.0";
export const FORMAT = "video/1";

/* ---------------------------------------------------------------- utils */

let uidCounter = 0;
export function uid() {
  return (
    "e" +
    Date.now().toString(36) +
    (uidCounter++).toString(36) +
    Math.floor(Math.random() * 1e6).toString(36)
  );
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function fmtNum(v) {
  const r = Math.round(v * 10) / 10;
  return Math.abs(r) >= 1000 ? String(Math.round(r)) : String(r);
}

/** Sanitize rich-text HTML: keep a small inline whitelist, drop every
 *  attribute except a filtered style (no scripts, handlers, or links). */
const INLINE_TAGS = {
  B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, BR: 1, SPAN: 1,
  DIV: 1, P: 1, CODE: 1, SMALL: 1, SUB: 1, SUP: 1,
};
const STYLE_OK = {
  color: 1, "background-color": 1, "font-weight": 1, "font-style": 1,
  "text-decoration": 1, "text-decoration-line": 1, "font-size": 1,
  "text-align": 1, "letter-spacing": 1, "line-height": 1, "text-shadow": 1,
};
function cleanNode(root) {
  let n = root.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (n.nodeType === 1) {
      if (!INLINE_TAGS[n.tagName]) {
        cleanNode(n);
        while (n.firstChild) root.insertBefore(n.firstChild, n);
        root.removeChild(n);
      } else {
        const style = n.getAttribute("style") || "";
        while (n.attributes.length) n.removeAttribute(n.attributes[0].name);
        if (n.tagName === "SPAN" && style) {
          const kept = style
            .split(";")
            .map((d) => {
              const p = d.split(":");
              return p.length === 2 && STYLE_OK[p[0].trim().toLowerCase()]
                ? d.trim() : "";
            })
            .filter(Boolean)
            .join(";");
          if (kept) n.setAttribute("style", kept);
        }
        cleanNode(n);
      }
    } else if (n.nodeType !== 3) {
      root.removeChild(n);
    }
    n = next;
  }
}
export function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "");
  cleanNode(tpl.content);
  return tpl.innerHTML;
}

/* ------------------------------------------------------------ colors */

function toHex(c) {
  if (!c) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) {
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((v) => (+v).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return null;
}
function colorParts(c) {
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/.exec(
    String(c || "").trim(),
  );
  if (m) return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : 1];
  const h = toHex(c);
  if (h) {
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
      1,
    ];
  }
  return [0, 0, 0, 1];
}
function rgbaStr(c) {
  return (
    "rgba(" +
    Math.round(c[0]) +
    "," +
    Math.round(c[1]) +
    "," +
    Math.round(c[2]) +
    "," +
    (c[3] == null ? 1 : c[3]) +
    ")"
  );
}
function lerpColor(a, b, p) {
  const A = colorParts(a),
    B = colorParts(b);
  return rgbaStr(A.map((v, i) => v + (B[i] - v) * p));
}
function sampleGradient(stops, t) {
  if (!stops || !stops.length) return "rgba(0,0,0,0)";
  if (stops.length === 1) return stops[0].color;
  let a = stops[0],
    b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    const s = stops[i],
      e = stops[i + 1];
    if (t >= s.pos && t <= e.pos) {
      a = s;
      b = e;
      break;
    }
  }
  const span = (b.pos || 1) - (a.pos || 0) || 1;
  return lerpColor(a.color, b.color, clamp((t - (a.pos || 0)) / span, 0, 1));
}

/* ------------------------------------------------- easing & interpolate */

export const easing = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  circIn: (t) => 1 - Math.sqrt(1 - t * t),
  circOut: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  backOut: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  backIn: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  spring: null, // 占位：由下方 springPhysics 默认值填充
};

/** 真实弹簧物理（移植 remotion core spring 的闭式解，从静止开始求 t 秒位置）：
 *  欠阻尼：1 - e^(-ζω₀t)·(sin(ω₁t)·ζω₀/ω₁ + cos(ω₁t))；临界/过阻尼用指数近似。
 *  返回 0→1 的进度（可能过冲 >1 或回摆 <1，调用方不得 clamp）。 */
export function springPhysics(damping = 10, stiffness = 100, mass = 1) {
  const c = Math.max(0.01, +damping || 10),
    k = Math.max(1, +stiffness || 100),
    m = Math.max(0.01, +mass || 1);
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  return (t) => {
    t = clamp(t, 0, 1);
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const time = t * 2.2; // 归一化：t=1 时基本稳定（2.2s 物理时长）
    if (zeta < 1) {
      const env = Math.exp(-zeta * omega0 * time);
      return (
        1 -
        env *
          (Math.sin(omega1 * time) * ((zeta * omega0) / omega1) +
            Math.cos(omega1 * time))
      );
    }
    const env = Math.exp(-omega0 * time);
    return 1 - env * (1 + omega0 * time);
  };
}
easing.spring = springPhysics(10, 100, 1);

/** CSS cubic-bezier 缓动求解（Newton-Raphson + 二分回退）。 */
export function bezierEasing(x1, y1, x2, y2) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx,
    cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0,
      hi = 1;
    t = x;
    while (hi - lo > 1e-6) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveX(clamp(x, 0, 1)));
  };
}

/** easing 名称解析：支持参数化 "spring(damping,stiffness,mass)" 与
 *  "bezier(x1,y1,x2,y2)"（如 Showreel 的 bezier(0.16,1,0.3,1)）。 */
export function easingOf(name) {
  if (typeof name === "function") return name;
  const s = String(name || "").trim();
  let m = s.match(/^spring\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return springPhysics(p[0], p[1], p[2]);
  }
  m = s.match(/^(?:cubic-)?bezier\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return bezierEasing(p[0], p[1], p[2], p[3]);
  }
  return easing[s] || easing.easeInOut;
}

/**
 * Remotion-style interpolate: map `input` from [inMin,inMax] to [outMin,outMax],
 * with optional easing and extrapolation (default: extend).
 */
export function interpolate(input, inputRange, outputRange, opts = {}) {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;
  const range = inMax - inMin || 1;
  let t = (input - inMin) / range;
  if (t < 0 || t > 1) {
    const mode = t < 0 ? opts.extrapolateLeft : opts.extrapolateRight;
    if (mode === "clamp") t = clamp(t, 0, 1);
    else if (mode === "identity") return t < 0 ? outMin + t * range * 0 : input;
    // "extend" (default): keep raw t
  }
  const fn = opts.easing ? (typeof opts.easing === "function" ? opts.easing : easingOf(opts.easing)) : easing.linear;
  const e = fn(clamp(t, 0, 1));
  return outMin + (outMax - outMin) * e;
}

/* ------------------------------------------------------ doc: defaults */

const DEFAULT_PALETTE = [
  "#3a6ff7", "#f0773a", "#3abf7c", "#b04ad9", "#d9a53a", "#3ab0c9",
];
export function defaultTheme() {
  return {
    background: "#0f1420",
    color: "#f5f7fa",
    accent: "#3a6ff7",
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    chartPalette: DEFAULT_PALETTE.slice(),
    captionStyle: {
      fontSize: 40,
      color: "#ffffff",
      stroke: "#000000",
      strokeWidth: 4,
      background: "rgba(0,0,0,0.45)",
      radius: 10,
      paddingX: 18,
      paddingY: 8,
      bottom: 64,
    },
  };
}
export function starterDoc() {
  const theme = defaultTheme();
  return {
    format: FORMAT,
    version: 1,
    title: "Untitled Video",
    size: { width: 1280, height: 720 },
    fps: 30,
    theme,
    scenes: [
      {
        id: "s1",
        duration: 4,
        transition: "fade",
        transitionIn: 0.6,
        elements: [
          {
            id: "t1",
            type: "text",
            x: 80, y: 200, w: 1120, h: 160,
            html: "你的第一个视频",
            fontSize: 72, fontWeight: 700, color: "#ffffff",
            align: "center", valign: "middle",
            fx: { enter: "fade-up", enterDur: 0.8, delay: 0.3 },
          },
        ],
      },
      {
        id: "s2",
        duration: 4,
        transition: "fade",
        transitionIn: 0.6,
        elements: [
          {
            id: "t2",
            type: "text",
            x: 80, y: 200, w: 1120, h: 160,
            html: "由 video_studio 制作",
            fontSize: 56, fontWeight: 600, color: "#9fb4ff",
            align: "center", valign: "middle",
            fx: { enter: "fade-up", enterDur: 0.8, delay: 0.3 },
          },
        ],
      },
    ],
  };
}

/* ----------------------------------------------------- doc: normalize */

/** Fill defaults, index scenes, collect assets. Mutates nothing (returns new doc). */
export function normalizeDoc(input) {
  const doc = deepClone(input || {});
  doc.format = doc.format || FORMAT;
  doc.version = doc.version || 1;
  doc.title = doc.title || "Untitled Video";
  doc.fps = Math.max(1, Math.round(doc.fps || 30));
  doc.size = Object.assign({ width: 1280, height: 720 }, doc.size || {});
  doc.size.width = Math.max(240, Math.min(4096, doc.size.width | 0));
  doc.size.height = Math.max(240, Math.min(4096, doc.size.height | 0));
  doc.theme = Object.assign(defaultTheme(), doc.theme || {});
  doc.theme.captionStyle = Object.assign(
    defaultTheme().captionStyle,
    doc.theme.captionStyle || {},
  );
  doc.scenes = (doc.scenes || []).map((s) => normalizeScene(s, doc));
  // 全局覆盖层（HUD）：元素以全片时间为基准，渲染于所有场景内容之上
  doc.overlay = (doc.overlay || []).map((el, i) => normalizeEl(el, i));
  // asset index (relative paths referenced anywhere)
  const assets = new Set();
  const scanEl = (el) => {
    if (el.src && !/^(data:|https?:|blob:)/i.test(el.src)) assets.add(el.src);
    if (el.poster && !/^(data:|https?:|blob:)/i.test(el.poster)) assets.add(el.poster);
    // three 元素内 geo 对象的网格数据文件（assets/xxx.geo.json）
    if (el.type === "three" && el.scene && Array.isArray(el.scene.objects)) {
      el.scene.objects.forEach((o) => {
        if (o && o.type === "geo" && o.src && !/^(data:|https?:|blob:)/i.test(o.src)) assets.add(o.src);
      });
    }
  };
  doc.scenes.forEach((s) => s.elements.forEach(scanEl));
  doc.overlay.forEach(scanEl);
  ["music", "voice"].forEach((k) => {
    const a = doc[k];
    if (a && a.src && !/^(data:|https?:|blob:)/i.test(a.src)) assets.add(a.src);
  });
  doc._assets = [...assets];
  // frame index
  const ranges = [];
  let acc = 0;
  doc.scenes.forEach((s) => {
    const frames = Math.max(1, Math.round(s.duration * doc.fps));
    s._frames = frames;
    s._start = acc;
    acc += frames;
  });
  doc.totalFrames = acc;
  doc._ranges = ranges; // unused placeholder, kept for symmetry
  return doc;
}
function normalizeEl(el, i) {
  el = deepClone(el || {});
  el.id = el.id || uid();
  el.x = +el.x || 0;
  el.y = +el.y || 0;
  el.w = +el.w || 100;
  el.h = +el.h || 60;
  if (el.rotation == null) el.rotation = 0;
  if (el.opacity == null) el.opacity = 1;
  el.z = el.z != null ? +el.z : i; // explicit z or document order
  // 时间窗（全类型，Remotion Sequence 语义）：start=容器内开始秒；
  // dur=窗口时长（0/缺省=到容器尾）；hidden=隐藏不渲染（时间轴眼睛开关）
  if (el.start == null) el.start = 0;
  if (el.dur == null) el.dur = 0;
  if (el.type === "media") {
    // 源裁剪字段：trimStart/trimEnd=源入/出点（trimEnd<0=源全长）
    if (el.trimStart == null) el.trimStart = 0;
    if (el.trimEnd == null || el.trimEnd < 0) el.trimEnd = -1;
  }
  if (el.fx) {
    if (el.fx.enterDur == null) el.fx.enterDur = 0.6;
    if (el.fx.delay == null) el.fx.delay = 0;
    if (el.fx.exitDur == null) el.fx.exitDur = 0.5;
  }
  return el;
}

/** 元素在容器（场景/全片）内的时间窗时长：dur>0 取 dur（不越容器），否则到容器尾 */
export function elDurOf(el, containerDur) {
  const start = Math.max(0, +el.start || 0);
  const rest = Math.max(0, containerDur - start);
  return el.dur > 0 ? Math.min(+el.dur, rest) : rest;
}

/** media 元素窗口内时间 lt（秒）对应的源时间：超 trimEnd 冻结在末帧；
 *  loop 时在 [trimStart, trimEnd) 区间内取模循环（trimEnd=-1 需运行时按源时长修正）。 */
export function mediaTimeLt(el, lt) {
  const ts = +el.trimStart || 0;
  const te = el.trimEnd >= 0 ? +el.trimEnd : Infinity;
  const t = Math.max(0, lt);
  if (el.loop && te !== Infinity) {
    const len = te - ts;
    if (len > 0) return ts + (((t % len) + len) % len);
  }
  return Math.min(te, ts + t);
}

/** media 元素在场景时间 t（秒）对应的源时间：start 后进入播放窗口，超窗冻结在 trimEnd */
export function mediaTimeAt(el, t) {
  return mediaTimeLt(el, Math.max(0, t - (+el.start || 0)));
}
function normalizeScene(s, doc) {
  s = deepClone(s || {});
  s.id = s.id || uid();
  s.duration = Math.max(0.1, +s.duration || 1);
  s.transition = s.transition || "fade";
  s.transitionIn = s.transitionIn != null ? Math.max(0, +s.transitionIn) : 0.6;
  s.background = s.background || doc.theme.background;
  s.elements = (s.elements || []).map((el, i) => normalizeEl(el, i));
  return s;
}

/* -------------------------------------------------- media 元素池（预览/导出共用） */

// el.id → { video, url }：同一媒体元素的 <video> 跨帧复用——
// 帧渲染每帧重建 DOM，新建 video 每次都要重新加载/解码（黑闪+卡顿，大体积
// dataURL 下基本不可用）；池化后元素持续存活，seek 即显，导出逐帧 seek 也快。
const mediaPool = new Map();

/** 清理不在当前文档中的池条目（engine.load 时调用；id 经 normalizeDoc 深拷贝保持不变） */
function pruneMediaPool(doc) {
  const ids = new Set();
  const scan = (els) =>
    (els || []).forEach((el) => {
      if (el.type === "media") ids.add(el.id);
    });
  ((doc && doc.scenes) || []).forEach((s) => scan(s.elements));
  scan(doc && doc.overlay);
  for (const [id, o] of mediaPool) {
    if (!ids.has(id)) {
      try { o.video.pause(); } catch (e) {}
      o.video.removeAttribute("src");
      mediaPool.delete(id);
    }
  }
}

/** 取元素池化的 video 节点（解析后 URL 变化时重建）；无有效源返回 null */
function mediaVideoFor(el, assetMap) {
  const url = el.src ? resolveAssetUrl(el.src, assetMap) : "";
  if (!url) return null;
  let o = mediaPool.get(el.id);
  if (o && o.url !== url) {
    try { o.video.pause(); } catch (e) {}
    mediaPool.delete(el.id);
    o = null;
  }
  if (!o) {
    const v = document.createElement("video");
    v.src = url;
    v.preload = "auto";
    v.muted = true; // 帧定位渲染恒静音（声音走 stage overlay / 导出混音）
    v.playsInline = true;
    v.style.cssText = "width:100%;height:100%;display:block;";
    v.addEventListener("seeked", () => { v._vdDirty = false; });
    // 持久 loadedmetadata 监听：加载完成时 seek 到最新目标 _vdT。
    // （不能用每次 buildFrame 注册 once 监听——多次注册在加载完成时全部触发，
    //   各 seek 各的目标，最终帧错乱/竞态）
    v.addEventListener("loadedmetadata", () => {
      if (v._vdT != null && Math.abs((v.currentTime || 0) - v._vdT) > 0.001) {
        v._vdDirty = true;
        v.currentTime = v._vdT;
      }
    });
    o = { video: v, url };
    mediaPool.set(el.id, o);
  }
  return o.video;
}

/** 导出前调用：预热 doc 中所有 media video 的池元素（首帧不必等元数据加载） */
export function prepareMedia(doc, assetMap) {
  const warm = (els) =>
    (els || []).forEach((el) => {
      if (el.type === "media" && el.kind !== "audio" && el.src) mediaVideoFor(el, assetMap);
    });
  (doc.scenes || []).forEach((s) => warm(s.elements));
  warm(doc.overlay);
}

/** 等待节点内 video 元素完成帧定位（_vdDirty 在 seeked 时清除）。
 *  注意不能用 currentTime≈_vdT 判断：Chrome 设置 currentTime 后属性立即反映目标值，
 *  但画面要等 seeked 才更新——提前 drawImage 会抓到上一帧。
 *  就绪条件 = readyState>=2（有帧数据）且无未完成 seek。首次创建且目标时间=0 时
 *  不触发 seek（currentTime 已在 0），seeked 永远不会来——必须等 loadeddata 而非死等 seeked。 */
export function waitMediaSeek(node, timeout = 800) {
  const vs = node ? Array.from(node.querySelectorAll("video")) : [];
  if (!vs.length) return Promise.resolve();
  return Promise.all(
    vs.map((v) => {
      if (v._vdT == null) return Promise.resolve();
      if (v.readyState >= 2 && !v._vdDirty) return Promise.resolve();
      return new Promise((res) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          v.removeEventListener("seeked", finish);
          v.removeEventListener("loadeddata", finish);
          v.removeEventListener("error", finish);
          res();
        };
        v.addEventListener("seeked", finish);
        v.addEventListener("loadeddata", finish);
        v.addEventListener("error", finish);
        setTimeout(finish, timeout);
      });
    }),
  );
}

/** 等待所有池化 media video 就绪（有首帧可画）。导出/截图前调用：
 *  窗口外元素从不渲染 → 池 video 首次在切换帧才创建，data URL 加载未完成时
 *  drawImage 黑帧（导出视频里表现为「切换帧闪烁」）。 */
export function waitMediaReady(timeout = 8000) {
  const vs = [...mediaPool.values()]
    .map((o) => o.video)
    .filter((v) => v && v.readyState < 2);
  if (!vs.length) return Promise.resolve();
  return Promise.all(
    vs.map(
      (v) =>
        new Promise((res) => {
          const finish = () => {
            v.removeEventListener("loadeddata", finish);
            v.removeEventListener("error", finish);
            res();
          };
          v.addEventListener("loadeddata", finish);
          v.addEventListener("error", finish);
          setTimeout(finish, timeout);
        }),
    ),
  );
}

/* -------------------------------------------------------- timeline */

export function sceneRange(doc, index) {
  const s = doc.scenes[index];
  return s ? { start: s._start, end: s._start + s._frames, frames: s._frames } : null;
}
/** frame → { index, scene, localFrame, localT, progress, start } */
export function frameToScene(doc, frame) {
  const f = clamp(Math.floor(frame), 0, Math.max(0, doc.totalFrames - 1));
  for (let i = 0; i < doc.scenes.length; i++) {
    const s = doc.scenes[i];
    if (f < s._start + s._frames) {
      const localFrame = f - s._start;
      return {
        index: i,
        scene: s,
        localFrame,
        localT: localFrame / doc.fps,
        progress: s._frames ? localFrame / s._frames : 0,
        start: s._start,
      };
    }
  }
  const last = doc.scenes[doc.scenes.length - 1];
  return {
    index: doc.scenes.length - 1,
    scene: last,
    localFrame: last._frames - 1,
    localT: (last._frames - 1) / doc.fps,
    progress: 1,
    start: last._start,
  };
}

/* -------------------------------------------------- animation state */

const ENTER_TYPES = {
  "fade": { from: { opacity: 0 }, to: { opacity: 1 } },
  "fade-up": { from: { opacity: 0, dy: 26 }, to: { opacity: 1, dy: 0 } },
  "fade-down": { from: { opacity: 0, dy: -26 }, to: { opacity: 1, dy: 0 } },
  "slide-left": { from: { opacity: 0, dx: -90 }, to: { opacity: 1, dx: 0 } },
  "slide-right": { from: { opacity: 0, dx: 90 }, to: { opacity: 1, dx: 0 } },
  "slide-up": { from: { opacity: 0, dy: 60 }, to: { opacity: 1, dy: 0 } },
  "slide-down": { from: { opacity: 0, dy: -60 }, to: { opacity: 1, dy: 0 } },
  "zoom": { from: { opacity: 0, scale: 0.85 }, to: { opacity: 1, scale: 1 } },
  "zoom-in": { from: { opacity: 0, scale: 1.15 }, to: { opacity: 1, scale: 1 } },
  "none": { from: {}, to: {} },
};
const EXIT_TYPES = {
  "fade-out": { from: { opacity: 1 }, to: { opacity: 0 } },
  "fade-up": { from: { opacity: 1, dy: 0 }, to: { opacity: 0, dy: -40 } },
  "slide-left": { from: { opacity: 1, dx: 0 }, to: { opacity: 0, dx: -90 } },
  "slide-right": { from: { opacity: 1, dx: 0 }, to: { opacity: 0, dx: 90 } },
  "zoom-out": { from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.8 } },
  "none": { from: {}, to: {} },
};

/** Entrance progress 0..1 for an element at scene-local time t (seconds).
 *  默认曲线 bezier(0.16,1,0.3,1)（Showreel 标志性 out-expo 曲线）；
 *  fx.enterEasing 可覆盖（spring / bezier(...) / 命名缓动）。 */
export function enterProgress(el, t) {
  const fx = el.fx;
  if (!fx || !fx.enter || fx.enter === "none") return 1;
  const d = fx.enterDur || 0.6;
  return interpolate(t, [fx.delay || 0, (fx.delay || 0) + d], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easingOf(fx.enterEasing || "bezier(0.16,1,0.3,1)"),
  });
}
/** Exit progress 1..0; 1 = fully visible, 0 = gone. */
export function exitProgress(el, sceneDur, t) {
  const fx = el.fx;
  if (!fx || !fx.exit || fx.exit === "none") return 1;
  const d = fx.exitDur || 0.5;
  const start = sceneDur - d;
  return interpolate(t, [start, sceneDur], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easingOf(fx.exitEasing || "bezier(0.7,0,0.84,0)"),
  });
}

/** Sample keyframes at scene-local t (seconds).
 *  x/y are ABSOLUTE document coordinates (null when unspecified — the
 *  caller translates them into offsets relative to el.x/el.y);
 *  scale/rotation/opacity default to 1/0/1; scaleY null = follow scale. */
export function sampleKeyframes(el, t) {
  const kf = el.keyframes;
  const out = { x: null, y: null, scale: 1, scaleY: null, rotation: 0, opacity: 1 };
  if (!Array.isArray(kf) || !kf.length) return out;
  // kfLoop：时间在关键帧区间内取模循环（环境动画：漂移/走马灯/粒子）
  if (el.kfLoop && kf.length >= 2) {
    const t0 = kf[0].t,
      t1 = kf[kf.length - 1].t,
      span = t1 - t0;
    if (span > 0) t = t0 + ((((t - t0) % span) + span) % span);
  }
  if (t <= kf[0].t) return applyKey(out, kf[0]);
  const last = kf[kf.length - 1];
  if (t >= last.t) return applyKey(out, last);
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i],
      b = kf[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = clamp((t - a.t) / ((b.t - a.t) || 1), 0, 1);
      const e = easingOf((a.easing) || "linear")(p);
      ["x", "y", "scale", "scaleY", "rotation", "opacity"].forEach((k) => {
        if (a[k] != null && b[k] != null) out[k] = a[k] + (b[k] - a[k]) * e;
        else if (a[k] != null) out[k] = a[k];
        else if (b[k] != null) out[k] = b[k];
        // 否则保持缺省：x/y = null（未指定），scale/rotation/opacity = 1/0/1
      });
      return out;
    }
  }
  return out;
}
function applyKey(out, k) {
  ["x", "y", "scale", "scaleY", "rotation", "opacity"].forEach((key) => {
    if (k[key] != null) out[key] = k[key];
  });
  return out;
}

/** Combined per-frame element state: {opacity, dx, dy, scale, scaleY, rotation}.
 *  Keyframe x/y are absolute document coordinates → converted to offsets.
 *  rotation：关键帧轨道存在 rotation 字段时由关键帧驱动（绝对值），否则用
 *  元素静态 rotation（舞台旋转手柄 / inspector 输入，此前被完全忽略）。 */
export function elementState(el, sceneDur, t) {
  const kf = sampleKeyframes(el, t);
  const en = enterProgress(el, t);
  const ex = exitProgress(el, sceneDur, t);
  let op = (el.opacity == null ? 1 : el.opacity) * kf.opacity * en * ex;
  const hasKfRot =
    Array.isArray(el.keyframes) && el.keyframes.some((k) => k.rotation != null);
  const state = {
    opacity: op,
    dx: kf.x != null ? kf.x - (+el.x || 0) : 0,
    dy: kf.y != null ? kf.y - (+el.y || 0) : 0,
    scale: kf.scale,
    scaleY: kf.scaleY,
    rotation: hasKfRot ? kf.rotation : +el.rotation || 0,
  };

  const fx = el.fx;
  if (fx && fx.enter && ENTER_TYPES[fx.enter] && en < 1) {
    const def = ENTER_TYPES[fx.enter];
    const p = en;
    if (def.from.dx != null) state.dx += def.from.dx * (1 - p);
    if (def.from.dy != null) state.dy += def.from.dy * (1 - p);
    if (def.from.scale != null) state.scale *= def.from.scale + (1 - def.from.scale) * p;
  }
  if (fx && fx.exit && EXIT_TYPES[fx.exit] && ex < 1) {
    const def = EXIT_TYPES[fx.exit];
    const p = ex;
    if (def.from.dx != null) state.dx += def.from.dx * (1 - p) * 0; // exit motion handled below
    const q = 1 - p; // progress of exit
    if (def.to.dx != null) state.dx += (def.to.dx - (def.from.dx || 0)) * q;
    if (def.to.dy != null) state.dy += (def.to.dy - (def.from.dy || 0)) * q;
    if (def.to.scale != null) state.scale *= def.to.scale + (def.from.scale != null ? 1 - def.to.scale : 0) * (1 - q);
  }
  return state;
}

/** countUp: replace numeric tokens with interpolated values at t. */
export function applyCountUp(html, el, t, fps) {
  const fx = el.fx;
  if (!fx || !fx.countUp) return html;
  const d = fx.countUpDur || 1.2;
  const start = fx.delay || 0;
  const p = interpolate(t, [start, start + d], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: "easeOut",
  });
  return html.replace(/(\d[\d,]*)(?:\.(\d+))?/g, (m, intPart, decPart) => {
    const target = parseFloat(m.replace(/,/g, ""));
    if (!isFinite(target)) return m;
    const v = target * p;
    const withComma = /,/.test(intPart);
    const s = decPart
      ? v.toFixed(decPart.length)
      : String(Math.round(v));
    return withComma ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : s;
  });
}

/* --------------------------------------------------------- captions */

/** Caption visible at scene-local t, or null. */
export function captionsAt(scene, t) {
  const caps = scene.captions;
  if (!Array.isArray(caps) || !caps.length) return null;
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (t >= c.start && t < c.end) return c;
  }
  return null;
}

/* ------------------------------------------------------ element renderers
 * All renderers return HTML strings (inline styles only) so the same build
 * works detached (export) or attached (preview). `state` is the per-frame
 * elementState() result; `asrc` is the resolved asset URL (data: URL for export).
 */

/* three 元素：声明式 3D 场景（ui/video/three.js，vendored three.js r170）。
 * 懒加载：首次遇到 three 元素时由 prepareThree 动态 import；buildFrame 同步
 * 渲染（renderThree 输出 dataURL <img>，导出 foreignObject 走 data: 路径）。 */
let threeMod = null;
export async function prepareThree(doc, assetMap) {
  const has =
    !!doc &&
    ((doc.scenes || []).some((s) =>
      (s.elements || []).some((e) => e.type === "three"),
    ) ||
      (doc.overlay || []).some((e) => e.type === "three"));
  if (has && !threeMod) {
    try {
      threeMod = await import("./three.js");
    } catch (e) {
      console.warn("[video engine] three.js 加载失败：", e);
    }
  }
  // geo 自定义网格：预取资产数据（assets/xxx.geo.json → BufferGeometry 缓存），
  // 保证 buildFrame 同步可用（预览 prepare().then 重绘、导出 prepare 已 await）
  if (has && threeMod && threeMod.prepareGeo) {
    const srcs = new Set();
    const scan = (el) => {
      if (el.type === "three" && el.scene && Array.isArray(el.scene.objects)) {
        el.scene.objects.forEach((o) => {
          if (o && o.type === "geo" && o.src) srcs.add(o.src);
        });
      }
    };
    (doc.scenes || []).forEach((s) => (s.elements || []).forEach(scan));
    (doc.overlay || []).forEach(scan);
    if (srcs.size) {
      const fetchText = (src) =>
        fetch(resolveAssetUrl(src, assetMap)).then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        });
      await threeMod.prepareGeo([...srcs], fetchText);
    }
  }
  return !!threeMod;
}

function gradientCss(g) {
  if (!g || !g.stops || !g.stops.length) return null;
  const stops = g.stops
    .map((s) => s.color + " " + Math.round((s.pos || 0) * 100) + "%")
    .join(", ");
  const angle = g.angle != null ? g.angle : 135;
  return "linear-gradient(" + angle + "deg, " + stops + ")";
}

function svgFillAttrs(el) {
  const g = el.fillGradient;
  if (g && g.stops && g.stops.length) {
    const defId = "g" + uid();
    const stops = g.stops
      .map((s) => `<stop offset="${Math.round((s.pos || 0) * 100)}%" stop-color="${s.color}"/>`)
      .join("");
    return {
      fill: `url(#${defId})`,
      defs: `<linearGradient id="${defId}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`,
    };
  }
  return { fill: el.fill || "#3a6ff7", defs: "" };
}

function strokeAttrs(el) {
  const sw = el.strokeWidth;
  if (!sw) return "";
  let s = ` stroke="${el.stroke || "#000"}" stroke-width="${sw}"`;
  if (el.strokeStyle === "dashed") s += ' stroke-dasharray="6 4"';
  else if (el.strokeStyle === "dotted") s += ' stroke-dasharray="2 3"';
  return s;
}

function renderShape(el) {
  const f = svgFillAttrs(el);
  const stroke = strokeAttrs(el);
  const sw = el.strokeWidth || 0;
  const pad = sw / 2;
  const w = Math.max(el.w, 1),
    h = Math.max(el.h, 1);
  let body = "";
  const kind = el.shape || "rect";
  if (kind === "rect") {
    body =
      `<rect x="${pad}" y="${pad}" width="${Math.max(w - sw, 0.1)}" height="${Math.max(h - sw, 0.1)}" rx="${el.radius || 0}" fill="${f.fill}" ${stroke}/>`;
  } else if (kind === "ellipse") {
    body =
      `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(w / 2 - pad, 0.1)}" ry="${Math.max(h / 2 - pad, 0.1)}" fill="${f.fill}" ${stroke}/>`;
  } else if (kind === "triangle") {
    body =
      `<polygon points="${w / 2},${pad} ${w - pad},${h - pad} ${pad},${h - pad}" fill="${f.fill}" ${stroke}/>`;
  } else if (kind === "arrow") {
    const dir = el.direction || "right";
    const m = Math.min(w, h) * 0.16;
    if (dir === "right" || dir === "left") {
      const x1 = dir === "right" ? m : w - m;
      const x2 = dir === "right" ? w - m : m;
      body =
        `<line x1="${x1}" y1="${h / 2}" x2="${x2}" y2="${h / 2}" stroke="${el.fill || "#3a6ff7"}" stroke-width="${Math.max(sw, 3)}" stroke-linecap="round"/><path d="M ${x2} ${h / 2 - h * 0.22} L ${x2 + (dir === "right" ? 1 : -1) * h * 0.28} ${h / 2} L ${x2} ${h / 2 + h * 0.22} Z" fill="${el.fill || "#3a6ff7"}"/>`;
    } else {
      const y1 = dir === "down" ? m : h - m;
      const y2 = dir === "down" ? h - m : m;
      body =
        `<line x1="${w / 2}" y1="${y1}" x2="${w / 2}" y2="${y2}" stroke="${el.fill || "#3a6ff7"}" stroke-width="${Math.max(sw, 3)}" stroke-linecap="round"/><path d="M ${w / 2 - w * 0.22} ${y2} L ${w / 2} ${y2 + (dir === "down" ? 1 : -1) * w * 0.28} L ${w / 2 + w * 0.22} ${y2} Z" fill="${el.fill || "#3a6ff7"}"/>`;
    }
  } else if (kind === "line") {
    body =
      `<line x1="${el.x1 || 0}" y1="${el.y1 || 0}" x2="${el.x2 != null ? el.x2 : w}" y2="${el.y2 != null ? el.y2 : h}" stroke="${el.stroke || el.fill || "#888"}" stroke-width="${Math.max(sw, 2)}" ${el.strokeStyle === "dashed" ? 'stroke-dasharray="6 4"' : ""} stroke-linecap="round"/>`;
  } else {
    body = `<rect x="${pad}" y="${pad}" width="${Math.max(w - sw, 0.1)}" height="${Math.max(h - sw, 0.1)}" rx="${el.radius || 0}" fill="${f.fill}" ${stroke}/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">${f.defs}${body}</svg>`;
}

function renderTable(el) {
  const st = el.style || {};
  const cols = (el.columns || [])
    .map((c) => `<col style="width:${c.w * 100}%">`)
    .join("");
  const rows = (el.rows || [])
    .map((row, ri) => {
      const isHead = el.header && ri === 0;
      const tag = isHead ? "th" : "td";
      const tds = (row.cells || [])
        .map((cell) => {
          let cs = "text-align:" + (cell.align || "left") + ";";
          cs +=
            "color:" +
            (cell.color || (isHead ? st.headerColor || "#fff" : st.color || "#1f2430")) +
            ";";
          if (cell.bg) cs += "background:" + cell.bg + ";";
          else if (isHead) cs += "background:" + (st.headerBg || "#3a6ff7") + ";";
          else if (st.zebra && ri % 2 === 0) cs += "background:" + st.zebra + ";";
          if (cell.bold) cs += "font-weight:700;";
          cs += `padding:${st.cellPadY != null ? st.cellPadY : 8}px ${st.cellPadX != null ? st.cellPadX : 10}px;`;
          cs += `border:${st.borderWidth != null ? st.borderWidth : 1}px solid ${st.borderColor || "rgba(128,128,128,.3)"};`;
          return `<${tag} style="${cs}">${sanitizeHtml(cell.html || "")}</${tag}>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const ts =
    `width:100%;height:100%;border-collapse:collapse;table-layout:fixed;` +
    `font-size:${st.fontSize || 15}px;` +
    (st.fontFamily ? `font-family:${st.fontFamily};` : "") +
    `color:${st.color || "#1f2430"};` +
    `border-radius:${st.radius || 0}px;overflow:hidden;`;
  return (
    `<table style="${ts}">` +
    (cols ? `<colgroup>${cols}</colgroup>` : "") +
    rows +
    "</table>"
  );
}

function renderChart(el, doc, ctx) {
  const opt = el.option || {};
  const series = Array.isArray(opt.series) ? opt.series : [];
  const pal =
    (opt.color && opt.color.length ? opt.color : null) ||
    doc.theme.chartPalette ||
    DEFAULT_PALETTE;
  const W = Math.max(el.w, 60),
    H = Math.max(el.h, 60);
  let out = "";
  const type = (series[0] && series[0].type) || "bar";

  if (type === "pie") {
    const data = (series[0] && series[0].data) || [];
    const vals = data.map((d) => (typeof d === "object" && d !== null ? +d.value || 0 : +d || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const hasNames = data.some((d) => d && typeof d === "object" && d.name);
    const cx = hasNames ? W * 0.38 : W / 2,
      cy = H / 2,
      r = Math.min(hasNames ? W * 0.6 : W, H) / 2 - 8;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (v <= 0) return;
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      out +=
        `<path d="M${cx},${cy}L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}Z" fill="${pal[i % pal.length]}"/>`;
      a0 = a1;
    });
    if (hasNames) {
      data.forEach((d, i) => {
        const y = H / 2 - (data.length - 1) * 9 + i * 18;
        out +=
          `<rect x="${W * 0.68}" y="${y - 8}" width="10" height="10" rx="2" fill="${pal[i % pal.length]}"/><text x="${W * 0.68 + 16}" y="${y}" font-size="11" fill="#999">${escapeHtml(d.name || "")}</text>`;
      });
    }
  } else {
    const cats = (opt.xAxis && opt.xAxis.data) || [];
    const padL = 38,
      padB = 24,
      padT = series.some((s) => s.name) && series.length > 1 ? 22 : 10,
      padR = 10;
    const iw = W - padL - padR,
      ih = H - padT - padB;
    const all = [];
    series.forEach((s) => (s.data || []).forEach((v) => all.push(+v || 0)));
    const max = Math.max.apply(null, all.concat([1]));
    const min = Math.min.apply(null, all.concat([0]));
    const span = max - min || 1;
    const n = Math.max(cats.length, series[0] ? (series[0].data || []).length : 0, 1);
    const Y = (v) => padT + ih * (1 - (v - min) / span);
    for (let g = 0; g <= 4; g++) {
      const gv = min + (span * g) / 4,
        gy = Y(gv);
      out +=
        `<line x1="${padL}" y1="${gy}" x2="${padL + iw}" y2="${gy}" stroke="rgba(128,128,128,.18)"/><text x="${padL - 5}" y="${gy + 3.5}" font-size="10" fill="#888" text-anchor="end">${fmtNum(gv)}</text>`;
    }
    for (let c = 0; c < n; c++) {
      const cxp = padL + (iw * (c + 0.5)) / n;
      out +=
        `<text x="${cxp}" y="${H - 7}" font-size="10" fill="#888" text-anchor="middle">${escapeHtml(cats[c] != null ? cats[c] : "")}</text>`;
    }
    out +=
      `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ih}" stroke="rgba(128,128,128,.4)"/><line x1="${padL}" y1="${Y(Math.max(min, 0))}" x2="${padL + iw}" y2="${Y(Math.max(min, 0))}" stroke="rgba(128,128,128,.4)"/>`;
    const band = iw / n;
    let drawP = 1;
    if (opt.draw && ctx) {
      const dur = +opt.draw || 2;
      drawP = clamp((ctx.t - (+opt.drawDelay || 0)) / dur, 0, 1);
      drawP = easingOf(opt.drawEasing || "bezier(0.65,0,0.35,1)")(drawP);
    }
    series.forEach((s, si) => {
      const col = pal[si % pal.length];
      const vals2 = (s.data || []).map((v) => +v || 0);
      if (s.type === "line") {
        const pts = vals2.map((v, i) => padL + band * (i + 0.5) + "," + Y(v)).join(" ");
        const drawAttrs = opt.draw
          ? ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(1 - drawP).toFixed(4)}"`
          : "";
        out +=
          `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round"${drawAttrs}/>`;
        vals2.forEach((v, i) => {
          if (opt.draw && drawP < (i + 0.5) / vals2.length) return;
          out += `<circle cx="${padL + band * (i + 0.5)}" cy="${Y(v)}" r="3" fill="${col}"/>`;
        });
      } else if (s.type === "scatter") {
        vals2.forEach((v, i) => {
          out += `<circle cx="${padL + band * (i + 0.5)}" cy="${Y(v)}" r="4" fill="${col}" fill-opacity=".85"/>`;
        });
      } else {
        const bw = (band * 0.66) / series.length;
        vals2.forEach((v, i) => {
          const x = padL + band * (i + 0.17) + si * bw;
          const y0 = Y(Math.max(v, 0)),
            y1 = Y(Math.min(v, 0));
          out +=
            `<rect x="${x}" y="${y0}" width="${Math.max(bw - 2, 1)}" height="${Math.max(y1 - y0, 0.5)}" rx="1.5" fill="${col}"/>`;
        });
      }
    });
    if (padT === 22) {
      series.forEach((s, si) => {
        const lx = padL + si * 90;
        out +=
          `<rect x="${lx}" y="6" width="10" height="10" rx="2" fill="${pal[si % pal.length]}"/><text x="${lx + 15}" y="15" font-size="10" fill="#999">${escapeHtml(s.name || "")}</text>`;
      });
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">${out}</svg>`;
}

/** Resolve an asset ref to a URL. data: URLs pass through; relative refs use
 *  the engine's asset map (host fills data URLs for export safety). */
export function resolveAssetUrl(src, assetMap) {
  if (!src) return "";
  if (/^(data:|https?:|blob:)/i.test(src)) return src;
  if (assetMap && assetMap[src]) return assetMap[src];
  return src; // relative path — preview only (host may rewrite)
}

function renderTextHtml(el, doc, ctx) {
  let html = el.html || "";
  if (ctx.fields && html.indexOf("{{") >= 0) {
    html = html.replace(
      /\{\{\s*(page|pages|title|frame|time|progress|sframe|stime|sprogress)(?::([^}]*))?\s*\}\}/gi,
      (m, name, arg) => {
        const n = name.toLowerCase();
        const F = ctx.fields || {};
        if (n === "page") {
          const w = parseInt(arg || "", 10);
          return w > 0 ? String(F.page || 1).padStart(w, "0") : String(F.page || 1);
        }
        if (n === "pages") return String(F.pages || 1);
        if (n === "title") return escapeHtml(F.title || "");
        // HUD 动态字段：frame/time/progress（全片）与 sframe/stime/sprogress（场景内）
        if (n === "frame" || n === "sframe") {
          const w = parseInt(arg || "", 10);
          const v = Math.floor(+F[n] || 0);
          return w > 0 ? String(v).padStart(w, "0") : String(v);
        }
        if (n === "time" || n === "stime") {
          const d = parseInt(arg || "2", 10);
          const dd = isFinite(d) ? clamp(d, 0, 3) : 2;
          // {{time:2}} → "08.77"（toFixed 后左侧补零对齐读数风格）
          return (+F[n] || 0).toFixed(dd).padStart(dd + 3, "0");
        }
        // progress / sprogress → 0-100 整数百分比
        return String(Math.round(clamp(+F[n] || 0, 0, 1) * 100));
      },
    );
  }
  if (el.fx && el.fx.countUp) html = applyCountUp(html, el, ctx.t, ctx.fps);
  return sanitizeHtml(html);
}

/** 逐字/逐词 stagger（移植 Showreel 逐字弹簧语义）：纯文本拆分为 span，
 *  每个单元以 spring（或指定缓动）从 dy/dx/rotation/scaleFrom 过渡到原位。
 *  el.stagger = { by:'char'|'word', step, delay, dur, dy, dx, rotation,
 *                 scaleFrom, easing（默认 spring(13,170,0.9)） } */
function staggerSpans(el, t) {
  const st = el.stagger || {};
  const by = st.by || "char";
  const text = String(el.html || "");
  const parts = by === "word" ? text.split(/(\s+)/) : [...text];
  const step = st.step != null ? +st.step : 0.06;
  const delay0 = +st.delay || 0;
  const dur = +st.dur || 0.8;
  const ez = easingOf(st.easing || "spring(13,170,0.9)");
  const dy = st.dy != null ? +st.dy : 60;
  const dx = +st.dx || 0;
  const rot = +st.rotation || 0;
  const scaleFrom = st.scaleFrom != null ? +st.scaleFrom : null;
  let html = "";
  let vi = 0;
  for (const p of parts) {
    if (by === "word" && /^\s+$/.test(p)) { html += " "; continue; }
    const idx = vi++;
    const local = clamp((t - delay0 - idx * step) / dur, 0, 1);
    const prog = ez(local);
    const op = clamp(prog / 0.35, 0, 1);
    const tx = (1 - prog) * dx;
    const ty = (1 - prog) * dy;
    const ro = rot ? (1 - prog) * rot * (idx % 2 === 0 ? 1 : -1) : 0;
    const sc = scaleFrom != null ? scaleFrom + (1 - scaleFrom) * prog : 1;
    const ch = p === " " ? "&nbsp;" : escapeHtml(p);
    html +=
      `<span style="display:inline-block;opacity:${op.toFixed(3)};` +
      `transform:translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${ro.toFixed(2)}deg) scale(${sc.toFixed(3)});` +
      `transform-origin:center">${ch}</span>`;
  }
  return html;
}

/** svg 描边生长：为 markup 中的 <path> 注入 pathLength/dasharray/dashoffset，
 *  进度由 el.draw = { dur, delay, easing } 驱动（确定性、导出安全）。 */
function applySvgDraw(markup, el, t) {
  const d = el.draw || {};
  const dur = +d.dur || 1.5;
  const p = clamp((t - (+d.delay || 0)) / dur, 0, 1);
  const e = easingOf(d.easing || "bezier(0.65,0,0.35,1)")(p);
  return markup.replace(/<path\b([^>]*?)(\/?)>/g, (m, attrs, close) => {
    if (/pathLength\s*=|stroke-dasharray\s*=/.test(attrs)) return m;
    return `<path${attrs} pathLength="1" stroke-dasharray="1" stroke-dashoffset="${(1 - e).toFixed(4)}"${close}>`;
  });
}

/** Render one element to an absolutely-positioned div (doc coordinates).
 *  ctx: { t (scene-local s), state (elementState), assetMap, fields, fps }
 *  Returns a detached DOM node with inline styles — export-safe. */
export function renderElement(el, doc, ctx) {
  const node = document.createElement("div");
  node.className = "vd-el vd-el-" + el.type;
  node.setAttribute("data-el-id", el.id);
  const st = ctx.state || { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0 };
  const sy = st.scaleY != null ? st.scaleY : st.scale;
  let css =
    `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` +
    `transform:translate(${st.dx}px,${st.dy}px) rotate(${st.rotation}deg) scale(${st.scale},${sy});` +
    `transform-origin:${el.origin || "center"};opacity:${clamp(st.opacity, 0, 1)};`;
  if (el.z != null) css += `z-index:${el.z};`;
  if (el.blur) css += `filter:blur(${+el.blur || 0}px);`;
  node.style.cssText = css;

  if (el.type === "text") {
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.justifyContent =
      el.valign === "middle" ? "center" : el.valign === "bottom" ? "flex-end" : "flex-start";
    node.style.textAlign = el.align || "left";
    node.style.fontSize = (el.fontSize || 24) + "px";
    node.style.fontFamily = el.fontFamily || doc.theme.fontFamily;
    node.style.fontWeight = el.fontWeight || 400;
    node.style.lineHeight = el.lineHeight || 1.25;
    if (el.letterSpacing) node.style.letterSpacing = el.letterSpacing + "px";
    node.style.wordBreak = "break-word";
    node.style.whiteSpace = "pre-wrap";
    if (el.colorGradient && el.colorGradient.stops && el.colorGradient.stops.length) {
      node.style.background = gradientCss(el.colorGradient);
      node.style.webkitBackgroundClip = "text";
      node.style.backgroundClip = "text";
      node.style.color = "transparent";
    } else {
      node.style.color = el.color || doc.theme.color;
    }
    if (el.textStroke && el.textStroke.width) {
      node.style.webkitTextStroke = el.textStroke.width + "px " + (el.textStroke.color || "#000");
      if (el.textStroke.fill === "none") node.style.color = "transparent";
    }
    const inner =
      el.stagger && !/<[a-z]/i.test(el.html || "")
        ? staggerSpans(el, ctx.t)
        : renderTextHtml(el, doc, ctx);
    node.innerHTML =
      '<div style="width:100%">' + inner + "</div>";
  } else if (el.type === "shape") {
    node.innerHTML = renderShape(el);
  } else if (el.type === "image") {
    const img = document.createElement("img");
    img.src = resolveAssetUrl(el.src, ctx.assetMap);
    img.draggable = false;
    img.alt = "";
    img.style.cssText =
      `width:100%;height:100%;display:block;object-fit:${el.fit || "contain"};` +
      (el.radius ? `border-radius:${el.radius}px;` : "");
    node.appendChild(img);
    node.style.overflow = "hidden";
    if (el.radius) node.style.borderRadius = el.radius + "px";
  } else if (el.type === "svg") {
    let markup = el.asset
      ? resolveAssetUrl(el.asset, ctx.assetMap)
      : el.markup || "";
    if (el.draw && markup) markup = applySvgDraw(markup, el, ctx.t);
    node.innerHTML =
      (el.css ? "<style>" + el.css.replace(/<\//g, "<\\/") + "</style>" : "") + markup;
  } else if (el.type === "table") {
    node.innerHTML = renderTable(el);
  } else if (el.type === "chart") {
    node.innerHTML = renderChart(el, doc, ctx);
  } else if (el.type === "media") {
    if (el.kind === "audio") {
      // 音频元素无画面：预览渲染成「音频 chip」（纯 DOM 可点选、导出安全）；
      // 导出时无任何视觉（声音由 audioTracks 混音进音轨）。
      if (!ctx.forExport) {
        const name = String(el.src || "audio").split("/").pop();
        const ts = +el.trimStart || 0;
        const te = el.trimEnd >= 0 ? +el.trimEnd : 0;
        node.innerHTML =
          `<div style="width:100%;height:100%;display:flex;align-items:center;gap:8px;box-sizing:border-box;` +
          `padding:0 12px;border-radius:8px;background:rgba(34,197,94,0.14);border:1px solid rgba(34,197,94,0.45);` +
          `color:#86efac;font:500 13px/1.2 sans-serif;overflow:hidden;white-space:nowrap">` +
          `<span style="font-size:15px">♪</span><span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</span>` +
          (te > 0
            ? `<span style="margin-left:auto;font-size:11px;opacity:.75">${Math.max(0, te - ts).toFixed(1)}s</span>`
            : "") +
          `</div>`;
      }
    } else {
      // 帧确定性渲染：池化 video 定位到裁剪后当前帧（预览拖动/导出逐帧取帧；播放由 stage overlay 接管）。
      // 不用原生 controls/loop/autoplay——确定性帧渲染只负责「显示该时刻的画面」。
      const m = mediaVideoFor(el, ctx.assetMap);
      if (m) {
        let mt = mediaTimeLt(el, ctx.t); // ctx.t = 窗口相对时间
        // loop + trimEnd=-1（源全长）：mediaTimeLt 无法取模，用实际源时长循环
        if (el.loop && (el.trimEnd == null || el.trimEnd < 0) && m.duration > 0) {
          const ts = +el.trimStart || 0;
          const len = m.duration - ts;
          if (len > 0) mt = ts + (((ctx.t % len) + len) % len);
        }
        m._vdT = mt;
        if (m.readyState >= 1) {
          if (Math.abs((m.currentTime || 0) - mt) > 0.001) {
            m._vdDirty = true;
            m.currentTime = mt;
          }
        } else {
          // 未加载：加载完成由池 video 的持久 loadedmetadata 监听 seek 到最新 _vdT
          m._vdDirty = true;
        }
        m.style.objectFit = el.fit || "contain";
        node.appendChild(m);
        node.style.overflow = "hidden";
        if (el.radius) node.style.borderRadius = el.radius + "px";
        // 导出合成项：<video> 序列化进 SVG foreignObject 不绘制（与 WebGL 同类限制），
        // render.js 按此几何信息把活 video 的当前帧 drawImage 到目标画布。
        // anc = 过渡容器变换（transition 时 content 有 translate/scale/opacity，
        // 合成发生在序列化之后不随 DOM 变换，必须显式叠加）；radius 供合成裁剪。
        if (ctx.mediaItems) {
          ctx.mediaItems.push({
            video: m, x: el.x, y: el.y, w: el.w, h: el.h,
            dx: st.dx, dy: st.dy, rotation: st.rotation,
            scaleX: st.scale, scaleY: sy, opacity: clamp(st.opacity, 0, 1),
            fit: el.fit || "contain",
            radius: el.radius || 0,
            anc: ctx.anc || null,
          });
        }
      } else {
        node.style.background = "rgba(148,163,184,0.12)";
        node.innerHTML =
          `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
          `color:#94a3b8;font:500 13px sans-serif">视频源缺失：${escapeHtml(String(el.src || "").split("/").pop())}</div>`;
      }
    }
  } else if (el.type === "three") {
    // WebGL 位图无法序列化进 foreignObject（隔离文档不会同步解码每帧新
    // dataURL），因此预览与导出都直接挂活 canvas；导出路径在 render.js
    // 里按 ctx.threeItems 记录的几何与透明度把 canvas 合成到目标画布上。
    if (threeMod) {
      try {
        const cv = threeMod.getThreeCanvas(el, ctx.t);
        cv.setAttribute("data-three-canvas", "1");
        cv.style.cssText = "width:100%;height:100%;display:block;";
        node.appendChild(cv);
        if (ctx.threeItems) {
          ctx.threeItems.push({
            canvas: cv, x: el.x, y: el.y, w: el.w, h: el.h,
            dx: st.dx, dy: st.dy, rotation: st.rotation,
            scaleX: st.scale, scaleY: sy, opacity: clamp(st.opacity, 0, 1),
            anc: ctx.anc || null,
          });
        }
      } catch (e) {
        console.warn("[video engine] three 渲染失败：", e);
      }
    }
  } else {
    node.textContent = el.type || "?";
  }
  return node;
}

/* ------------------------------------------------------ frame building
 * buildFrame(doc, frame, opts) → detached DIV sized doc.size (unscaled).
 * Structure:
 *   .vd-frame
 *     .vd-bg-prev        (transition only) previous scene background, crossfading out
 *     .vd-bg             current scene background
 *     .vd-content        current scene elements (z-ordered)
 *     .vd-transition     (transition only) incoming content wrapper with enter anim
 *     .vd-caption        caption bar (if any)
 * opts: { assetMap, fields }
 */

function sceneBackgroundNode(scene, doc) {
  const bg = document.createElement("div");
  bg.className = "vd-bg";
  bg.style.cssText =
    `position:absolute;left:0;top:0;width:100%;height:100%;background:${scene.background || doc.theme.background};`;
  return bg;
}

function buildSceneContent(scene, doc, ctx) {
  const wrap = document.createElement("div");
  wrap.className = "vd-content";
  wrap.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
  if (scene.hidden) return wrap; // 场景隐藏：只留背景，整轨元素不渲染
  const els = (scene.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  els.forEach((el) => {
    if (el.hidden) return;
    // 时间窗：start/dur 定义元素在场景内的可见区间；窗口内动画/关键帧/媒体源
    // 都以窗口相对时间 lt 求值（Sequence 语义：拖窗口即整体平移动画）
    const start = Math.max(0, +el.start || 0);
    const dur = elDurOf(el, scene.duration);
    const lt = ctx.t - start;
    if (lt < 0 || lt >= dur) return;
    const state = elementState(el, dur, lt);
    if (state.opacity <= 0.003) return; // skip fully invisible (perf)
    const c2 = Object.assign({}, ctx, { state, t: lt });
    wrap.appendChild(renderElement(el, doc, c2));
  });
  return wrap;
}

const TRANSITION_ENTER = {
  fade: { opacity: [0, 1] },
  "slide-left": { dx: [-80, 0] },
  "slide-right": { dx: [80, 0] },
  "slide-up": { dy: [60, 0] },
  "slide-down": { dy: [-60, 0] },
  zoom: { scale: [0.92, 1] },
  iris: { scale: [1.15, 1] },
};

/** 全局覆盖层：doc.overlay 元素以全片时间为基准渲染（HUD 帧计数/进度条/
 *  常驻角标）。fx exit 在全片结尾触发；kfLoop 跨全片循环。 */
function buildOverlay(doc, gtime, ctx) {
  const wrap = document.createElement("div");
  wrap.className = "vd-overlay";
  wrap.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
  const totalDur = doc.totalFrames / doc.fps;
  const els = (doc.overlay || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  els.forEach((el) => {
    if (el.hidden) return;
    const start = Math.max(0, +el.start || 0);
    const dur = elDurOf(el, totalDur);
    const lt = gtime - start;
    if (lt < 0 || lt >= dur) return;
    const state = elementState(el, dur, lt);
    if (state.opacity <= 0.003) return;
    wrap.appendChild(
      // anc 清空：overlay 不在过渡容器内，合成项不得叠加 transition 变换
      renderElement(el, doc, Object.assign({}, ctx, { t: lt, state, anc: null })),
    );
  });
  return wrap;
}

/** Build the DOM for one frame. Deterministic; safe to serialize. */
export function buildFrame(doc, frame, opts = {}) {
  const f = frameToScene(doc, frame);
  const root = document.createElement("div");
  root.className = "vd-frame";
  root.setAttribute("data-frame", String(Math.floor(frame)));
  root.style.cssText =
    `position:relative;overflow:hidden;width:${doc.size.width}px;height:${doc.size.height}px;` +
    `background:${f.scene.background || doc.theme.background};`;

  const assetMap = opts.assetMap || {};
  const gframe = clamp(Math.floor(frame), 0, Math.max(0, doc.totalFrames - 1));
  const fields = Object.assign(
    {
      page: f.index + 1,
      pages: doc.scenes.length,
      title: doc.title,
      // HUD 动态字段：全片基准
      frame: gframe,
      time: gframe / doc.fps,
      progress: doc.totalFrames ? gframe / doc.totalFrames : 0,
      // 场景内基准
      sframe: f.localFrame,
      stime: f.localT,
      sprogress: f.progress,
    },
    opts.fields || {},
  );
  const ctx = { t: f.localT, assetMap, fields, fps: doc.fps, threeItems: [], mediaItems: [], forExport: !!opts.forExport };

  // transition: incoming scene enter anim + outgoing background crossfade
  const tin = f.scene.transitionIn || 0;
  const inTransition = f.index > 0 && tin > 0 && f.localT < tin;
  if (inTransition) {
    const p = clamp(f.localT / tin, 0, 1);
    const e = easing.easeInOut(p);
    const prevScene = doc.scenes[f.index - 1];
    // outgoing background
    const bgPrev = sceneBackgroundNode(prevScene, doc);
    bgPrev.className = "vd-bg-prev";
    bgPrev.style.opacity = String(1 - e);
    root.appendChild(bgPrev);
    // current background
    const bgCur = sceneBackgroundNode(f.scene, doc);
    root.appendChild(bgCur);
    // incoming content with enter transform
    const def = TRANSITION_ENTER[f.scene.transition] || TRANSITION_ENTER.fade;
    // 记录过渡容器变换：media/three 合成项发生在序列化之后，不随 DOM 变换——
    // render.js 按此叠加 translate/scale/opacity（transform-origin 中心）
    ctx.anc = {
      tx: def.dx ? def.dx[0] + (def.dx[1] - def.dx[0]) * e : 0,
      ty: def.dy ? def.dy[0] + (def.dy[1] - def.dy[0]) * e : 0,
      scale: def.scale ? def.scale[0] + (def.scale[1] - def.scale[0]) * e : 1,
      opacity: def.opacity ? def.opacity[0] + (def.opacity[1] - def.opacity[0]) * e : 1,
      W: doc.size.width, H: doc.size.height,
    };
    const content = buildSceneContent(f.scene, doc, ctx);
    let tr = "";
    if (def.dx) tr += `translateX(${def.dx[0] + (def.dx[1] - def.dx[0]) * e}px) `;
    if (def.dy) tr += `translateY(${def.dy[0] + (def.dy[1] - def.dy[0]) * e}px) `;
    if (def.scale) tr += `scale(${def.scale[0] + (def.scale[1] - def.scale[0]) * e}) `;
    content.style.opacity = String(def.opacity ? def.opacity[0] + (def.opacity[1] - def.opacity[0]) * e : 1);
    if (tr) content.style.transform = tr;
    content.style.transformOrigin = "center";
    root.appendChild(content);
  } else {
    ctx.anc = null; // 无过渡：合成项无需叠加容器变换
    root.appendChild(sceneBackgroundNode(f.scene, doc));
    root.appendChild(buildSceneContent(f.scene, doc, ctx));
  }

  // 全局覆盖层（HUD）：以全片时间渲染，位于场景内容之上、字幕之下；
  // pointer-events:none，舞台点选/拖拽穿透。
  if (doc.overlay && doc.overlay.length) {
    root.appendChild(buildOverlay(doc, gframe / doc.fps, ctx));
  }

  // captions
  const cap = captionsAt(f.scene, f.localT);
  if (cap) {
    const cs = doc.theme.captionStyle || {};
    const bar = document.createElement("div");
    bar.className = "vd-caption";
    bar.textContent = cap.text;
    bar.style.cssText =
      `position:absolute;left:0;right:0;bottom:${cs.bottom != null ? cs.bottom : 64}px;margin:0 auto;width:fit-content;` +
      `max-width:84%;font-size:${cs.fontSize || 40}px;font-family:${doc.theme.fontFamily};` +
      `color:${cs.color || "#fff"};text-align:center;line-height:1.35;` +
      `padding:${cs.paddingY || 8}px ${cs.paddingX || 18}px;border-radius:${cs.radius || 10}px;` +
      `background:${cs.background || "rgba(0,0,0,0.45)"};` +
      (cs.stroke ? `-webkit-text-stroke:${cs.strokeWidth || 3}px ${cs.stroke};paint-order:stroke fill;text-shadow:0 2px 6px rgba(0,0,0,.5);` : "");
    root.appendChild(bar);
  }

  root.__threeItems = ctx.threeItems;
  root.__mediaItems = ctx.mediaItems;
  return root;
}

const listeners = Symbol("listeners");

export class Video {
  constructor(opts = {}) {
    this[listeners] = {};
    this.doc = null;
    this.assets = opts.assets || {}; // relative ref → data:/blob: URL
    this.frame = 0;
    this.playing = false;
    this.muted = opts.muted || false;
  }

  on(evt, fn) {
    (this[listeners][evt] = this[listeners][evt] || []).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    const l = this[listeners][evt];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(evt, payload) {
    (this[listeners][evt] || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error("[video engine]", evt, err);
      }
    });
  }

  load(doc) {
    this.doc = normalizeDoc(doc);
    pruneMediaPool(this.doc); // 媒体池按文档元素 id 收容（删元素/换文档后释放 video）
    this.frame = 0;
    this.emit("statechange", this.getState());
    return this;
  }
  setDoc(doc) {
    return this.load(doc);
  }

  getState() {
    const d = this.doc;
    if (!d) return null;
    return {
      title: d.title,
      fps: d.fps,
      size: { width: d.size.width, height: d.size.height },
      totalFrames: d.totalFrames,
      duration: d.totalFrames / d.fps,
      scenes: d.scenes.map((s) => ({ id: s.id, duration: s.duration, start: s._start, frames: s._frames })),
      frame: this.frame,
      playing: this.playing,
      muted: this.muted,
    };
  }

  getDoc() {
    return deepClone(this.doc);
  }

  seek(frame) {
    this.frame = clamp(Math.floor(frame), 0, Math.max(0, (this.doc ? this.doc.totalFrames : 0) - 1));
    this.emit("statechange", this.getState());
    return this.frame;
  }

  /** Build the DOM node for the current or given frame. */
  buildFrame(frame, opts) {
    if (!this.doc) throw new Error("engine: no document loaded");
    return buildFrame(this.doc, frame != null ? frame : this.frame, {
      assetMap: this.assets,
      ...(opts || {}),
    });
  }

  /** Collect every distinct asset ref used by the doc (for preloading). */
  assetRefs() {
    return this.doc ? this.doc._assets.slice() : [];
  }

  /** 懒加载扩展渲染器（three 元素 + geo 网格资产）。预览 setDoc 与导出前各调一次。 */
  async prepare() {
    return prepareThree(this.doc, this.assets);
  }

  /* ------------------------------------------------------ audio graph */

  /** Tracks in document time (seconds), ready for mixing/scheduling:
   *  [{ kind: 'music'|'voice'|'element', src, offset (doc-time), volume, loop, duration }] */
  audioTracks() {
    if (!this.doc) return [];
    const out = [];
    const d = this.doc;
    if (d.music && d.music.src) {
      out.push({
        kind: "music",
        src: d.music.src,
        offset: d.music.offset || 0,
        volume: d.music.volume != null ? d.music.volume : 0.35,
        loop: d.music.loop !== false,
        duration: null,
      });
    }
    if (d.voice && d.voice.src) {
      out.push({
        kind: "voice",
        src: d.voice.src,
        offset: d.voice.offset || 0,
        volume: d.voice.volume != null ? d.voice.volume : 1,
        loop: false,
        duration: null,
      });
    }
    d.scenes.forEach((s) => {
      if (s.hidden) return;
      const sceneStart = s._start / d.fps;
      const sceneDur = +s.duration || 1;
      (s.elements || []).forEach((el) => {
        // media 元素（含视频自带音轨）按裁剪窗口进混音；muted/hidden 元素静音
        if (el.type !== "media" || !el.src || el.muted || el.hidden) return;
        const start = Math.max(0, +el.start || 0);
        if (start >= sceneDur) return;
        const ts = Math.max(0, +el.trimStart || 0);
        const te = el.trimEnd >= 0 ? +el.trimEnd : Infinity;
        const win = elDurOf(el, sceneDur); // 场景内窗口（含 el.dur）
        if (win <= 0) return;
        let dur = Math.min(win, Math.max(0, te - ts)); // 非循环播放长度
        if (el.loop) dur = win; // 循环：铺满窗口（loopEnd 截住源）
        if (dur <= 0) return;
        out.push({
          kind: "element",
          src: el.src,
          offset: sceneStart + start, // 文档时间起点
          srcOffset: ts, // 源内裁剪入点
          duration: dur, // 源内/窗口播放长度
          loopEnd: te === Infinity ? 0 : te,
          volume: el.volume != null ? el.volume : 1,
          loop: !!el.loop,
        });
      });
    });
    return out;
  }

  /** Decode + schedule all tracks into an OfflineAudioContext of totalDuration. */
  async renderAudioMix(totalDuration) {
    const tracks = this.audioTracks().filter((t) => this.assets[t.src] || /^(data:|https?:|blob:)/i.test(t.src));
    if (!tracks.length) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(totalDuration * sr)), sr);
    const decodes = tracks.map(async (t) => {
      const url = resolveAssetUrl(t.src, this.assets);
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      const audio = await ctx.decodeAudioData(buf);
      return { t, audio };
    });
    const items = (await Promise.all(decodes.map((p) => p.catch((e) => { console.warn('[vd audio] decode failed, skipped:', e.message); return null })))).filter(Boolean);
    items.forEach(({ t, audio }) => {
      const srcNode = ctx.createBufferSource();
      srcNode.buffer = audio;
      const so = Math.max(0, Math.min(t.srcOffset || 0, Math.max(0, audio.duration - 0.001)));
      if (t.loop) {
        srcNode.loop = true;
        srcNode.loopStart = so;
        srcNode.loopEnd = t.loopEnd ? Math.min(t.loopEnd, audio.duration) : audio.duration;
      }
      const gain = ctx.createGain();
      gain.gain.value = t.volume;
      srcNode.connect(gain).connect(ctx.destination);
      // start(when, offset, duration)：duration 到点自停（替代旧 stop() 写法）
      let dur;
      if (t.loop) dur = t.duration != null ? t.duration : undefined;
      else dur = t.duration != null ? Math.min(t.duration, audio.duration - so) : audio.duration - so;
      if (dur != null && dur <= 0) return;
      srcNode.start(Math.max(0, t.offset), so, dur);
    });
    const rendered = await ctx.startRendering();
    return rendered; // AudioBuffer 48k stereo
  }

  destroy() {
    this.doc = null;
    this[listeners] = {};
  }
}

export default Video;


