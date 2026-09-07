/*
 * render.js — browser video export pipeline for the video/1 engine.
 * Zero backend, zero native binaries: deterministic per-frame DOM → canvas →
 * WebCodecs VideoEncoder (H.264) + mp4-muxer; audio via OfflineAudioContext
 * mix → AudioEncoder (AAC) → same muxer. Output: standard MP4 Blob.
 *
 *   import {exportVideo} from './render.js'
 *   const blob = await exportVideo({ engine, fps, width, height, totalFrames,
 *                                    onProgress, signal })
 *
 * Requires Chromium (WebCodecs). Falls back to an error message otherwise.
 */

import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer.js";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from "./vendor/webm-muxer.js";
import { prepareMedia, waitMediaSeek, waitMediaReady } from "./engine.js";

const SR = 48000;

/* -------------------------------------------------------- 导出格式与质量 */

/** 支持的导出格式（浏览器 WebCodecs 能力内） */
export const EXPORT_FORMATS = {
  mp4: { label: "MP4 · H.264 + AAC", ext: "mp4", mime: "video/mp4" },
  webm: { label: "WebM · VP9 + Opus", ext: "webm", mime: "video/webm" },
  "webm-vp8": { label: "WebM · VP8 + Opus", ext: "webm", mime: "video/webm" },
  wav: { label: "WAV · 仅音频", ext: "wav", mime: "audio/wav" },
};

/** 质量预设 → 视频码率（bits/pixel/frame 经验值 × 总像素 × fps） */
const QUALITY_BPP = { low: 0.06, medium: 0.12, high: 0.22 };
export function estimateBitrate(width, height, fps, quality = "medium") {
  if (typeof quality === "number" && isFinite(quality) && quality > 0) {
    // 数字：<=200 视为 Mbps，否则视为 bps
    return Math.round(quality <= 200 ? quality * 1_000_000 : quality);
  }
  const bpp = QUALITY_BPP[quality] || QUALITY_BPP.medium;
  return Math.max(500_000, Math.min(40_000_000, Math.round(width * height * fps * bpp)));
}

function videoCodecFor(format, width, height) {
  const px = width * height;
  if (format === "webm") return px > 1280 * 720 ? "vp09.00.40.08" : "vp09.00.10.08";
  if (format === "webm-vp8") return "vp8";
  // mp4 H.264
  if (px > 1280 * 720) return "avc1.4d0028"; // 1080p main 4.0
  return "avc1.42001f"; // 720p baseline 3.1
}

