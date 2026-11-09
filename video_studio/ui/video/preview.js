/*
 * Stable DOM preview renderer.
 *
 * Export still uses engine.buildFrame(): a fresh, deterministic tree per frame.
 * Preview keeps the current scene mounted and patches only time-dependent
 * properties. This avoids recreating text, images, SVG and layout on every rAF.
 */
import {
  cameraCss,
  cameraState,
  captionsAt,
  clamp,
  easing,
  easingOf,
  elDurOf,
  elementState,
  frameToScene,
  mediaTimeLt,
  renderElement,
} from "./engine.js";

const TRANSITION_ENTER = {
  fade: { opacity: [0, 1] },
  "slide-left": { dx: [-80, 0] },
  "slide-right": { dx: [80, 0] },
  "slide-up": { dy: [60, 0] },
  "slide-down": { dy: [-60, 0] },
  zoom: { scale: [0.92, 1] },
  iris: { scale: [1.15, 1] },
};

function setStyle(node, key, value) {
  if (node.style[key] !== value) node.style[key] = value;
}

function fieldsFor(doc, f, gframe) {
  return {
    page: f.index + 1,
    pages: doc.scenes.length,
    title: doc.title,
    frame: gframe,
    time: gframe / doc.fps,
    progress: doc.totalFrames ? gframe / doc.totalFrames : 0,
    sframe: f.localFrame,
    stime: f.localT,
    sprogress: f.progress,
  };
}

function backgroundNode(scene, doc, previous = false) {
  const node = document.createElement("div");
  node.className = previous ? "vd-bg-prev" : "vd-bg";
  node.style.cssText =
    `position:absolute;left:0;top:0;width:100%;height:100%;background:${scene.background || doc.theme.background};`;
  return node;
}

function contentNode() {
  const node = document.createElement("div");
  node.className = "vd-content";
  node.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:center;";
  return node;
}

function isAnimated(el) {
  return !!(
    el.fx || el.keyframes || el.stagger || el.reveal || el.draw || el.sheen ||
    (el.option && el.option.draw) || (el.html && el.html.indexOf("{{") >= 0)
  );
}

export class PreviewFrame {
  constructor(doc, assetMap = {}) {
    this.doc = doc;
    this.assetMap = assetMap;
    this.root = null;
    this.content = null;
    this.bgPrev = null;
    this.caption = null;
    this.records = [];
    this.overlayRecords = [];
    this.key = "";
  }

  makeRecord(el, ctx) {
    const node = renderElement(el, this.doc, ctx);
    if (isAnimated(el)) node.style.willChange = "transform,opacity";
    const record = {
      el,
      node,
      display: node.style.display,
      spans: null,
      paths: null,
      staggerEase: null,
      revealEase: null,
      drawEase: null,
    };
    if (el.type === "text" && el.stagger && !/<[a-z]/i.test(el.html || "")) {
      record.spans = Array.from(node.querySelectorAll("span"));
      record.staggerEase = easingOf(el.stagger.easing || "spring(13,170,0.9)");
    }
    if (el.reveal) record.revealEase = easingOf(el.reveal.easing || "bezier(0.16,1,0.3,1)");
    if (el.type === "svg" && el.draw) {
      record.paths = Array.from(node.querySelectorAll("path")).filter((p) =>
        p.getAttribute("pathLength") === "1" && p.getAttribute("stroke-dasharray") === "1"
      );
      record.drawEase = easingOf(el.draw.easing || "bezier(0.65,0,0.35,1)");
    }
    return record;
  }

  rebuild(f, inTransition) {
    const doc = this.doc;
    const scene = f.scene;
    const root = document.createElement("div");
    root.className = "vd-frame";
    root.style.cssText =
      `position:relative;overflow:hidden;width:${doc.size.width}px;height:${doc.size.height}px;` +
      `background:${scene.background || doc.theme.background};`;

    this.bgPrev = null;
    if (inTransition) {
      this.bgPrev = backgroundNode(doc.scenes[f.index - 1], doc, true);
      root.appendChild(this.bgPrev);
    }
    root.appendChild(backgroundNode(scene, doc));

    this.content = contentNode();
    root.appendChild(this.content);
    this.records = [];
    this.overlayRecords = [];

    const gframe = clamp(Math.floor(f.start + f.localFrame), 0, Math.max(0, doc.totalFrames - 1));
    const fields = fieldsFor(doc, f, gframe);
    if (!scene.hidden) {
      const els = (scene.elements || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
      els.forEach((el) => {
        const lt = f.localT - Math.max(0, +el.start || 0);
        const dur = elDurOf(el, scene.duration);
        const ctx = {
          t: lt,
          state: elementState(el, dur, lt),
          assetMap: this.assetMap,
          fields,
          fps: doc.fps,
        };
        const record = this.makeRecord(el, ctx);
        this.records.push(record);
        this.content.appendChild(record.node);
      });
    }

    if (doc.overlay && doc.overlay.length) {
      const overlay = contentNode();
      overlay.className = "vd-overlay";
      overlay.style.pointerEvents = "none";
      const totalDur = doc.totalFrames / doc.fps;
      doc.overlay.slice().sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((el) => {
        const lt = gframe / doc.fps - Math.max(0, +el.start || 0);
        const ctx = {
          t: lt,
          state: elementState(el, elDurOf(el, totalDur), lt),
          assetMap: this.assetMap,
          fields,
          fps: doc.fps,
        };
        const record = this.makeRecord(el, ctx);
        this.overlayRecords.push(record);
        overlay.appendChild(record.node);
      });
      root.appendChild(overlay);
    }

    this.caption = document.createElement("div");
    this.caption.className = "vd-caption";
    const cs = doc.theme.captionStyle || {};
    this.caption.style.cssText =
      `position:absolute;left:0;right:0;bottom:${cs.bottom != null ? cs.bottom : 64}px;margin:0 auto;width:fit-content;` +
      `max-width:84%;font-size:${cs.fontSize || 40}px;font-family:${doc.theme.fontFamily};` +
      `color:${cs.color || "#fff"};text-align:center;line-height:1.35;` +
      `padding:${cs.paddingY || 8}px ${cs.paddingX || 18}px;border-radius:${cs.radius || 10}px;` +
      `background:${cs.background || "rgba(0,0,0,0.45)"};display:none;` +
      (cs.stroke ? `-webkit-text-stroke:${cs.strokeWidth || 3}px ${cs.stroke};paint-order:stroke fill;text-shadow:0 2px 6px rgba(0,0,0,.5);` : "");
    root.appendChild(this.caption);
    this.root = root;
  }

  patchStagger(record, t) {
    const st = record.el.stagger || {};
    const by = st.by || "char";
    const step = st.step != null ? +st.step : 0.06;
    const delay = +st.delay || 0;
    const dur = +st.dur || 0.8;
    const dy = st.dy != null ? +st.dy : 60;
    const dx = +st.dx || 0;
    const rot = +st.rotation || 0;
    const scaleFrom = st.scaleFrom != null ? +st.scaleFrom : null;
    let vi = 0;
    record.spans.forEach((span) => {
      // Word whitespace is rendered as text, not as a span.
      if (by === "word" && span.textContent === " ") return;
      const local = clamp((t - delay - vi * step) / dur, 0, 1);
      vi += 1;
      const p = record.staggerEase(local);
      const op = clamp(p / 0.35, 0, 1);
      const tx = (1 - p) * dx;
      const ty = (1 - p) * dy;
      const ro = rot ? (1 - p) * rot * ((vi - 1) % 2 === 0 ? 1 : -1) : 0;
      const sc = scaleFrom != null ? scaleFrom + (1 - scaleFrom) * p : 1;
      setStyle(span, "opacity", op.toFixed(3));
      setStyle(span, "transform", `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${ro.toFixed(2)}deg) scale(${sc.toFixed(3)})`);
    });
  }

  patchSheen(record, t) {
    const sh = record.el.sheen;
    if (!sh || record.el.type === "media" || record.el.type === "three") return;
    let stripe = record.node.querySelector(":scope > .vd-sheen");
    const width = (+sh.width || 0.35) * 100;
    if (!stripe) {
      stripe = document.createElement("div");
      stripe.className = "vd-sheen";
      stripe.style.cssText =
        `position:absolute;top:-20%;bottom:-20%;left:-40%;width:${width}%;pointer-events:none;` +
        `background:linear-gradient(90deg,transparent,${sh.color || "rgba(255,255,255,0.35)"},transparent);`;
      record.node.appendChild(stripe);
    }
    setStyle(stripe, "left", "-40%");
    setStyle(stripe, "width", `${width}%`);
    const start = +sh.t || 0;
    const dur = +sh.dur || 0.9;
    const lt = t - start;
    setStyle(stripe, "display", lt >= 0 && lt <= dur ? "block" : "none");
    if (lt < 0 || lt > dur) return;
    const p = lt / dur;
    const travel = (180 / width) * 100;
    const skew = -(sh.angle != null ? +sh.angle : 20);
    setStyle(stripe, "transform", `translateX(${(p * travel).toFixed(2)}%) skewX(${skew}deg)`);
    record.node.style.overflow = "hidden";
  }

  patchRecord(record, containerDur, sceneT, ctx, opts) {
    const { el, node } = record;
    const start = Math.max(0, +el.start || 0);
    const dur = elDurOf(el, containerDur);
    const lt = sceneT - start;
    if (el.hidden || lt < 0 || lt >= dur) {
      setStyle(node, "visibility", "hidden");
      setStyle(node, "opacity", "0");
      return;
    }
    const state = elementState(el, dur, lt);
    if (state.opacity <= 0.003) {
      setStyle(node, "visibility", "hidden");
      setStyle(node, "opacity", "0");
      return;
    }
    setStyle(node, "display", record.display);
    setStyle(node, "visibility", "visible");
    const sy = state.scaleY != null ? state.scaleY : state.scale;
    setStyle(node, "transform", `translate(${state.dx}px,${state.dy}px) rotate(${state.rotation}deg) scale(${state.scale},${sy})`);
    setStyle(node, "opacity", String(clamp(state.opacity, 0, 1)));
    setStyle(node, "filter", state.blur > 0 ? `blur(${state.blur}px)` : "");

    const nextCtx = Object.assign({}, ctx, { t: lt, state });
    if (el.type === "text") {
      if (record.spans) this.patchStagger(record, lt);
      else if ((el.html && el.html.indexOf("{{") >= 0) || (el.fx && el.fx.countUp)) {
        // Dynamic HUD/count-up text is uncommon; keep the outer node stable and
        // refresh only its content instead of rebuilding the whole frame.
        const fresh = renderElement(el, this.doc, nextCtx);
        node.innerHTML = fresh.innerHTML;
      }
      if (el.reveal) {
        const rv = el.reveal;
        const duration = +rv.dur || 0.7;
        const delay = +rv.delay || 0;
        const p = record.revealEase(clamp((lt - delay) / duration, 0, 1));
        const dir = rv.dir || "up";
        const tx = dir === "left" ? 110 * (1 - p) : dir === "right" ? -110 * (1 - p) : 0;
        const ty = dir === "up" ? 110 * (1 - p) : dir === "down" ? -110 * (1 - p) : 0;
        const inner = node.firstElementChild && node.firstElementChild.firstElementChild;
        if (inner) setStyle(inner, "transform", `translate(${tx.toFixed(2)}%,${ty.toFixed(2)}%)`);
      }
    } else if (el.type === "svg" && record.paths) {
      const d = el.draw || {};
      const p = clamp((lt - (+d.delay || 0)) / (+d.dur || 1.5), 0, 1);
      const offset = (1 - record.drawEase(p)).toFixed(4);
      record.paths.forEach((path) => path.setAttribute("stroke-dashoffset", offset));
    } else if (el.type === "chart" && el.option && el.option.draw) {
      const fresh = renderElement(el, this.doc, nextCtx);
      node.innerHTML = fresh.innerHTML;
    } else if (el.type === "media" && el.kind !== "audio" && !opts.liveMedia) {
      const video = node.querySelector("video");
      if (video) {
        let mt = mediaTimeLt(el, lt);
        if (el.loop && (el.trimEnd == null || el.trimEnd < 0) && video.duration > 0) {
          const ts = +el.trimStart || 0;
          const len = video.duration - ts;
          if (len > 0) mt = ts + (((lt % len) + len) % len);
        }
        video._vdT = mt;
        if (video.readyState >= 1 && Math.abs((video.currentTime || 0) - mt) > 0.001) {
          video._vdDirty = true;
          video.currentTime = mt;
        }
      }
    } else if (el.type === "three") {
      // The 3D renderer owns and reuses its canvas; renderElement advances its
      // deterministic frame while the outer element remains mounted.
      const fresh = renderElement(el, this.doc, nextCtx);
      node.replaceChildren(...Array.from(fresh.childNodes));
    }
    this.patchSheen(record, lt);
  }

  render(frame, opts = {}) {
    const doc = this.doc;
    const f = frameToScene(doc, frame);
    const gframe = clamp(Math.floor(frame), 0, Math.max(0, doc.totalFrames - 1));
    const tin = f.scene.transitionIn || 0;
    const inTransition = f.index > 0 && tin > 0 && f.localT < tin;
    const key = `${f.index}:${inTransition ? "enter" : "steady"}`;
    if (!this.root || key !== this.key) {
      this.key = key;
      this.rebuild(f, inTransition);
    }
    this.root.setAttribute("data-frame", String(gframe));

    const fields = fieldsFor(doc, f, gframe);
    const ctx = { assetMap: this.assetMap, fields, fps: doc.fps };
    this.records.forEach((record) => this.patchRecord(record, f.scene.duration, f.localT, ctx, opts));
    const totalDur = doc.totalFrames / doc.fps;
    this.overlayRecords.forEach((record) => this.patchRecord(record, totalDur, gframe / doc.fps, ctx, opts));

    const cam = cameraState(f.scene, f.localT);
    const hasCam = cam.x !== 0 || cam.y !== 0 || cam.zoom !== 1 || cam.rotation !== 0;
    if (inTransition) {
      const p = clamp(f.localT / tin, 0, 1);
      const e = easing.easeInOut(p);
      const def = TRANSITION_ENTER[f.scene.transition] || TRANSITION_ENTER.fade;
      const tx = def.dx ? def.dx[0] + (def.dx[1] - def.dx[0]) * e : 0;
      const ty = def.dy ? def.dy[0] + (def.dy[1] - def.dy[0]) * e : 0;
      const sc = def.scale ? def.scale[0] + (def.scale[1] - def.scale[0]) * e : 1;
      const op = def.opacity ? def.opacity[0] + (def.opacity[1] - def.opacity[0]) * e : 1;
      let transform = "";
      if (def.dx) transform += `translateX(${tx}px) `;
      if (def.dy) transform += `translateY(${ty}px) `;
      if (def.scale) transform += `scale(${sc}) `;
      if (hasCam) transform += cameraCss(cam);
      setStyle(this.content, "transform", transform);
      setStyle(this.content, "opacity", String(op));
      setStyle(this.bgPrev, "opacity", String(1 - e));
    } else {
      setStyle(this.content, "transform", hasCam ? cameraCss(cam) : "");
      setStyle(this.content, "opacity", "1");
    }

    const cap = captionsAt(f.scene, f.localT);
    setStyle(this.caption, "display", cap ? "block" : "none");
    if (cap && this.caption.textContent !== cap.text) this.caption.textContent = cap.text;
    return this.root;
  }
}