/** AudioBuffer(48k stereo) → 16-bit PCM WAV Blob */
function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels,
    n = buf.length,
    sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF");
  dv.setUint32(4, 36 + n * ch * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  ws(36, "data");
  dv.setUint32(40, n * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([dv.buffer], { type: "audio/wav" });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Chromium 的 SVG-in-img 隔离文档完全不绘制 foreignObject 内嵌的 <svg>
 *  （长年未修的渲染 bug）——导出前把每个内嵌 svg 换成等价的
 *  data:image/svg+xml <img>（独立 svg 文档可正常栅格化）。
 *  缓存按 markup 命中：shape/svg 元素的动画走外层 transform，
 *  markup 跨帧不变，只有 draw 描边动画逐帧变化。 */
const svgUrlCache = new Map();
function svgToDataUrl(markup) {
  let url = svgUrlCache.get(markup);
  if (!url) {
    url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    if (svgUrlCache.size > 4000) svgUrlCache.clear();
    svgUrlCache.set(markup, url);
  }
  return url;
}
function inlineNestedSvgs(clone) {
  for (const s of [...clone.querySelectorAll("svg")]) {
    let markup = s.outerHTML;
    if (!/xmlns\s*=/.test(markup)) {
      markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const img = document.createElement("img");
    img.src = svgToDataUrl(markup);
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;display:block;";
    s.replaceWith(img);
  }
}

/* ------------------------------------------------ 分层合成（media/three 参与 DOM 覆盖关系）
 * 预览（真实 DOM）里 media 的 <video> 与 three 的 WebGL <canvas> 是普通节点，
 * 按 z-index/DOM 顺序参与元素层级；但 SVG-in-img 序列化画不出两者，必须事后合成——
 * 若合成固定最后画，media/three 会永远压住所有其它元素（覆盖关系与预览不一致）。
 * 解法：把帧按 DOM 顺序切成「普通段（foreignObject 序列化）/ 合成段（canvas 绘制）」，
 * 逐段按序绘制，合成项回到其应有的层级；过渡帧的容器变换由 item.anc 叠加。 */

// 帧内可渲染单元（深度优先顺序 = DOM 覆盖顺序）：
// plain = 随 foreignObject 序列化的普通节点；item = media/three（canvas 合成）
function collectUnits(root, mediaItems, threeItems) {
  const units = [];
  const visit = (el) => {
    for (const child of el.children) {
      if (child.classList.contains("vd-content") || child.classList.contains("vd-overlay")) {
        visit(child); // 包装容器本身无视觉，其子元素（.vd-el）才是单元
      } else if (child.classList.contains("vd-el")) {
        const video = child.querySelector("video");
        const cv = child.querySelector("[data-three-canvas]");
        const mi = video && mediaItems.find((it) => it.video === video);
        const ti = cv && threeItems.find((it) => it.canvas === cv);
        units.push(
          mi || ti
            ? { kind: "item", node: child, item: mi || ti }
            : { kind: "plain", node: child },
        );
      } else {
        units.push({ kind: "plain", node: child });
      }
    }
  };
  visit(root);
  return units;
}

// 节点在根下的子索引路径（clone 与原节点结构相同，按路径取对应克隆节点）
function nodePath(root, node) {
  const p = [];
  let n = node;
  while (n && n !== root) {
    p.unshift([...n.parentElement.children].indexOf(n));
    n = n.parentElement;
  }
  return p;
}
function nodeAt(root, path) {
  let n = root;
  for (const i of path) n = n.children[i];
  return n;
}

// plain 节点脱离其 wrap（vd-content/vd-overlay）后重建包装链：
// wrap 上的 transition transform/opacity 必须保留，否则元素位置漂移
function wrapChainFor(root, node) {
  const chain = [];
  let p = node.parentElement;
  while (p && p !== root) {
    chain.unshift({ cls: p.className, style: p.style.cssText });
    p = p.parentElement;
  }
  return chain;
}
function rebuildWrapped(tmpl, plainNodes, clone) {
  tmpl.replaceChildren();
  for (const n of plainNodes) {
    let host = tmpl;
    for (const w of wrapChainFor(clone, n)) {
      const cls = "." + w.cls.trim().split(/\s+/).join(".");
      let wc = host.querySelector(cls);
      if (!wc) {
        wc = document.createElement("div");
        wc.className = w.cls;
        wc.style.cssText = w.style;
        host.appendChild(wc);
      }
      host = wc;
    }
    host.appendChild(n);
  }
  return tmpl;
}

function frameHtml(rootNode, width, height, rootW, rootH, sx, sy) {
  rootNode.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  let html = rootNode.outerHTML;
  html = html.replace(
    /<(img|br|hr|input|meta|link|source|col|wbr|embed|area|base|track|param)(\s[^>]*?)?(?<!\/)>/g,
    "<$1$2 />",
  );
  // XML 不识别 HTML 具名实体（stagger 空格等产生的 &nbsp;）——换数值实体
  html = html.replace(/&nbsp;/g, "&#160;");
  const scaled =
    sx === 1 && sy === 1
      ? html
      : `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;position:relative">` +
        `<div style="width:${rootW}px;height:${rootH}px;transform:scale(${sx},${sy});transform-origin:0 0">${html}</div></div>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${scaled}</foreignObject></svg>`
  );
}
async function decodeFrame(html, width, height) {
  const img = new Image();
  img.decoding = "async";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(html);
  await img.decode();
  return img;
}

/** 合成绘制一个 media/three 项。统一在文档坐标空间（先 scale(sx,sy)），
 *  叠加 anc（过渡容器变换：translate/scale/opacity，transform-origin 中心）。 */
function drawItemCompose(ctx2d, it, sx, sy, snap) {
  const w = it.w,
    h = it.h;
  ctx2d.save();
  ctx2d.scale(sx, sy); // 进入文档坐标空间
  const a = it.anc;
  if (a && (a.scale !== 1 || a.tx || a.ty || a.opacity !== 1)) {
    // anc 容器变换（transform-origin 中心）：p' = (p - c)·s + c + t
    // 矩阵序列：T(c + t) · S(s) · T(-c)——先整体平移到中心+位移，再以原点
    // 缩放，再平移回；随后 item 绘制链的 itemCenter 与 -c 抵消，几何正确。
    // （旧序列 T(t + c(1-s))·S·T(-c)·T(itemCenter) 在 itemCenter=docCenter 时
    //   不抵消，合成内容被平移 c·s 画出画布外——过渡帧 media/three 全黑）
    const cxp = a.W / 2,
      cyp = a.H / 2;
    ctx2d.translate(cxp + (a.tx || 0), cyp + (a.ty || 0));
    ctx2d.scale(a.scale || 1, a.scale || 1);
    ctx2d.translate(-cxp, -cyp);
  }
  ctx2d.translate(it.x + it.dx + w / 2, it.y + it.dy + h / 2);
  if (it.rotation) ctx2d.rotate((it.rotation * Math.PI) / 180);
  if (it.scaleX !== 1 || it.scaleY !== 1) ctx2d.scale(it.scaleX, it.scaleY);
  ctx2d.globalAlpha =
    Math.max(0, Math.min(1, it.opacity)) * (a && a.opacity != null ? a.opacity : 1);
  if (it.radius && typeof ctx2d.roundRect === "function") {
    ctx2d.beginPath();
    ctx2d.roundRect(-w / 2, -h / 2, w, h, it.radius);
    ctx2d.clip();
  }
  if (it.video) {
    // media：object-fit 数学（contain/cover/fill）
    const v = it.video;
    const vw = v.videoWidth || 0,
      vh = v.videoHeight || 0;
    if (vw && vh) {
      let sx0 = 0,
        sy0 = 0,
        sw = vw,
        sh = vh,
        dw = it.w,
        dh = it.h,
        ox = 0,
        oy = 0;
      if (it.fit === "cover") {
        const s = Math.max(it.w / vw, it.h / vh);
        sw = it.w / s;
        sh = it.h / s;
        sx0 = (vw - sw) / 2;
        sy0 = (vh - sh) / 2;
      } else if (it.fit !== "fill") {
        // contain（默认）：完整画面居中，两侧留白
        const s = Math.min(it.w / vw, it.h / vh);
        dw = vw * s;
        dh = vh * s;
        ox = (it.w - dw) / 2;
        oy = (it.h - dh) / 2;
      }
      ctx2d.drawImage(v, sx0, sy0, sw, sh, -w / 2 + ox, -h / 2 + oy, dw, dh);
    }
  } else if (snap) {
    // three：快照位图直接绘制
    ctx2d.drawImage(snap, -w / 2, -h / 2, w, h);
  }
  ctx2d.restore();
}

/** 序列化帧 DOM 为 SVG foreignObject data URL，绘制到 canvas 上（含 three 合成）。
 *  Deterministic; waits for image decode.
 *  Notes (SVG-as-image constraints):
 *   - root element MUST carry the XHTML namespace (children inherit it);
 *   - void elements MUST be self-closed (strict XML parsing);
 *   - only data: URLs are loadable inside the isolated document (no blob:);
 *   - nested <svg> inside foreignObject is NOT painted (see inlineNestedSvgs);
 *   - viewBox transforms do NOT apply to foreignObject content (CSS scale used). */
export async function drawFrameToCanvas(node, canvas, ctx, width, height) {
  // 帧根尺寸：node.style.cssText 序列化一定是「width: 1280px」（冒号后带空格），
  // 旧正则 /width:(\d+)px/ 永不命中 → 缩放被静默跳过（原分辨率导出看不出，
  // 1080p 导出时内容 1:1 贴左上、右下全黑）。直接读 style.width/height。
  const rootW = parseFloat(node.style.width) || width;
  const rootH = parseFloat(node.style.height) || height;
  // 分辨率缩放：Chromium 的 SVG-in-img 不对 foreignObject 应用 viewBox 变换
  // （实测内容 1:1 渲染后被裁剪），改用 CSS transform 缩放——矢量内容
  // （svg-img / 文本）在目标分辨率重新栅格化，任意分辨率都清晰。
  const sx = width / rootW,
    sy = height / rootH;

  const threeItems = node.__threeItems || [];
  const mediaItems = node.__mediaItems || [];
  const units = collectUnits(node, mediaItems, threeItems);
  const hasItems = units.some((u) => u.kind === "item");

  // three 合成准备：WebGL canvas 序列化进 foreignObject 后是空白，按引擎
  // buildFrame 收集的 __threeItems（文档坐标几何/变换/透明度）直接叠加。
  // preserveDrawingBuffer=false，必须在同一任务内同步拷贝位图（await decode
  // 之后缓冲区可能已被浏览器清空），再用副本绘制。
  const snaps = threeItems.map((it) => {
    if (it.opacity <= 0.003) return null;
    const c = document.createElement("canvas");
    c.width = it.canvas.width;
    c.height = it.canvas.height;
    c.getContext("2d").drawImage(it.canvas, 0, 0);
    return c;
  });

  const clone = node.cloneNode(true);
  inlineNestedSvgs(clone);
  // <video> 在 SVG-in-img 隔离文档中不绘制（纯黑块），且 data: 大体积 src 序列化进
  // SVG 字符串既慢又可能超限——克隆中直接移除，帧画面由 __mediaItems 合成。
  for (const v of [...clone.querySelectorAll("video")]) v.remove();

  // ---- 无合成项：单段快速路径（与原行为一致）----
  if (!hasItems) {
    const html = frameHtml(clone, width, height, rootW, rootH, sx, sy);
    const img = await decodeFrame(html, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return;
  }

  // ---- 分层路径：按 DOM 顺序切段，普通段（foreignObject）+ 合成段（media/three）----
  // media/three 元素回到其在文档中的层级，而非固定压在所有元素之上。
  const cloned = units.map((u) => nodeAt(clone, nodePath(node, u.node)));
  const segments = [];
  let cur = [];
  units.forEach((u, i) => {
    if (u.kind === "item") {
      if (cur.length) {
        segments.push({ plain: cur });
        cur = [];
      }
      segments.push({ item: u.item });
    } else {
      cur.push(cloned[i]);
    }
  });
  if (cur.length) segments.push({ plain: cur });

  const tmpl = document.createElement("div");
  tmpl.className = "vd-frame";
  tmpl.style.cssText = node.style.cssText;
  tmpl.style.background = "transparent"; // 背景由含 .vd-bg 的段绘制，避免盖住过渡 crossfade

  // 各段先序列化（同步），再并行 decode，最后按序绘制（段序即覆盖序）
  const htmls = segments.map((seg) => {
    if (seg.item) return null;
    rebuildWrapped(tmpl, seg.plain, clone);
    const html = frameHtml(tmpl, width, height, rootW, rootH, sx, sy);
    tmpl.replaceChildren();
    return html;
  });
  const imgs = await Promise.all(
    htmls.map((h) => (h ? decodeFrame(h, width, height) : null)),
  );
  segments.forEach((seg, i) => {
    if (seg.item) {
      const ti = threeItems.indexOf(seg.item);
      drawItemCompose(ctx, seg.item, sx, sy, ti >= 0 ? snaps[ti] : null);
    } else {
      ctx.drawImage(imgs[i], 0, 0, width, height);
    }
  });
}

/** Preload every asset URL (data:) into the browser image cache so frames
 *  referencing them render synchronously inside the isolated SVG document. */
async function preloadAssets(assetMap) {
  const urls = Object.values(assetMap || {}).filter((u) => /^data:/i.test(u));
  await Promise.all(
    urls.map(
      (u) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = i.onerror = res;
          i.src = u;
        }),
    ),
  );
}

function checkAbort(signal) {
  if (signal && signal.aborted) {
    const e = new Error("export cancelled");
    e.name = "AbortError";
    throw e;
  }
}

/** 编码混音进 muxer：AAC 一次性喂入；Opus 有帧长限制按 20ms(960 帧) 分块。
 *  返回 false = 当前浏览器不支持该音频编码（静默跳过音轨） */
async function encodeAudioToMuxer(mix, muxer, codec) {
  let ok = false;
  try {
    if (typeof AudioEncoder !== "undefined" && AudioEncoder.isConfigSupported) {
      const sup = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
      ok = !!sup.supported;
    } else {
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) return false;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  enc.configure({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
  const total = mix.length;
  const L = mix.getChannelData(0),
    R = mix.getChannelData(1);
  if (codec === "opus") {
    const CHUNK = 960; // 20ms @48k
    for (let off = 0; off < total; off += CHUNK) {
      const n = Math.min(CHUNK, total - off);
      const planar = new Float32Array(n * 2);
      planar.set(L.subarray(off, off + n), 0);
      planar.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data: planar });
      enc.encode(ad);
      ad.close();
    }
  } else {
    const planar = new Float32Array(total * 2);
    planar.set(L, 0);
    planar.set(R, total);
    const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: total, numberOfChannels: 2, timestamp: 0, data: planar });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  return true;
}

/**
 * Export the engine's document to a video/audio Blob.
 * opts: { format: 'mp4'|'webm'|'webm-vp8'|'wav' (默认 mp4),
 *         width, height, fps, totalFrames,
 *         quality: 'low'|'medium'|'high' 或 bitrate Mbps/bps 数字,
 *         onProgress({phase,pct,frame,total}), signal }
 */
export async function exportVideo(engine, opts = {}) {
  const { onProgress = () => {}, signal } = opts;
  const format = EXPORT_FORMATS[opts.format] ? opts.format : "mp4";
  const width = opts.width || engine.doc.size.width;
  const height = opts.height || engine.doc.size.height;
  const fps = opts.fps || engine.doc.fps;
  // 总帧数按导出 fps 重算：文档帧数是 doc.fps 语义（buildFrame 参数），
  // 而视频时间戳/音频时长都按导出 fps 走——直接用文档帧数会导致 60fps 导出
  // 时长减半、音频只混前半段（用户实测：60hz 导出短一半、声音只有前一半）。
  const docFps = engine.doc.fps || fps;
  const durationSec = engine.doc.totalFrames / docFps;
  const totalFrames = opts.totalFrames || Math.max(1, Math.round(durationSec * fps));
  const fmt = EXPORT_FORMATS[format];

  onProgress({ phase: "setup", pct: 0, frame: 0, total: totalFrames });

  // ---- 纯音频路径：WAV ----
  if (format === "wav") {
    onProgress({ phase: "audio", pct: 30, frame: 0, total: totalFrames });
    const mix = await engine.renderAudioMix(totalFrames / fps);
    if (!mix) throw new Error("文档没有可导出的音轨（音乐 / 配音 / 未静音媒体）");
    checkAbort(signal);
    onProgress({ phase: "done", pct: 100, frame: totalFrames, total: totalFrames });
    return audioBufferToWav(mix);
  }

  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge 导出视频");
  }

  await preloadAssets(engine.assets);
  if (engine.prepare) await engine.prepare(); // 懒加载 three 渲染器

  const isWebm = format === "webm" || format === "webm-vp8";
  const codec = videoCodecFor(format, width, height);
  const bitrate = estimateBitrate(width, height, fps, opts.bitrate != null ? +opts.bitrate : (opts.quality || "medium"));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const hasAudio = engine.audioTracks().length > 0;
  const muxer = isWebm
    ? new WebmMuxer({
        target: new WebmArrayBufferTarget(),
        video: { codec: format === "webm" ? "V_VP9" : "V_VP8", width, height },
        ...(hasAudio ? { audio: { codec: "A_OPUS", sampleRate: SR, numberOfChannels: 2 } } : {}),
      })
    : new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width, height },
        ...(hasAudio ? { audio: { codec: "aac", sampleRate: SR, numberOfChannels: 2 } } : {}),
        fastStart: "in-memory",
      });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
  });

  // ---- video track: deterministic frames ----
  const BATCH = 24;
  // 预热 media 池元素（解码缓存共享，逐帧 seek 快），并等待全部就绪：
  // 窗口外元素首次出现在切换帧，data URL 加载未完成时该帧黑屏（导出闪烁）
  prepareMedia(engine.doc, engine.assets);
  await waitMediaReady();
  for (let f = 0; f < totalFrames; f++) {
    checkAbort(signal);
    // 导出帧号 → 文档帧号（doc.fps 语义）：60fps 导出 200 帧映射到 30fps 文档的 0..99
    const docFrame = Math.min(
      engine.doc.totalFrames - 1,
      Math.floor((f * docFps) / fps),
    );
    const node = engine.buildFrame(docFrame, { forExport: true });
    await waitMediaSeek(node);
    await drawFrameToCanvas(node, canvas, ctx, width, height);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f / fps) * 1e6) });
    encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    if (f % BATCH === 0) {
      onProgress({
        phase: "frames",
        pct: Math.round((f / totalFrames) * 100),
        frame: f,
        total: totalFrames,
      });
      await sleep(0); // keep UI responsive
    }
  }
  onProgress({ phase: "frames", pct: 100, frame: totalFrames, total: totalFrames });

  // ---- audio track: OfflineAudioContext mix → AAC/Opus (skip if unsupported) ----
  if (hasAudio) {
    const mix = await engine.renderAudioMix(totalFrames / fps);
    if (mix) {
      checkAbort(signal);
      onProgress({ phase: "audio", pct: 100, frame: totalFrames, total: totalFrames });
      const audioOk = await encodeAudioToMuxer(mix, muxer, isWebm ? "opus" : "mp4a.40.2");
      if (!audioOk) onProgress({ phase: "audio-skip", pct: 100, frame: totalFrames, total: totalFrames });
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buffer = muxer.target.buffer;
  onProgress({ phase: "done", pct: 100, frame: totalFrames, total: totalFrames });
  return new Blob([buffer], { type: fmt.mime });
}
