/*
 * ppt.js — dependency-free HTML slide deck viewer / presenter / editor.
 * Headless engine, ES module:
 *
 *   import PPT from './ppt.js'
 *   const ppt = new PPT('#app', { doc, mode: 'edit', onChange: d => save(d) })
 *
 * The engine renders ONLY the body of each mode:
 *   edit    — thumbnails + canvas (selection, drag/resize, inline text edit)
 *   view    — scaled stage + prev/next nav
 *   present — fullscreen overlay (morph transitions, entrance fx)
 *
 * It ships NO toolbar, injects NO CSS and mounts NOTHING on window.
 * Chrome (toolbar, buttons, menus) is the host's job, driven through the
 * public editing API and the 'statechange' event; all .ppt-* styling is
 * provided by the host stylesheet. Slide look & motion come from the JSON doc.
 *
 * The document format is a JSON object:
 *   { format, version, title, size:{width,height}, theme:{...},
 *     slides:[{ id, background, transition, notes, elements:[...] }] }
 *
 * Element types: text, shape (rect/ellipse/triangle/arrow/line/path),
 * image, svg, table, chart (bar/line/pie/scatter subset), media (video/audio).
 */

const VERSION = "2.0.0";

/* ---------------------------------------------------------------- utils */

let uidCounter = 0;
function uid() {
  return (
    "e" +
    Date.now().toString(36) +
    (uidCounter++).toString(36) +
    Math.floor(Math.random() * 1e6).toString(36)
  );
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Sanitize rich-text HTML: keep a small inline whitelist, drop every
 *  attribute except a filtered style (no scripts, handlers, or links). */
const INLINE_TAGS = {
  B: 1,
  STRONG: 1,
  I: 1,
  EM: 1,
  U: 1,
  S: 1,
  BR: 1,
  SPAN: 1,
  DIV: 1,
  P: 1,
  CODE: 1,
  SMALL: 1,
  SUB: 1,
  SUP: 1,
};
const STYLE_OK = {
  color: 1,
  "background-color": 1,
  "font-weight": 1,
  "font-style": 1,
  "text-decoration": 1,
  "text-decoration-line": 1,
};
function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "");
  cleanNode(tpl.content);
  return tpl.innerHTML;
}
function cleanNode(root) {
  let n = root.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (n.nodeType === 1) {
      if (!INLINE_TAGS[n.tagName]) {
        // unwrap: clean children, keep them, drop the tag itself
        cleanNode(n);
        while (n.firstChild) root.insertBefore(n.firstChild, n);
        root.removeChild(n);
      } else {
        // strip all attributes except a filtered style
        const style = n.getAttribute("style") || "";
        while (n.attributes.length) n.removeAttribute(n.attributes[0].name);
        if (n.tagName === "SPAN" && style) {
          const kept = style
            .split(";")
            .map(function (d) {
              const p = d.split(":");
              return p.length === 2 && STYLE_OK[p[0].trim().toLowerCase()]
                ? d.trim()
                : "";
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

/** Best-effort #rrggbb for color inputs (they can't show rgba/names). */
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
        .map(function (v) {
          return (+v).toString(16).padStart(2, "0");
        })
        .join("")
    );
  }
  return null;
}

/* ------------------------------------------------------- doc: defaults */

const DEFAULT_PALETTE = [
  "#3a6ff7",
  "#f0773a",
  "#3abf7c",
  "#b04ad9",
  "#d9a53a",
  "#3ab0c9",
];

function defaultTheme() {
  return {
    background: "#ffffff",
    color: "#1f2430",
    accent: "#3a6ff7",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    chartPalette: DEFAULT_PALETTE.slice(),
  };
}

function blankSlide(theme) {
  return {
    id: uid(),
    background: (theme && theme.background) || "#ffffff",
    transition: "morph",
    notes: "",
    elements: [],
  };
}

/** A neutral starter document — no branding, just the format's idioms. */
function starterDoc() {
  const theme = defaultTheme();
  const s1 = blankSlide(theme);
  s1.transition = "fade";
  s1.elements.push(
    {
      id: "title",
      type: "text",
      x: 80,
      y: 200,
      w: 800,
      h: 90,
      rotation: 0,
      opacity: 1,
      html: "Presentation",
      fontSize: 64,
      fontFamily: theme.fontFamily,
      fontWeight: 700,
      color: theme.color,
      align: "center",
      valign: "middle",
      lineHeight: 1.1,
    },
    {
      id: "sub",
      type: "text",
      x: 180,
      y: 310,
      w: 600,
      h: 44,
      rotation: 0,
      opacity: 1,
      html: "Edit me, then press Present",
      fontSize: 22,
      fontFamily: theme.fontFamily,
      fontWeight: 400,
      color: "#6b7280",
      align: "center",
      valign: "middle",
      lineHeight: 1.3,
    },
  );
  const s2 = blankSlide(theme);
  s2.elements.push(
    {
      id: "title",
      type: "text",
      x: 60,
      y: 40,
      w: 600,
      h: 60,
      rotation: 0,
      opacity: 1,
      html: "Second slide",
      fontSize: 40,
      fontFamily: theme.fontFamily,
      fontWeight: 700,
      color: theme.color,
      align: "left",
      valign: "middle",
      lineHeight: 1.1,
    },
    {
      id: "box",
      type: "shape",
      shape: "rect",
      x: 60,
      y: 150,
      w: 220,
      h: 140,
      rotation: 0,
      opacity: 1,
      fill: theme.accent,
      stroke: "",
      strokeWidth: 0,
      radius: 12,
    },
  );
  return {
    format: "ppt/1",
    version: 1,
    title: "Untitled deck",
    size: { width: 960, height: 540 },
    theme: theme,
    slides: [s1, s2],
  };
}

/** JSON.parse with position → line/column mapping, for readable syntax errors. */
function parseJsonVerbose(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    const m = /position\s+(\d+)/i.exec(msg);
    if (m) {
      const pos = parseInt(m[1], 10);
      const head = String(text).slice(0, pos);
      const line = head.split("\n").length;
      const col = pos - (head.lastIndexOf("\n") + 1) + 1;
      const lineText = String(text).split("\n")[line - 1] || "";
      throw new Error(
        (label || "Invalid JSON") +
          ": line " +
          line +
          " col " +
          col +
          " (" +
          msg +
          ")\n" +
          lineText +
          "\n" +
          " ".repeat(Math.max(0, col - 1)) +
          "^",
      );
    }
    throw new Error((label || "Invalid JSON") + ": " + msg);
  }
}

/** Accept an object or JSON string; fill every default the renderers need. */
function normalizeDoc(input) {
  const doc =
    typeof input === "string"
      ? parseJsonVerbose(input, "Invalid deck JSON")
      : deepClone(input || {});
  doc.format = doc.format || "ppt/1";
  doc.version = doc.version || 1;
  doc.title = doc.title || "Untitled deck";
  doc.size =
    doc.size && doc.size.width ? doc.size : { width: 960, height: 540 };
  doc.theme = Object.assign(defaultTheme(), doc.theme || {});
  if (!doc.theme.chartPalette || !doc.theme.chartPalette.length)
    doc.theme.chartPalette = DEFAULT_PALETTE.slice();
  doc.slides =
    Array.isArray(doc.slides) && doc.slides.length
      ? doc.slides
      : [blankSlide(doc.theme)];
  doc.slides.forEach(function (s) {
    s.id = s.id || uid();
    s.background = s.background || doc.theme.background;
    s.transition = s.transition || "morph";
    s.notes = s.notes || "";
    s.elements = Array.isArray(s.elements) ? s.elements : [];
    s.elements.forEach(function (el) {
      el.id = el.id || uid();
      el.x = +el.x || 0;
      el.y = +el.y || 0;
      el.w = +el.w || 100;
      el.h = +el.h || 60;
      el.rotation = +el.rotation || 0;
      el.opacity = el.opacity == null ? 1 : +el.opacity;
    });
  });
  return doc;
}

function resolveAsset(doc, ref) {
  return typeof ref === "string" && ref.indexOf("asset:") === 0
    ? (doc.assets || {})[ref.slice(6)] || ""
    : ref;
}

function morphKeyOf(el) {
  return el.morphId || el.id;
}

/* -------------------------------------------------------- element render */

function baseBoxCss(el) {
  let s =
    "left:" +
    el.x +
    "px;top:" +
    el.y +
    "px;width:" +
    el.w +
    "px;height:" +
    el.h +
    "px;";
  if (el.rotation) s += "transform:rotate(" + el.rotation + "deg);";
  if (el.opacity !== 1) s += "opacity:" + el.opacity + ";";
  const filt = [];
  if (el.shadow) {
    const arr = Array.isArray(el.shadow) ? el.shadow : [el.shadow];
    arr.forEach(function (sh) {
      filt.push(
        "drop-shadow(" +
          (sh.x || 0) +
          "px " +
          (sh.y || 0) +
          "px " +
          (sh.blur || 8) +
          "px " +
          (sh.color || "rgba(0,0,0,.3)") +
          ")",
      );
    });
  }
  if (el.blur) filt.push("blur(" + el.blur + "px)");
  if (filt.length) s += "filter:" + filt.join(" ") + ";";
  if (el.blend) s += "mix-blend-mode:" + el.blend + ";";
  if (el.backdropFilter)
    s +=
      "backdrop-filter:blur(" +
      el.backdropFilter +
      "px);-webkit-backdrop-filter:blur(" +
      el.backdropFilter +
      "px);";
  return s;
}

function gradientCss(g, fallback) {
  if (!g || !g.stops || !g.stops.length) return fallback || "none";
  const stops = g.stops
    .map(function (st) {
      return st.color + " " + Math.round((st.at || 0) * 100) + "%";
    })
    .join(",");
  return (
    "linear-gradient(" + (g.angle == null ? 90 : g.angle) + "deg," + stops + ")"
  );
}

let gradientSeq = 0;
function svgFillAttrs(el) {
  // returns {fill, defs} — defs carries a linearGradient when fillGradient set
  if (
    el.fillGradient &&
    el.fillGradient.stops &&
    el.fillGradient.stops.length
  ) {
    const gid = "pptg" + ++gradientSeq;
    const stops = el.fillGradient.stops
      .map(function (st) {
        return (
          '<stop offset="' +
          (st.at || 0) * 100 +
          '%" stop-color="' +
          escapeHtml(st.color) +
          '"/>'
        );
      })
      .join("");
    return {
      fill: "url(#" + gid + ")",
      defs:
        '<defs><linearGradient id="' +
        gid +
        '" gradientTransform="rotate(' +
        ((el.fillGradient.angle || 0) - 90) +
        ' 0.5 0.5)">' +
        stops +
        "</linearGradient></defs>",
    };
  }
  return { fill: el.fill || "none", defs: "" };
}

function strokeAttrs(el) {
  let s =
    'stroke="' +
    (el.stroke || "none") +
    '" stroke-width="' +
    (el.strokeWidth || 0) +
    '"';
  const style = el.strokeStyle;
  if (style === "dashed")
    s +=
      ' stroke-dasharray="' +
      (el.strokeWidth || 2) * 3 +
      " " +
      (el.strokeWidth || 2) * 2 +
      '"';
  else if (style === "dotted")
    s +=
      ' stroke-dasharray="0 ' +
      (el.strokeWidth || 2) * 2.2 +
      '" stroke-linecap="round"';
  else if (el.strokeDash)
    s += ' stroke-dasharray="' + el.strokeDash + " " + el.strokeDash + '"';
  return s;
}

function lineMarkers(el, sw) {
  // marker defs + attrs for line endings (arrow/dot/bar)
  let defs = "",
    attrs = "";
  const kinds = { start: el.lineStart, end: el.lineEnd };
  ["start", "end"].forEach(function (which) {
    const k = kinds[which];
    if (!k || k === "none") return;
    const mid = "pptm" + ++gradientSeq;
    let body = "";
    if (k === "arrow")
      body =
        '<path d="M0,0L10,5L0,10Z" fill="' +
        escapeHtml(el.stroke || "#000") +
        '"/>';
    else if (k === "dot")
      body =
        '<circle cx="5" cy="5" r="4" fill="' +
        escapeHtml(el.stroke || "#000") +
        '"/>';
    else if (k === "bar")
      body =
        '<rect x="4" y="0" width="2.4" height="10" fill="' +
        escapeHtml(el.stroke || "#000") +
        '"/>';
    defs +=
      '<marker id="' +
      mid +
      '" viewBox="0 0 10 10" refX="' +
      (which === "end" ? 9 : 1) +
      '" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="strokeWidth">' +
      body +
      "</marker>";
    attrs += " marker-" + which + '="url(#' + mid + ')"';
  });
  return { defs: defs, attrs: attrs };
}

function renderShape(el) {
  const f = svgFillAttrs(el);
  const stroke = strokeAttrs(el);
  const sw = el.strokeWidth || 0;
  const pad = sw / 2;
  const w = Math.max(el.w, 1),
    h = Math.max(el.h, 1);
  let body = "";
  const viewBox = "0 0 " + w + " " + h;
  const kind = el.shape || "rect";
  if (kind === "rect") {
    body =
      '<rect x="' +
      pad +
      '" y="' +
      pad +
      '" width="' +
      Math.max(w - sw, 0.1) +
      '" height="' +
      Math.max(h - sw, 0.1) +
      '" rx="' +
      (el.radius || 0) +
      '" fill="' +
      f.fill +
      '" ' +
      stroke +
      "/>";
  } else if (kind === "ellipse") {
    body =
      '<ellipse cx="' +
      w / 2 +
      '" cy="' +
      h / 2 +
      '" rx="' +
      Math.max(w / 2 - pad, 0.1) +
      '" ry="' +
      Math.max(h / 2 - pad, 0.1) +
      '" fill="' +
      f.fill +
      '" ' +
      stroke +
      "/>";
  } else if (kind === "triangle") {
    body =
      '<polygon points="' +
      w / 2 +
      "," +
      pad +
      " " +
      (w - pad) +
      "," +
      (h - pad) +
      " " +
      pad +
      "," +
      (h - pad) +
      '" fill="' +
      f.fill +
      '" ' +
      stroke +
      "/>";
  } else if (kind === "arrow") {
    const a = h * 0.32,
      b = h * 0.68,
      head = Math.min(w * 0.45, h * 0.9);
    body =
      '<polygon points="0,' +
      a +
      " " +
      (w - head) +
      "," +
      a +
      " " +
      (w - head) +
      ",0 " +
      w +
      "," +
      h / 2 +
      " " +
      (w - head) +
      "," +
      h +
      " " +
      (w - head) +
      "," +
      b +
      " 0," +
      b +
      '" fill="' +
      f.fill +
      '" ' +
      stroke +
      "/>";
  } else if (kind === "line") {
    const m = lineMarkers(el, sw);
    body =
      '<line x1="' +
      pad +
      '" y1="' +
      h / 2 +
      '" x2="' +
      (w - pad) +
      '" y2="' +
      h / 2 +
      '" ' +
      stroke +
      m.attrs +
      "/>";
    return (
      '<svg width="100%" height="100%" viewBox="' +
      viewBox +
      '" preserveAspectRatio="none"><defs>' +
      m.defs +
      "</defs>" +
      body +
      "</svg>"
    );
  } else if (kind === "path" && el.d) {
    const m2 = lineMarkers(el, sw);
    const vb = el.pathBox ? el.pathBox.join(" ") : viewBox;
    return (
      '<svg width="100%" height="100%" viewBox="' +
      vb +
      '" preserveAspectRatio="none"><defs>' +
      m2.defs +
      '</defs><path d="' +
      escapeHtml(el.d) +
      '" fill="' +
      f.fill +
      '" ' +
      stroke +
      m2.attrs +
      "/></svg>"
    );
  }
  return (
    '<svg width="100%" height="100%" viewBox="' +
    viewBox +
    '" preserveAspectRatio="none">' +
    f.defs +
    body +
    "</svg>"
  );
}

function fmtNum(v) {
  const r = Math.round(v * 10) / 10;
  return Math.abs(r) >= 1000 ? String(Math.round(r)) : String(r);
}

/** Minimal chart renderer: bar / line / scatter / pie from an ECharts-flavoured
 *  {xAxis:{data}, series:[{type,name,data}], color} option. Static SVG. */
function renderChart(el, doc) {
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
    const vals = data.map(function (d) {
      return typeof d === "object" && d !== null ? +d.value || 0 : +d || 0;
    });
    const total =
      vals.reduce(function (a, b) {
        return a + b;
      }, 0) || 1;
    const hasNames = data.some(function (d) {
      return d && typeof d === "object" && d.name;
    });
    const cx = hasNames ? W * 0.38 : W / 2,
      cy = H / 2,
      r = Math.min(hasNames ? W * 0.6 : W, H) / 2 - 8;
    let a0 = -Math.PI / 2;
    vals.forEach(function (v, i) {
      if (v <= 0) return;
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      out +=
        '<path class="pptc-slice" d="M' +
        cx +
        "," +
        cy +
        "L" +
        (cx + r * Math.cos(a0)) +
        "," +
        (cy + r * Math.sin(a0)) +
        "A" +
        r +
        "," +
        r +
        " 0 " +
        large +
        " 1 " +
        (cx + r * Math.cos(a1)) +
        "," +
        (cy + r * Math.sin(a1)) +
        'Z" fill="' +
        pal[i % pal.length] +
        '"/>';
      a0 = a1;
    });
    if (hasNames) {
      data.forEach(function (d, i) {
        const y = H / 2 - (data.length - 1) * 9 + i * 18;
        out +=
          '<rect x="' +
          W * 0.68 +
          '" y="' +
          (y - 8) +
          '" width="10" height="10" rx="2" fill="' +
          pal[i % pal.length] +
          '"/>' +
          '<text x="' +
          (W * 0.68 + 16) +
          '" y="' +
          y +
          '" font-size="11" fill="#555">' +
          escapeHtml(d.name || "") +
          "</text>";
      });
    }
  } else {
    const cats = (opt.xAxis && opt.xAxis.data) || [];
    const padL = 38,
      padB = 24,
      padT =
        series.some(function (s) {
          return s.name;
        }) && series.length > 1
          ? 22
          : 10,
      padR = 10;
    const iw = W - padL - padR,
      ih = H - padT - padB;
    const all = [];
    series.forEach(function (s) {
      (s.data || []).forEach(function (v) {
        all.push(+v || 0);
      });
    });
    const max = Math.max.apply(null, all.concat([1]));
    const min = Math.min.apply(null, all.concat([0]));
    const span = max - min || 1;
    const n = Math.max(
      cats.length,
      series[0] ? (series[0].data || []).length : 0,
      1,
    );
    const Y = function (v) {
      return padT + ih * (1 - (v - min) / span);
    };
    // gridlines + y labels
    for (let g = 0; g <= 4; g++) {
      const gv = min + (span * g) / 4,
        gy = Y(gv);
      out +=
        '<line x1="' +
        padL +
        '" y1="' +
        gy +
        '" x2="' +
        (padL + iw) +
        '" y2="' +
        gy +
        '" stroke="rgba(128,128,128,.18)"/>' +
        '<text x="' +
        (padL - 5) +
        '" y="' +
        (gy + 3.5) +
        '" font-size="10" fill="#888" text-anchor="end">' +
        fmtNum(gv) +
        "</text>";
    }
    // x labels
    for (let c = 0; c < n; c++) {
      const cxp = padL + (iw * (c + 0.5)) / n;
      out +=
        '<text x="' +
        cxp +
        '" y="' +
        (H - 7) +
        '" font-size="10" fill="#888" text-anchor="middle">' +
        escapeHtml(cats[c] != null ? cats[c] : "") +
        "</text>";
    }
    // axes
    out +=
      '<line x1="' +
      padL +
      '" y1="' +
      padT +
      '" x2="' +
      padL +
      '" y2="' +
      (padT + ih) +
      '" stroke="rgba(128,128,128,.4)"/>' +
      '<line x1="' +
      padL +
      '" y1="' +
      Y(Math.max(min, 0)) +
      '" x2="' +
      (padL + iw) +
      '" y2="' +
      Y(Math.max(min, 0)) +
      '" stroke="rgba(128,128,128,.4)"/>';
    const band = iw / n;
    series.forEach(function (s, si) {
      const col = pal[si % pal.length];
      const vals2 = (s.data || []).map(function (v) {
        return +v || 0;
      });
      if (s.type === "line") {
        const pts = vals2
          .map(function (v, i) {
            return padL + band * (i + 0.5) + "," + Y(v);
          })
          .join(" ");
        out +=
          '<polyline class="pptc-line" points="' +
          pts +
          '" fill="none" stroke="' +
          col +
          '" stroke-width="2.4" stroke-linejoin="round"/>';
        vals2.forEach(function (v, i) {
          out +=
            '<circle class="pptc-pt" cx="' +
            (padL + band * (i + 0.5)) +
            '" cy="' +
            Y(v) +
            '" r="3" fill="' +
            col +
            '"/>';
        });
      } else if (s.type === "scatter") {
        vals2.forEach(function (v, i) {
          out +=
            '<circle class="pptc-dot" cx="' +
            (padL + band * (i + 0.5)) +
            '" cy="' +
            Y(v) +
            '" r="4" fill="' +
            col +
            '" fill-opacity=".85"/>';
        });
      } else {
        // bar
        const bw = (band * 0.66) / series.length;
        vals2.forEach(function (v, i) {
          const x = padL + band * (i + 0.17) + si * bw;
          const y0 = Y(Math.max(v, 0)),
            y1 = Y(Math.min(v, 0));
          out +=
            '<rect class="pptc-bar" x="' +
            x +
            '" y="' +
            y0 +
            '" width="' +
            Math.max(bw - 2, 1) +
            '" height="' +
            Math.max(y1 - y0, 0.5) +
            '" rx="1.5" fill="' +
            col +
            '"/>';
        });
      }
    });
    if (padT === 22) {
      // legend
      series.forEach(function (s, si) {
        const lx = padL + si * 90;
        out +=
          '<rect x="' +
          lx +
          '" y="6" width="10" height="10" rx="2" fill="' +
          pal[si % pal.length] +
          '"/>' +
          '<text x="' +
          (lx + 15) +
          '" y="15" font-size="10" fill="#777">' +
          escapeHtml(s.name || "") +
          "</text>";
      });
    }
  }
  return (
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" width="100%" height="100%">' +
    out +
    "</svg>"
  );
}

function renderTable(el) {
  var st = el.style || {};
  var cols = (el.columns || [])
    .map(function (c) {
      return '<col style="width:' + c.w * 100 + '%">';
    })
    .join("");
  var rows = (el.rows || [])
    .map(function (row, ri) {
      var isHead = el.header && ri === 0;
      var tag = isHead ? "th" : "td";
      var tds = (row.cells || [])
        .map(function (cell, ci) {
          var cs = "text-align:" + (cell.align || "left") + ";";
          cs +=
            "color:" +
            (cell.color ||
              (isHead ? st.headerColor || "#fff" : st.color || "#1f2430")) +
            ";";
          if (cell.bg) cs += "background:" + cell.bg + ";";
          else if (isHead)
            cs += "background:" + (st.headerBg || "#3a6ff7") + ";";
          else if (st.zebra && ri % 2 === 0)
            cs += "background:" + st.zebra + ";";
          if (cell.bold) cs += "font-weight:700;";
          cs +=
            "padding:" +
            (st.cellPadY != null ? st.cellPadY : 8) +
            "px " +
            (st.cellPadX != null ? st.cellPadX : 10) +
            "px;";
          cs +=
            "border:" +
            (st.borderWidth != null ? st.borderWidth : 1) +
            "px solid " +
            (st.borderColor || "rgba(128,128,128,.3)") +
            ";";
          return (
            "<" +
            tag +
            ' style="' +
            cs +
            '">' +
            sanitizeHtml(cell.html || "") +
            "</" +
            tag +
            ">"
          );
        })
        .join("");
      return "<tr>" + tds + "</tr>";
    })
    .join("");
  var ts =
    "width:100%;height:100%;border-collapse:collapse;table-layout:fixed;" +
    "font-size:" +
    (st.fontSize || 15) +
    "px;" +
    (st.fontFamily ? "font-family:" + st.fontFamily + ";" : "") +
    "color:" +
    (st.color || "#1f2430") +
    ";" +
    "border-radius:" +
    (st.radius || 0) +
    "px;overflow:hidden;";
  return (
    '<table style="' +
    ts +
    '">' +
    (cols ? "<colgroup>" + cols + "</colgroup>" : "") +
    rows +
    "</table>"
  );
}

/** Resolve {{page}}, {{pages}}, {{title}} tokens in text HTML. */
function resolveFields(html, ctx) {
  if (!ctx || html.indexOf("{{") < 0) return html;
  var pad = function (n, arg) {
    var w = parseInt(arg || "", 10);
    return w > 0 ? String(n).padStart(w, "0") : String(n);
  };
  return html.replace(
    /\{\{\s*(page|pages|title)(?::([^}]*))?\s*\}\}/gi,
    function (_m, name, arg) {
      if (name.toLowerCase() === "page") return pad(ctx.page, arg);
      if (name.toLowerCase() === "pages") return pad(ctx.pages, arg);
      return escapeHtml(ctx.title);
    },
  );
}

/**
 * Render one element to an absolutely-positioned div (slide coordinates).
 * ctx: { present?:bool, hidePlaceholders?:bool, fields?:{page,pages,title} }
 */
function renderElement(el, doc, ctx) {
  ctx = ctx || {};
  var node = document.createElement("div");
  node.className = "ppt-el ppt-el-" + el.type;
  node.setAttribute("data-el-id", el.id);
  node.style.cssText = baseBoxCss(el);
  // Stacking follows document order by default; `el.z` sets an explicit
  // z-index when content needs control (e.g. focus dots above, ambient
  // morph decor below). In PRESENT mode only, non-interactive elements
  // (no link, not chart/media, no hover group) are pointer-transparent:
  // decorative/morph shapes must not swallow chart tooltips, group hover
  // or link clicks beneath them. Edit/view keep full hit-testing —
  // click-select and drag depend on it. (morphKeyOf is ALWAYS truthy
  // since every element has an id — never gate hit-testing on it.)
  if (el.z != null) node.style.zIndex = el.z;
  if (
    ctx.present &&
    !el.link &&
    el.type !== "chart" &&
    el.type !== "media" &&
    !el.group
  )
    node.style.pointerEvents = "none";

  if (el.type === "text") {
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.justifyContent =
      el.valign === "middle"
        ? "center"
        : el.valign === "bottom"
          ? "flex-end"
          : "flex-start";
    node.style.textAlign = el.align || "left";
    node.style.fontSize = (el.fontSize || 24) + "px";
    node.style.fontFamily = el.fontFamily || doc.theme.fontFamily;
    node.style.fontWeight = el.fontWeight || 400;
    node.style.lineHeight = el.lineHeight || 1.25;
    if (el.letterSpacing) node.style.letterSpacing = el.letterSpacing + "px";
    node.style.wordBreak = "break-word";
    node.style.whiteSpace = "pre-wrap";
    if (
      el.colorGradient &&
      el.colorGradient.stops &&
      el.colorGradient.stops.length
    ) {
      node.style.background = gradientCss(el.colorGradient);
      node.style.webkitBackgroundClip = "text";
      node.style.backgroundClip = "text";
      node.style.color = "transparent";
    } else {
      node.style.color = el.color || doc.theme.color;
    }
    if (el.textStroke && el.textStroke.width) {
      node.style.webkitTextStroke =
        el.textStroke.width + "px " + (el.textStroke.color || "#000");
      if (el.textStroke.fill === "none") node.style.color = "transparent";
    }
    var html = el.html || "";
    if (ctx.fields) html = resolveFields(html, ctx.fields);
    if (!html && el.placeholder) {
      if (ctx.hidePlaceholders || ctx.present) {
        node.style.display = "none";
      } else {
        node.innerHTML =
          '<span class="ppt-placeholder">' +
          escapeHtml(el.placeholder) +
          "</span>";
        node.setAttribute("data-empty", "1");
      }
    } else {
      // Wrap in one inner div: the node is a flex-column (for valign), so
      // each direct child would become a separate flex item stacked
      // vertically — mixed inline markup ("…<b>…") and countUp spans
      // must stay in normal inline flow.
      node.innerHTML =
        '<div class="ppt-text-body" style="width:100%">' +
        sanitizeHtml(html) +
        "</div>";
    }
  } else if (el.type === "shape") {
    node.innerHTML = renderShape(el);
  } else if (el.type === "image") {
    var img = document.createElement("img");
    img.src = resolveAsset(doc, el.src || "");
    img.draggable = false;
    img.alt = "";
    img.style.cssText =
      "width:100%;height:100%;display:block;object-fit:" +
      (el.fit || "contain") +
      ";" +
      (el.radius ? "border-radius:" + el.radius + "px;" : "");
    node.appendChild(img);
    node.style.overflow = "hidden";
    if (el.radius) node.style.borderRadius = el.radius + "px";
  } else if (el.type === "svg") {
    var markup = el.asset
      ? resolveAsset(doc, "asset:" + el.asset)
      : el.markup || "";
    node.innerHTML =
      (el.css ? "<style>" + el.css.replace(/<\//g, "<\\/") + "</style>" : "") +
      markup;
  } else if (el.type === "table") {
    node.innerHTML = renderTable(el);
  } else if (el.type === "chart") {
    node.innerHTML = renderChart(el, doc);
  } else if (el.type === "media") {
    var tag = el.kind === "audio" ? "audio" : "video";
    var m = document.createElement(tag);
    m.src = resolveAsset(doc, el.src || "");
    if (el.poster && tag === "video") m.poster = resolveAsset(doc, el.poster);
    if (el.controls !== false) m.controls = true;
    if (el.loop) m.loop = true;
    if (el.muted) m.muted = true;
    if (ctx.present && el.autoplay) m.autoplay = true;
    if (!ctx.present) m.style.pointerEvents = "none"; // edit/view: drag selects, not playback
    m.style.cssText =
      "width:100%;height:100%;object-fit:" +
      (el.fit || "contain") +
      ";" +
      (el.radius ? "border-radius:" + el.radius + "px;" : "");
    node.appendChild(m);
  } else {
    node.className += " ppt-el-unknown";
    node.textContent = el.type || "?";
  }

  if (ctx.present && el.link) node.style.cursor = "pointer";
  return node;
}

/** Render a whole slide to a div sized doc.size (unscaled — callers scale). */
function renderSlide(slide, doc, ctx) {
  ctx = ctx || {};
  // page/pages count non-state slides, like the reference implementation
  if (!ctx.fields) {
    var idx = doc.slides.indexOf(slide);
    var upto = idx < 0 ? doc.slides : doc.slides.slice(0, idx + 1);
    ctx.fields = {
      page: upto.filter(function (s) {
        return !s.stateOf && !s.broken;
      }).length,
      pages: doc.slides.filter(function (s) {
        return !s.stateOf && !s.broken;
      }).length,
      title: doc.title,
    };
  }
  var layer = document.createElement("div");
  layer.className = "ppt-slide";
  layer.setAttribute("data-slide-id", slide.id);
  layer.style.width = doc.size.width + "px";
  layer.style.height = doc.size.height + "px";
  layer.style.background = slide.background || doc.theme.background;
  var els = slide.broken ? brokenSlideEls(slide, doc) : slide.elements || [];
  els.forEach(function (el) {
    layer.appendChild(renderElement(el, doc, ctx));
  });
  if (slide.broken) layer.classList.add("ppt-slide-broken");
  return layer;
}

/** Placeholder visuals for a slide whose ref failed to load (missing or
 *  malformed file). The editor shows the marker and may delete the page;
 *  the presenter skips it in linear navigation. */
function brokenSlideEls(slide, doc) {
  var W = doc.size.width,
    H = doc.size.height;
  return [
    {
      id: "broken-icon",
      type: "text",
      x: 0,
      y: H / 2 - 160,
      w: W,
      h: 100,
      html: "\u26a0",
      fontSize: 64,
      color: "#f59e0b",
      align: "center",
      valign: "middle",
    },
    {
      id: "broken-msg",
      type: "text",
      x: 140,
      y: H / 2 - 36,
      w: W - 280,
      h: 140,
      html: escapeHtml(slide.brokenError || "slide failed to load"),
      fontSize: 20,
      color: "#9aa5c4",
      align: "center",
      valign: "top",
      lineHeight: 1.5,
    },
  ];
}

/** Inject @font-face rules for doc.fonts (font bytes live in doc.assets).
 *  A single shared <style id="ppt-fonts"> is rewritten per document: switching
 *  decks never accumulates stale tags, and fonts only the old deck used retire. */
function injectDocFonts(doc) {
  var css = (doc.fonts || [])
    .map(function (f) {
      var src = resolveAsset(doc, "asset:" + f.asset);
      if (!src) return "";
      return (
        '@font-face{font-family:"' +
        f.family +
        '";src:url(' +
        src +
        ");" +
        (f.weight ? "font-weight:" + f.weight + ";" : "") +
        (f.style ? "font-style:" + f.style + ";" : "") +
        "}"
      );
    })
    .join("");
  var tag = document.getElementById("ppt-fonts");
  if (!css) {
    if (tag) tag.textContent = "";
    return;
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "ppt-fonts";
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

/* --------------------------------------------------- tween & easings */

var MORPH_DURATION = 0.65; // seconds — matches the reference feel
var easeInOutQuad = function (p) {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}; // power2.inOut
var easeOutQuad = function (p) {
  return 1 - (1 - p) * (1 - p);
}; // power2.out
var SVG_NS = "http://www.w3.org/2000/svg";

/** Minimal rAF tween — GSAP-shaped: update(easedP), complete(), cancel().
 *  The from-state (p=0) is applied SYNCHRONOUSLY at creation: the caller
 *  typically runs inside an input event, and if the first rAF lands a frame
 *  late the element would paint once in its final state (the classic
 *  one-frame flash). */
function tween(opts) {
  var cancelled = false,
    raf = 0;
  var t0 = performance.now() + (opts.delay || 0) * 1000;
  opts.update(opts.ease ? opts.ease(0) : 0);
  function frame(now) {
    if (cancelled) return;
    var p = (now - t0) / (opts.duration * 1000);
    if (p < 0) {
      raf = requestAnimationFrame(frame);
      return;
    }
    if (p >= 1) {
      opts.update(opts.ease ? opts.ease(1) : 1);
      cancelled = true;
      if (opts.complete) opts.complete();
      return;
    }
    opts.update(opts.ease ? opts.ease(p) : p);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    cancel: function () {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}

/* -------------------------------------------------- colour interpolation */

var NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
};

/** #hex / rgb() / rgba() / common names → [r,g,b,a]; null when unparseable. */
function colorParts(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (NAMED_COLORS[v.toLowerCase()]) v = NAMED_COLORS[v.toLowerCase()];
  if (v === "transparent" || v === "none" || v === "") return [0, 0, 0, 0];
  var m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    var p = m[1].split(/[\s,/]+/).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, isFinite(p[3]) ? p[3] : 1];
  }
  if (/^#[0-9a-fA-F]{3}$/.test(v))
    v =
      "#" +
      v
        .slice(1)
        .split("")
        .map(function (c) {
          return c + c;
        })
        .join("");
  if (/^#[0-9a-fA-F]{6,8}$/.test(v)) {
    return [
      parseInt(v.slice(1, 3), 16),
      parseInt(v.slice(3, 5), 16),
      parseInt(v.slice(5, 7), 16),
      v.length === 9 ? parseInt(v.slice(7, 9), 16) / 255 : 1,
    ];
  }
  return null;
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
    Math.round(c[3] * 1000) / 1000 +
    ")"
  );
}

function lerpColor(a, b, p) {
  return rgbaStr([
    a[0] + (b[0] - a[0]) * p,
    a[1] + (b[1] - a[1]) * p,
    a[2] + (b[2] - a[2]) * p,
    a[3] + (b[3] - a[3]) * p,
  ]);
}

/** Colour of a gradient at position t (piecewise-linear between stops). */
function sampleGradient(stops, t) {
  var s = stops.slice().sort(function (x, y) {
    return x.at - y.at;
  });
  if (t <= s[0].at) return rgbaStr(colorParts(s[0].color) || [0, 0, 0, 0]);
  for (var i = 0; i < s.length - 1; i++) {
    var a = s[i],
      b = s[i + 1];
    if (t <= b.at) {
      var f = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
      var ca = colorParts(a.color) || [0, 0, 0, 0],
        cb = colorParts(b.color) || [0, 0, 0, 0];
      return lerpColor(ca, cb, f);
    }
  }
  return rgbaStr(colorParts(s[s.length - 1].color) || [0, 0, 0, 0]);
}

/* ------------------------------------------------------ chart morphing */

function chartSeries(opt) {
  return opt && Array.isArray(opt.series) ? opt.series : [];
}

/** Can two chart options interpolate data point-by-point? (same types,
 *  same series/category counts) */
function chartsCompatible(oa, ob) {
  var sa = chartSeries(oa),
    sb = chartSeries(ob);
  if (!sa.length || sa.length !== sb.length) return false;
  var ca = (oa && oa.xAxis && oa.xAxis.data) || [],
    cb = (ob && ob.xAxis && ob.xAxis.data) || [];
  if (ca.length !== cb.length) return false;
  for (var i = 0; i < sa.length; i++) {
    if ((sa[i].type || "bar") !== (sb[i].type || "bar")) return false;
    if ((sa[i].data || []).length !== (sb[i].data || []).length) return false;
  }
  return true;
}

/** ob with every series value interpolated from oa's (p=0 → oa's data). */
function lerpChartOption(oa, ob, p) {
  var opt = JSON.parse(JSON.stringify(ob));
  chartSeries(opt).forEach(function (s, i) {
    var da = chartSeries(oa)[i].data || [];
    s.data = (s.data || []).map(function (v, j) {
      var va = da[j];
      if (va !== null && typeof va === "object") va = va.value;
      if (v !== null && typeof v === "object") {
        var o = JSON.parse(JSON.stringify(v));
        o.value = (+va || 0) + ((+v.value || 0) - (+va || 0)) * p;
        return o;
      }
      return (+va || 0) + ((+v || 0) - (+va || 0)) * p;
    });
  });
  return opt;
}

/* ------------------------------------------------------------ presenter */

var ENTER_DEFAULT_DUR = {
  "fade-up": 0.55,
  fade: 0.55,
  "fade-down": 0.55,
  "slide-left": 0.75,
  "slide-right": 0.75,
  "slide-up": 0.75,
  "slide-down": 0.75,
};

function Presenter(ppt) {
  this.ppt = ppt;
  this.doc = ppt.doc;
  this.overlay = null;
  this.stage = null;
  this.layer = null;
  this.slide = null;
  this.idx = 0;
  this.tweens = [];
  this.speakerWin = null;
  this.black = null;
  this.tip = null;
  this._hoverG = undefined;
  this._onKey = this.onKey.bind(this);
  this._onClick = this.onClick.bind(this);
  this._onResize = this.fit.bind(this);
  this._onHover = this.onHoverMove.bind(this);
}

Presenter.prototype.killTweens = function () {
  for (var i = 0; i < this.tweens.length; i++) this.tweens[i].cancel();
  this.tweens = [];
};

Presenter.prototype.open = function (startIdx) {
  if (this.overlay) return;
  var slides = this.doc.slides;
  this.idx = clamp(startIdx || 0, 0, slides.length - 1);
  var ov = document.createElement("div");
  ov.className = "ppt-present";
  ov.innerHTML =
    '<div class="ppt-present-stage"></div>' +
    '<div class="ppt-present-progress"><i></i></div>' +
    '<div class="ppt-present-num"></div>';
  // inside the host subtree (not document.body) so host stylesheets scoped
  // to the component reach the overlay; position:fixed still covers the viewport
  this.ppt.root.appendChild(ov);
  this.overlay = ov;
  this.stage = ov.querySelector(".ppt-present-stage");
  this.progressEl = ov.querySelector(".ppt-present-progress i");
  this.numEl = ov.querySelector(".ppt-present-num");
  var showProgress = !!(this.doc.present && this.doc.present.progress);
  var showNum = !!(this.doc.present && this.doc.present.slideNumber);
  ov.querySelector(".ppt-present-progress").style.display = showProgress
    ? ""
    : "none";
  this.numEl.style.display = showNum ? "" : "none";
  window.addEventListener("keydown", this._onKey, true);
  window.addEventListener("resize", this._onResize);
  ov.addEventListener("click", this._onClick);
  ov.addEventListener("pointermove", this._onHover);
  this.fit();
  this.show(this.idx, 0, true);
};

Presenter.prototype.close = function () {
  if (!this.overlay) return;
  this.killTweens();
  this.closeSpeaker();
  window.removeEventListener("keydown", this._onKey, true);
  window.removeEventListener("resize", this._onResize);
  this.overlay.remove();
  this.overlay = null;
  this.stage = null;
  this.layer = null;
  this.tip = null;
  this.black = null;
  var vids = document.querySelectorAll(
    ".ppt-present video, .ppt-present audio",
  );
  vids.forEach(function (v) {
    try {
      v.pause();
    } catch (e) {}
  });
  this.ppt.emit("presentclose", {});
};

/* ---- speaker view (S) ---- */

Presenter.prototype.toggleSpeaker = function () {
  if (this.speakerWin) {
    this.closeSpeaker();
    return;
  }
  var w = window.open("", "ppt-speaker", "width=460,height=620");
  if (!w) return;
  this.speakerWin = w;
  this.speakerT0 = Date.now();
  var self = this;
  this._spTimer = setInterval(function () {
    self.paintSpeaker();
  }, 1000);
  w.addEventListener("unload", function () {
    if (self._spTimer) {
      clearInterval(self._spTimer);
      self._spTimer = null;
    }
    self.speakerWin = null;
  });
  this.paintSpeaker();
};

Presenter.prototype.closeSpeaker = function () {
  if (this._spTimer) {
    clearInterval(this._spTimer);
    this._spTimer = null;
  }
  if (this.speakerWin && !this.speakerWin.closed) this.speakerWin.close();
  this.speakerWin = null;
};

function slideFirstText(slide) {
  for (var i = 0; i < slide.elements.length; i++) {
    var el = slide.elements[i];
    if (el.type === "text" && el.html) {
      var t = String(el.html)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (t) return t.length > 80 ? t.slice(0, 80) + "\u2026" : t;
    }
  }
  return "";
}

Presenter.prototype.paintSpeaker = function () {
  var w = this.speakerWin;
  if (!w) return;
  if (w.closed) {
    this.closeSpeaker();
    return;
  }
  var slide = this.slide;
  if (!slide) return;
  var lin = this.linear();
  var cur = slide;
  if (cur.stateOf) {
    var p = this.doc.slides.find(function (s) {
      return s.id === cur.stateOf;
    });
    if (p) cur = p;
  }
  var pos = lin.indexOf(cur);
  if (pos < 0) pos = 0;
  var nextSlide = lin.length ? lin[(pos + 1) % lin.length] : null; // navigation loops
  var el = Math.max(0, Math.floor((Date.now() - this.speakerT0) / 1000));
  var mm = String(Math.floor(el / 60)).padStart(2, "0");
  var ss = String(el % 60).padStart(2, "0");
  var notes =
    (slide.notes || "").replace(/</g, "&lt;") ||
    '<span style="color:#666">(no notes)</span>';
  var nextText = nextSlide ? slideFirstText(nextSlide) : "(end)";
  w.document.body.innerHTML =
    '<div style="font:14px system-ui,sans-serif;background:#14161c;color:#e8eaf0;height:100%;box-sizing:border-box;padding:18px;display:flex;flex-direction:column;gap:14px;margin:0;overflow:auto">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between">' +
    '<div style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums">' +
    mm +
    ":" +
    ss +
    "</div>" +
    '<div style="color:#9aa0ad">' +
    (pos + 1) +
    " / " +
    lin.length +
    (slide.stateOf ? " \u00B7 state" : "") +
    "</div>" +
    "</div>" +
    '<div style="flex:1;min-height:0;overflow:auto;background:#1c1f27;border-radius:10px;padding:14px;line-height:1.7;white-space:pre-wrap">' +
    notes +
    "</div>" +
    '<div style="color:#9aa0ad;font-size:12px">NEXT</div>' +
    '<div style="background:#1c1f27;border-radius:10px;padding:12px;color:#c6cad4;min-height:44px">' +
    (nextText.replace(/</g, "&lt;") || "(blank)") +
    "</div>" +
    "</div>";
};

/* ---- blackout (B) ---- */

Presenter.prototype.toggleBlack = function () {
  if (this.black) {
    this.black.remove();
    this.black = null;
    return;
  }
  if (!this.overlay) return;
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;background:#000;z-index:60;";
  this.overlay.appendChild(d);
  this.black = d;
};

Presenter.prototype.fit = function () {
  if (!this.stage) return;
  var w = this.doc.size.width,
    h = this.doc.size.height;
  var s = Math.min((window.innerWidth - 24) / w, (window.innerHeight - 24) / h);
  this.stage.style.width = w + "px";
  this.stage.style.height = h + "px";
  this.stage.style.transform = "translate(-50%,-50%) scale(" + s + ")";
};

Presenter.prototype.linear = function () {
  return this.doc.slides.filter(function (s) {
    return !s.stateOf && !s.broken;
  });
};

Presenter.prototype.updateChrome = function () {
  var lin = this.linear();
  var cur = this.slide;
  var pos = cur.stateOf
    ? lin.indexOf(
        this.doc.slides.find(function (s) {
          return s.id === cur.stateOf;
        }),
      )
    : lin.indexOf(cur);
  if (pos < 0) pos = 0;
  this.progressEl.style.width = ((pos + 1) / lin.length) * 100 + "%";
  this.numEl.textContent = pos + 1 + " / " + lin.length;
};

Presenter.prototype.applyEnterFx = function (layer, slide) {
  var self = this;
  slide.elements.forEach(function (el) {
    var node = layer.querySelector('[data-el-id="' + el.id + '"]');
    if (!node) return;
    if (el.fx && el.fx.enter) {
      var dur = el.fx.enterDur || ENTER_DEFAULT_DUR[el.fx.enter] || 0.55;
      var delay = (el.fx.order || 0) * 0.08;
      node.style.animation =
        "ppt-enter-" +
        el.fx.enter +
        " " +
        dur +
        "s cubic-bezier(.22,.8,.36,1) " +
        delay +
        "s both";
    }
    if (el.fx && el.fx.countUp && el.type === "text") {
      self.animateNumbers(
        node,
        (el.fx.order || 0) * 0.08,
        el.fx.enterDur || 0.9,
      );
    }
    if (el.fx && el.fx.ambient === "kenburns") self.startKenburns(el, node, 0);
  });
};

/** Start an element's kenburns ambient (WAAPI). delayMs defers the start so a
 *  morph flight or the entering rise (both driven via style.transform) never
 *  fights the WAAPI transform on the same node. */
Presenter.prototype.startKenburns = function (el, node, delayMs) {
  var t = el.type === "image" ? node.querySelector("img") : node;
  if (!t) return;
  var ken = (el.fx && el.fx.ken) || {};
  var scale = ken.scale || 1.08;
  var dur2 = (ken.duration || 22) * 1000;
  var timing = { duration: dur2, delay: delayMs || 0 };
  if (ken.dir === "out") {
    timing.easing = "cubic-bezier(.22,.8,.36,1)";
    timing.fill = "both";
    t.animate(
      [{ transform: "scale(" + scale + ")" }, { transform: "scale(1)" }],
      timing,
    );
  } else if (ken.dir === "in") {
    timing.easing = "cubic-bezier(.22,.8,.36,1)";
    timing.fill = "both";
    t.animate(
      [{ transform: "scale(1)" }, { transform: "scale(" + scale + ")" }],
      timing,
    );
  } else {
    timing.direction = "alternate";
    timing.iterations = Infinity;
    timing.easing = "ease-in-out";
    t.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(" + scale + ") translate(-1.5%,-1%)" },
      ],
      timing,
    );
  }
};

/** Morph slides: runMorph handles the flight choreography, but two fx kinds
 *  must still fire here — countUp (numbers roll on every arrival) and ambient
 *  kenburns. One-shot kenburns (out/in) waits 0.9s so its WAAPI transform never
 *  overrides the morph flight / entering rise on the same node; infinite drift
 *  waits 1.25s for the choreography to settle. */
Presenter.prototype.applyMorphFx = function (layer, slide) {
  var self = this;
  slide.elements.forEach(function (el) {
    if (!el.fx) return;
    var node = layer.querySelector('[data-el-id="' + el.id + '"]');
    if (!node) return;
    if (el.fx.countUp && el.type === "text") {
      self.animateNumbers(
        node,
        0.3 + (el.fx.order || 0) * 0.08,
        el.fx.enterDur || 0.9,
      );
    }
    if (el.fx.ambient === "kenburns") {
      var oneShot =
        el.fx.ken && (el.fx.ken.dir === "out" || el.fx.ken.dir === "in");
      self.startKenburns(el, node, oneShot ? 900 : 1250);
    }
  });
};

/** countUp — animate every numeric token in a text element from 0. */
Presenter.prototype.animateNumbers = function (node, delay, dur) {
  var self = this;
  var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  var targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  targets.forEach(function (tn) {
    var re = /\d[\d,.]*/g,
      m,
      last = 0,
      frag = null;
    while ((m = re.exec(tn.nodeValue))) {
      if (!frag) frag = document.createDocumentFragment();
      frag.appendChild(
        document.createTextNode(tn.nodeValue.slice(last, m.index)),
      );
      var sp = document.createElement("span");
      sp.textContent = "0";
      sp.setAttribute("data-final", m[0]);
      frag.appendChild(sp);
      last = m.index + m[0].length;
    }
    if (frag) {
      frag.appendChild(document.createTextNode(tn.nodeValue.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    }
  });
  node.querySelectorAll("[data-final]").forEach(function (sp) {
    var raw = sp.getAttribute("data-final");
    var num = parseFloat(raw.replace(/[,]/g, ""));
    if (isNaN(num)) {
      sp.textContent = raw;
      return;
    }
    var dec = (raw.split(".")[1] || "").length;
    var grouped = raw.indexOf(",") >= 0;
    self.tweens.push(
      tween({
        duration: dur,
        delay: delay,
        ease: easeOutQuad,
        update: function (p) {
          var v = num * p;
          sp.textContent = grouped
            ? Math.round(v).toLocaleString("en-US")
            : dec
              ? v.toFixed(dec)
              : String(Math.round(v));
        },
        complete: function () {
          sp.textContent = raw;
        },
      }),
    );
  });
};

/** Default chart entrance — data marks animate even without fx set. bar: bars
 *  grow from the baseline (staggered); line: stroke draws on, points pop;
 *  scatter: dots pop; pie: slices pop staggered. Morph-matched charts are
 *  skipped (they show the data morph instead). WAAPI on SVG child nodes with
 *  transform-box: fill-box; killed implicitly when the layer is removed. */
Presenter.prototype.animateChartsIn = function (layer, slide, baseDelay, skip) {
  slide.elements.forEach(function (el) {
    if (el.type !== "chart" || (skip && skip[el.id])) return;
    var node = layer.querySelector('[data-el-id="' + el.id + '"]');
    var svg = node ? node.querySelector("svg") : null;
    if (!svg) return;
    var d0 = (baseDelay || 0) * 1000 + ((el.fx && el.fx.order) || 0) * 80;
    var ease = "cubic-bezier(.22,.8,.36,1)";
    var i, marks;
    marks = svg.querySelectorAll(".pptc-bar");
    for (i = 0; i < marks.length; i++) {
      marks[i].style.transformBox = "fill-box";
      marks[i].style.transformOrigin = "50% 100%";
      marks[i].animate(
        [{ transform: "scale(1,0)" }, { transform: "scale(1,1)" }],
        { duration: 550, delay: d0 + i * 60, easing: ease, fill: "both" },
      );
    }
    marks = svg.querySelectorAll(".pptc-slice");
    for (i = 0; i < marks.length; i++) {
      marks[i].style.transformBox = "fill-box";
      marks[i].style.transformOrigin = "50% 50%";
      marks[i].animate(
        [
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 500, delay: d0 + i * 90, easing: ease, fill: "both" },
      );
    }
    var pl = svg.querySelector(".pptc-line");
    if (pl && pl.getTotalLength) {
      try {
        var len = pl.getTotalLength();
        pl.style.strokeDasharray = String(len);
        pl.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
          duration: 800,
          delay: d0,
          easing: ease,
          fill: "both",
        });
      } catch (e) {}
    }
    marks = svg.querySelectorAll(".pptc-pt,.pptc-dot");
    for (i = 0; i < marks.length; i++) {
      marks[i].style.transformBox = "fill-box";
      marks[i].style.transformOrigin = "50% 50%";
      marks[i].animate(
        [
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 350, delay: d0 + 400 + i * 50, easing: ease, fill: "both" },
      );
    }
  });
};

/* ---- present-time hover interactions + chart tooltip ---- */

Presenter.prototype.onHoverMove = function (e) {
  if (!this.overlay) return;
  this.chartTip(e);
  var slide = this.slide;
  if (!slide || !slide.hover) return;
  var node = e.target.closest ? e.target.closest("[data-el-id]") : null;
  var g = "";
  if (node) {
    var el = slide.elements.find(function (x) {
      return x.id === node.getAttribute("data-el-id");
    });
    g = (el && el.group) || "";
  }
  if (g === this._hoverG) return;
  this._hoverG = g;
  this.applyHover(slide, g);
};

Presenter.prototype.applyHover = function (slide, g) {
  var hv = slide.hover;
  if (!hv || !this.layer) return;
  var layer = this.layer;
  slide.elements.forEach(function (el) {
    var node = layer.querySelector('[data-el-id="' + el.id + '"]');
    if (!node) return;
    node.style.transition = "opacity .25s";
    if (hv.type === "focus-group") {
      node.style.opacity =
        !g || el.group === g
          ? el.opacity
          : el.opacity * (hv.dim == null ? 0.25 : hv.dim);
    } else if (hv.type === "reveal") {
      var set = g || hv.default || "";
      node.style.opacity =
        !el.showOnHover || el.showOnHover === set ? el.opacity : 0;
    }
  });
};

/** Chart hover tooltip (bar/line/scatter via x band; pie via angle). */
Presenter.prototype.chartTip = function (e) {
  if (!this.tip) {
    this.tip = document.createElement("div");
    this.tip.className = "ppt-chart-tip";
    this.tip.style.display = "none";
    this.overlay.appendChild(this.tip);
  }
  var tip = this.tip;
  var node = e.target.closest ? e.target.closest(".ppt-el-chart") : null;
  var slide = this.slide;
  if (!node || !slide) {
    tip.style.display = "none";
    return;
  }
  var el = slide.elements.find(function (x) {
    return x.id === node.getAttribute("data-el-id");
  });
  if (!el || el.type !== "chart") {
    tip.style.display = "none";
    return;
  }
  var opt = el.option || {};
  var series = chartSeries(opt);
  if (!series.length) {
    tip.style.display = "none";
    return;
  }
  var type = series[0].type || "bar";
  var pal =
    (opt.color && opt.color.length ? opt.color : null) ||
    this.doc.theme.chartPalette ||
    DEFAULT_PALETTE;
  var r = node.getBoundingClientRect();
  var W = el.w,
    H = el.h;
  var mx = ((e.clientX - r.left) / Math.max(r.width, 1)) * W;
  var my = ((e.clientY - r.top) / Math.max(r.height, 1)) * H;
  var html = "";
  if (type === "pie") {
    var data = series[0].data || [];
    var hasNames = data.some(function (d) {
      return d && typeof d === "object" && d.name;
    });
    var pcx = hasNames ? W * 0.38 : W / 2,
      pcy = H / 2;
    var rad = Math.sqrt((mx - pcx) * (mx - pcx) + (my - pcy) * (my - pcy));
    var rMax = Math.min(hasNames ? W * 0.6 : W, H) / 2 - 8;
    if (rad > rMax + 10) {
      tip.style.display = "none";
      return;
    }
    var ang = Math.atan2(my - pcy, mx - pcx);
    var vals = data.map(function (d) {
      return typeof d === "object" && d !== null ? +d.value || 0 : +d || 0;
    });
    var total =
      vals.reduce(function (a, b) {
        return a + b;
      }, 0) || 1;
    var acc = -Math.PI / 2,
      idx = -1;
    for (var i = 0; i < vals.length; i++) {
      var nxt = acc + (vals[i] / total) * Math.PI * 2;
      if (ang >= acc && ang < nxt) {
        idx = i;
        break;
      }
      acc = nxt;
    }
    if (idx < 0 || vals[idx] <= 0) {
      tip.style.display = "none";
      return;
    }
    var d = data[idx];
    var nm = typeof d === "object" && d !== null ? d.name || "" : "";
    html =
      '<i style="background:' +
      pal[idx % pal.length] +
      '"></i>' +
      escapeHtml(nm) +
      " <b>" +
      vals[idx] +
      "</b> (" +
      Math.round((vals[idx] / total) * 100) +
      "%)";
  } else {
    var cats = (opt.xAxis && opt.xAxis.data) || [];
    if (!cats.length) {
      tip.style.display = "none";
      return;
    }
    var padL = 38,
      padR = 10;
    var n = Math.max(cats.length, 1);
    var idx2 = Math.floor((mx - padL) / ((W - padL - padR) / n));
    if (idx2 < 0 || idx2 >= cats.length) {
      tip.style.display = "none";
      return;
    }
    html =
      '<div class="t">' +
      escapeHtml(String(cats[idx2])) +
      "</div>" +
      series
        .map(function (s, si) {
          var v = (s.data || [])[idx2];
          if (v && typeof v === "object") v = v.value;
          return (
            '<div><i style="background:' +
            pal[si % pal.length] +
            '"></i>' +
            escapeHtml(s.name || "S" + (si + 1)) +
            " <b>" +
            (v == null ? "—" : v) +
            "</b></div>"
          );
        })
        .join("");
  }
  tip.innerHTML = html;
  tip.style.display = "";
  tip.style.left = e.clientX + 14 + "px";
  tip.style.top = e.clientY + 12 + "px";
};

Presenter.prototype.show = function (idx, dir, instant) {
  var slides = this.doc.slides;
  idx = clamp(idx, 0, slides.length - 1);
  var slide = slides[idx];
  this.killTweens();
  var oldLayer = this.layer,
    oldSlide = this.slide;
  var newLayer = renderSlide(slide, this.doc, {
    present: true,
    hidePlaceholders: true,
  });
  newLayer.classList.add("ppt-present-layer");
  this.stage.appendChild(newLayer);
  this.idx = idx;
  this.slide = slide;
  this.layer = newLayer;
  this.updateChrome();
  this._hoverG = undefined;
  if (slide.hover) this.applyHover(slide, "");
  if (this.speakerWin) this.paintSpeaker();

  var transition = slide.transition || "fade";
  var D = 480;

  function finishOld() {
    if (oldLayer && oldLayer.parentNode) oldLayer.remove();
  }

  if (!oldLayer || instant) {
    this.applyEnterFx(newLayer, slide);
    this.animateChartsIn(newLayer, slide, 0.1);
    finishOld();
    return;
  }

  if (transition === "morph") {
    // Instant section cut: the new layer is fully in place and each matched
    // element FLIES from its old frame via transform.
    finishOld();
    this.runMorph(newLayer, oldSlide, slide);
    this.applyMorphFx(newLayer, slide);
    // morph-matched charts show the data morph; unmatched charts get the
    // default entrance once the choreography is underway
    var chartKeys = {};
    oldSlide.elements.forEach(function (el) {
      if (el.type === "chart") chartKeys[morphKeyOf(el)] = true;
    });
    var chartSkip = {};
    slide.elements.forEach(function (el) {
      if (el.type === "chart" && chartKeys[morphKeyOf(el)])
        chartSkip[el.id] = true;
    });
    this.animateChartsIn(newLayer, slide, 0.55, chartSkip);
    return;
  }

  this.applyEnterFx(newLayer, slide);
  this.animateChartsIn(newLayer, slide, transition === "none" ? 0 : 0.2);

  if (transition === "slide") {
    var d = dir >= 0 ? 1 : -1;
    newLayer.animate(
      [
        { transform: "translateX(" + 100 * d + "%)" },
        { transform: "translateX(0)" },
      ],
      { duration: D, easing: "cubic-bezier(.22,.8,.36,1)" },
    );
    var out = oldLayer.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(" + -40 * d + "%)", opacity: 0.4 },
      ],
      { duration: D, easing: "cubic-bezier(.22,.8,.36,1)" },
    );
    out.onfinish = finishOld;
  } else if (transition === "zoom") {
    newLayer.animate(
      [
        { transform: "scale(1.12)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: D, easing: "cubic-bezier(.22,.8,.36,1)" },
    );
    var zo = oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: D * 0.7,
    });
    zo.onfinish = finishOld;
  } else if (transition === "fade") {
    newLayer.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: D * 0.75,
      easing: "ease",
    });
    var fo = oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: D * 0.75,
      easing: "ease",
    });
    fo.onfinish = finishOld;
  } else {
    // none
    finishOld();
  }
};

/**
 * Morph — geometry from the MODEL, transform-only, GPU-composited.
 * The new slide is fully in place; each matched element starts with a
 * transform that makes it LOOK like its counterpart on the old slide and
 * tweens to identity (translate+scale about the top-left, PowerPoint-style:
 * content scales rather than reflowing). Unmatched elements fade+rise in,
 * delayed until the morph is underway, staggered across the set.
 */
Presenter.prototype.runMorph = function (newLayer, oldSlide, newSlide) {
  var self = this;
  var fromMap = {};
  oldSlide.elements.forEach(function (el) {
    fromMap[morphKeyOf(el)] = el;
  });
  var D = MORPH_DURATION;
  var entering = [];

  newSlide.elements.forEach(function (b) {
    var node = newLayer.querySelector('[data-el-id="' + b.id + '"]');
    if (!node) return;
    var a = fromMap[morphKeyOf(b)];
    if (!a) {
      entering.push([node, b]);
      return;
    }

    // chart pairs get a data morph (re-rendered every frame — always crisp)
    if (a.type === "chart" && b.type === "chart") {
      self.morphChart(node, a, b);
    } else if (
      a.x !== b.x ||
      a.y !== b.y ||
      a.w !== b.w ||
      a.h !== b.h ||
      (a.rotation || 0) !== (b.rotation || 0)
    ) {
      // box morph — rotation pivots about the element CENTRE (composed as
      // translate(centre) rotate translate(-centre)) so the final frame is
      // pixel-identical to the element's natural centre-origin rotation
      var cx = b.w / 2,
        cy = b.h / 2;
      node.style.transformOrigin = "0 0";
      node.style.willChange = "transform";
      self.tweens.push(
        tween({
          duration: D,
          ease: easeInOutQuad,
          update: function (p) {
            var x = a.x + (b.x - a.x) * p;
            var y = a.y + (b.y - a.y) * p;
            var w = a.w + (b.w - a.w) * p;
            var h = a.h + (b.h - a.h) * p;
            var r =
              (a.rotation || 0) + ((b.rotation || 0) - (a.rotation || 0)) * p;
            node.style.transform =
              "translate(" +
              (x - b.x) +
              "px," +
              (y - b.y) +
              "px)" +
              (r
                ? " translate(" +
                  cx +
                  "px," +
                  cy +
                  "px) rotate(" +
                  r +
                  "deg) translate(" +
                  -cx +
                  "px," +
                  -cy +
                  "px)"
                : "") +
              " scale(" +
              w / Math.max(b.w, 0.01) +
              "," +
              h / Math.max(b.h, 0.01) +
              ")";
          },
          complete: function () {
            node.style.transformOrigin = "";
            node.style.willChange = "";
            node.style.transform = b.rotation
              ? "rotate(" + b.rotation + "deg)"
              : "";
          },
        }),
      );
    }

    // opacity morph
    if (a.opacity !== b.opacity) {
      self.tweens.push(
        tween({
          duration: D,
          ease: easeInOutQuad,
          update: function (p) {
            node.style.opacity = a.opacity + (b.opacity - a.opacity) * p;
          },
        }),
      );
    }

    // text colour morph
    if (a.type === "text" && b.type === "text" && a.color !== b.color) {
      var ca = colorParts(a.color),
        cb = colorParts(b.color);
      if (ca && cb) {
        self.tweens.push(
          tween({
            duration: D,
            ease: easeInOutQuad,
            update: function (p) {
              node.style.color = lerpColor(ca, cb, p);
            },
            complete: function () {
              node.style.color = b.color || "";
            },
          }),
        );
      }
    }

    // shape fill / stroke morph (solid ⇄ solid, or gradient involved)
    if (a.type === "shape" && b.type === "shape")
      self.morphShapeFill(node, a, b);
  });

  // unmatched incoming: fade + rise 14px, choreographed into the morph
  var spread = Math.min(0.45, entering.length * 0.03);
  entering.forEach(function (pair, i) {
    var node = pair[0],
      m = pair[1];
    var rot = m.rotation ? " rotate(" + m.rotation + "deg)" : "";
    self.tweens.push(
      tween({
        duration: 0.45,
        delay: D * 0.4 + (entering.length ? (spread * i) / entering.length : 0),
        ease: easeOutQuad,
        update: function (p) {
          node.style.opacity = m.opacity * p;
          node.style.transform = "translateY(" + 14 * (1 - p) + "px)" + rot;
        },
        complete: function () {
          node.style.opacity = m.opacity === 1 ? "" : m.opacity;
          node.style.transform = rot;
        },
      }),
    );
  });
};
/**
 * Chart data morph — "the data morphs in place". Compatible charts (same
 * types/series layout) interpolate every data point and re-render the SVG
 * each frame; incompatible ones (bar→pie) crossfade old → new. Geometry is
 * animated directly in model space (single-element reflow) instead of a
 * scaling transform, so gridlines and labels stay vector-crisp throughout
 * and there is no end-of-morph re-rasterisation snap.
 */
Presenter.prototype.morphChart = function (node, a, b) {
  var self = this;
  var compat = chartsCompatible(a.option, b.option);
  var ghost = null;
  if (!compat) {
    ghost = document.createElement("div");
    ghost.style.cssText =
      "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
    ghost.innerHTML = renderChart(
      { option: a.option, w: b.w, h: b.h },
      this.doc,
    );
    node.appendChild(ghost);
  }
  this.tweens.push(
    tween({
      duration: MORPH_DURATION,
      ease: easeInOutQuad,
      update: function (p) {
        var x = a.x + (b.x - a.x) * p,
          y = a.y + (b.y - a.y) * p;
        var w = Math.max(a.w + (b.w - a.w) * p, 1),
          h = Math.max(a.h + (b.h - a.h) * p, 1);
        node.style.left = x + "px";
        node.style.top = y + "px";
        node.style.width = w + "px";
        node.style.height = h + "px";
        if (compat) {
          node.innerHTML = renderChart(
            { option: lerpChartOption(a.option, b.option, p), w: w, h: h },
            self.doc,
          );
        } else {
          ghost.style.opacity = 1 - p;
        }
      },
      complete: function () {
        node.innerHTML = renderChart(
          { option: b.option, w: b.w, h: b.h },
          self.doc,
        );
        node.style.left = b.x + "px";
        node.style.top = b.y + "px";
        node.style.width = b.w + "px";
        node.style.height = b.h + "px";
      },
    }),
  );
};

/** Tween a shape's fill between two model elements. Gradient-aware: tweens
 *  <stop> colours (and the gradient angle) when either side is a gradient;
 *  a solid destination gets a temporary gradient that collapses at the end. */
Presenter.prototype.morphShapeFill = function (node, a, b) {
  var self = this;
  var target = node.querySelector(
    "svg rect, svg ellipse, svg polygon, svg line, svg path",
  );
  if (!target) return;
  var D = MORPH_DURATION;

  function attrColorTween(el, attr, from, to, complete) {
    var ca = colorParts(from),
      cb = colorParts(to);
    if (!ca || !cb) {
      if (complete) complete();
      return;
    }
    self.tweens.push(
      tween({
        duration: D,
        ease: easeInOutQuad,
        update: function (p) {
          el.setAttribute(attr, lerpColor(ca, cb, p));
        },
        complete: function () {
          el.setAttribute(attr, to);
          if (complete) complete();
        },
      }),
    );
  }

  // line shapes paint with stroke
  if (a.shape === "line" || b.shape === "line") {
    if ((a.stroke || "") !== (b.stroke || ""))
      attrColorTween(target, "stroke", a.stroke || "none", b.stroke || "none");
    return;
  }
  var ag =
    a.fillGradient && a.fillGradient.stops && a.fillGradient.stops.length
      ? a.fillGradient
      : null;
  var bg =
    b.fillGradient && b.fillGradient.stops && b.fillGradient.stops.length
      ? b.fillGradient
      : null;
  if (!ag && !bg) {
    if (a.fill !== b.fill)
      attrColorTween(target, "fill", a.fill || "none", b.fill || "none");
    return;
  }
  var svg = target.ownerSVGElement;
  if (!svg) return;
  var lin = svg.querySelector("linearGradient");
  var fabricated = false;
  if (!lin) {
    // destination solid: fabricate a gradient shaped like the source
    fabricated = true;
    lin = document.createElementNS(SVG_NS, "linearGradient");
    lin.id = "ppt-morph-grad-" + ++gradientSeq;
    ag.stops.forEach(function (s) {
      var st = document.createElementNS(SVG_NS, "stop");
      st.setAttribute("offset", String(s.at));
      lin.appendChild(st);
    });
    var defs = document.createElementNS(SVG_NS, "defs");
    defs.appendChild(lin);
    svg.appendChild(defs);
    target.setAttribute("fill", "url(#" + lin.id + ")");
  }
  var stops = Array.prototype.slice.call(lin.querySelectorAll("stop"));
  var finals = bg
    ? bg.stops
    : ag.stops.map(function (s) {
        return { at: s.at, color: b.fill };
      });
  stops.forEach(function (st, i) {
    var at = finals[i] ? finals[i].at : 1;
    var fromC = ag
      ? sampleGradient(ag.stops, at)
      : rgbaStr(colorParts(a.fill) || [0, 0, 0, 0]);
    var toC = finals[i] ? finals[i].color : b.fill;
    attrColorTween(
      st,
      "stop-color",
      fromC,
      toC,
      i === 0 && fabricated
        ? function () {
            target.setAttribute("fill", b.fill || "none");
            if (lin.parentNode) lin.parentNode.remove();
          }
        : null,
    );
  });
  // angle sweep (gradients are rendered with gradientTransform rotate)
  var fromA = (ag ? ag.angle : bg.angle) - 90;
  var toA = (bg ? bg.angle : ag.angle) - 90;
  if (fromA !== toA) {
    this.tweens.push(
      tween({
        duration: D,
        ease: easeInOutQuad,
        update: function (p) {
          lin.setAttribute(
            "gradientTransform",
            "rotate(" + (fromA + (toA - fromA) * p) + " 0.5 0.5)",
          );
        },
      }),
    );
  }
};

Presenter.prototype.nextIdx = function () {
  var slides = this.doc.slides;
  var cur = slides[this.idx];
  var anchor = this.idx;
  if (cur.stateOf) {
    var p = slides.findIndex(function (s) {
      return s.id === cur.stateOf;
    });
    if (p >= 0) anchor = p;
  }
  for (var i = anchor + 1; i < slides.length; i++)
    if (!slides[i].stateOf && !slides[i].broken) return i;
  // infinite loop — past the last linear slide, wrap to the first one
  for (var j = 0; j < anchor; j++)
    if (!slides[j].stateOf && !slides[j].broken) return j;
  return -1;
};

Presenter.prototype.prevIdx = function () {
  var slides = this.doc.slides;
  var cur = slides[this.idx];
  if (cur.stateOf) {
    var p = slides.findIndex(function (s) {
      return s.id === cur.stateOf;
    });
    if (p >= 0) return p;
  }
  for (var i = this.idx - 1; i >= 0; i--)
    if (!slides[i].stateOf && !slides[i].broken) return i;
  // infinite loop — before the first linear slide, wrap to the last one
  for (var j = slides.length - 1; j > this.idx; j--)
    if (!slides[j].stateOf && !slides[j].broken) return j;
  return -1;
};

Presenter.prototype.next = function () {
  var i = this.nextIdx();
  if (i >= 0) this.show(i, 1);
};
Presenter.prototype.prev = function () {
  var i = this.prevIdx();
  if (i >= 0) this.show(i, -1);
};

Presenter.prototype.onKey = function (e) {
  if (!this.overlay) return;
  var k = e.key;
  if (
    k === "ArrowRight" ||
    k === "ArrowDown" ||
    k === " " ||
    k === "PageDown" ||
    k === "Enter"
  ) {
    e.preventDefault();
    e.stopPropagation();
    this.next();
  } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
    e.preventDefault();
    e.stopPropagation();
    this.prev();
  } else if (k === "Home") {
    e.preventDefault();
    this.show(0, -1);
  } else if (k === "End") {
    e.preventDefault();
    var lin = this.linear();
    this.show(this.doc.slides.indexOf(lin[lin.length - 1]), 1);
  } else if (k === "s" || k === "S") {
    e.preventDefault();
    this.toggleSpeaker();
  } else if (k === "b" || k === "B" || k === ".") {
    e.preventDefault();
    this.toggleBlack();
  } else if (k === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    this.close();
  }
};

Presenter.prototype.onClick = function (e) {
  // click-to-advance was removed: mouse clicks only follow element links now.
  // Navigation is keyboard (arrows/space/Home/End) or the API — pages loop.
  var node = e.target.closest ? e.target.closest("[data-el-id]") : null;
  if (node && this.slide) {
    var el = this.slide.elements.find(function (x) {
      return x.id === node.getAttribute("data-el-id");
    });
    if (el && el.link) {
      var t = this.doc.slides.findIndex(function (s) {
        return s.id === el.link;
      });
      if (t >= 0) {
        this.show(t, 1);
        return;
      }
    }
  }
};

/* --------------------------------------------------------------- viewer */

/** Read-only inline view: scaled slide + prev/next arrows.
 *  Chrome is minimal on purpose — the host owns toolbars and presentation. */
function Viewer(ppt, root) {
  this.ppt = ppt;
  this.doc = ppt.doc;
  this.idx = 0;
  this.root = root;
  root.classList.add("ppt-root", "ppt-viewer");
  root.innerHTML =
    '<div class="ppt-view-stage-wrap"><div class="ppt-view-scaler"></div></div>' +
    '<div class="ppt-view-bar">' +
    '<button class="ppt-btn" data-v="prev">&#8249;</button>' +
    '<span class="ppt-view-count"></span>' +
    '<button class="ppt-btn" data-v="next">&#8250;</button>' +
    "</div>";
  this.wrap = root.querySelector(".ppt-view-stage-wrap");
  this.scaler = root.querySelector(".ppt-view-scaler");
  this.count = root.querySelector(".ppt-view-count");
  var self = this;
  root.querySelector('[data-v="prev"]').addEventListener("click", function () {
    self.go(-1);
  });
  root.querySelector('[data-v="next"]').addEventListener("click", function () {
    self.go(1);
  });
  this._ro = new ResizeObserver(function () {
    self.render();
  });
  this._ro.observe(this.wrap);
  this.render();
}

Viewer.prototype.go = function (d) {
  var lin = this.doc.slides.filter(function (s) {
    return !s.stateOf && !s.broken;
  });
  var cur = this.doc.slides[this.idx];
  var pos = lin.indexOf(cur);
  pos = clamp(pos + d, 0, lin.length - 1);
  this.idx = this.doc.slides.indexOf(lin[pos]);
  this.render();
  this.ppt.emit("slidechange", { index: this.idx });
  this.ppt.emit("statechange", this.ppt.getState());
};

Viewer.prototype.render = function () {
  var slide = this.doc.slides[this.idx];
  this.scaler.innerHTML = "";
  var layer = renderSlide(slide, this.doc, {});
  this.scaler.appendChild(layer);
  var w = this.doc.size.width,
    h = this.doc.size.height;
  var s = Math.min(
    (this.wrap.clientWidth - 16) / w,
    (this.wrap.clientHeight - 16) / h,
  );
  if (s <= 0 || !isFinite(s)) s = 0.5;
  this.scaler.style.width = w + "px";
  this.scaler.style.height = h + "px";
  this.scaler.style.transform = "translate(-50%,-50%) scale(" + s + ")";
  this.count.textContent = this.idx + 1 + " / " + this.doc.slides.length;
};

Viewer.prototype.destroy = function () {
  if (this._ro) this._ro.disconnect();
};
/* --------------------------------------------------------------- editor */

var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
var INSERT_SHAPES = ["rect", "ellipse", "triangle", "arrow", "line"];

function Editor(ppt, root) {
  this.ppt = ppt;
  this.doc = ppt.doc;
  this.root = root;
  this.current = 0;
  this.selIds = []; // multi-selection: element ids, last = primary
  this.editing = null;
  this.undoStack = [];
  this.redoStack = [];
  this.scale = 1; // effective scale (fit * zoom)
  this.fitScale = 1; // fit-to-window scale
  this.zoom = 1; // user zoom factor on top of fit
  this._guides = [];
  this.buildDom();
  this.renderAll();
  this.bindKeys();
  this.bindPaste();
  var self = this;
  this._ro = new ResizeObserver(function () {
    self.fit();
  });
  this._ro.observe(this.canvasWrap);
}

/** The edit body is ONLY thumbs + canvas. No toolbar, no file inputs —
 *  the host drives every editing action through the public API below. */
Editor.prototype.buildDom = function () {
  var root = this.root;
  root.classList.add("ppt-root", "ppt-editor");
  root.innerHTML =
    '<div class="ppt-body">' +
    '<div class="ppt-thumbs"></div>' +
    '<div class="ppt-canvas-wrap"><div class="ppt-canvas-scaler"></div></div>' +
    "</div>";

  this.thumbs = root.querySelector(".ppt-thumbs");
  this.canvasWrap = root.querySelector(".ppt-canvas-wrap");
  this.scaler = root.querySelector(".ppt-canvas-scaler");
};

Editor.prototype.slide = function () {
  return this.doc.slides[this.current];
};

Editor.prototype.fit = function () {
  var w = this.doc.size.width,
    h = this.doc.size.height;
  var aw = this.canvasWrap.clientWidth - 32,
    ah = this.canvasWrap.clientHeight - 32;
  var s = Math.min(aw / w, ah / h);
  if (s <= 0 || !isFinite(s)) s = 0.5;
  this.fitScale = s;
  var eff = s * this.zoom;
  this.scale = eff;
  // The scaler is a SIZER box (layout size = visually scaled size) so the
  // wrap's overflow:auto scroll range accounts for the zoomed canvas; the
  // slide layer inside carries the actual transform from the top-left.
  this.scaler.style.width = Math.round(w * eff) + "px";
  this.scaler.style.height = Math.round(h * eff) + "px";
  if (this.layer) {
    this.layer.style.transformOrigin = "0 0";
    this.layer.style.transform = "scale(" + eff + ")";
  }
};

Editor.prototype.setZoom = function (z) {
  this.zoom = clamp(z, 0.1, 6);
  this.fit();
  this.emitState();
};
Editor.prototype.zoomIn = function () {
  this.setZoom(this.zoom * 1.25);
};
Editor.prototype.zoomOut = function () {
  this.setZoom(this.zoom / 1.25);
};
Editor.prototype.zoomReset = function () {
  this.setZoom(1);
};

Editor.prototype.renderAll = function () {
  this.renderThumbs();
  this.renderCanvas();
};

Editor.prototype.renderThumbs = function () {
  var self = this;
  var doc = this.doc;
  this.thumbs.innerHTML = "";
  var thumbW = 148;
  var s = thumbW / doc.size.width;
  doc.slides.forEach(function (slide, i) {
    var t = document.createElement("div");
    t.className = "ppt-thumb" + (i === self.current ? " ppt-active" : "");
    var inner = document.createElement("div");
    inner.className = "ppt-thumb-inner";
    inner.style.width = doc.size.width + "px";
    inner.style.height = doc.size.height + "px";
    inner.style.transform = "scale(" + s + ")";
    inner.appendChild(renderSlide(slide, doc, {}));
    t.appendChild(inner);
    t.style.height = doc.size.height * s + 8 + "px";
    var num = document.createElement("span");
    num.className = "ppt-thumb-num";
    num.textContent = i + 1;
    t.appendChild(num);
    t.addEventListener("click", function () {
      self.current = i;
      self.selIds = [];
      self.renderAll();
      self.ppt.emit("slidechange", { index: i });
      self.emitState();
    });
    // drag to reorder
    t.draggable = true;
    t.addEventListener("dragstart", function (ev) {
      ev.dataTransfer.setData("text/ppt-slide", String(i));
      ev.dataTransfer.effectAllowed = "move";
    });
    t.addEventListener("dragover", function (ev) {
      if (ev.dataTransfer.types.indexOf("text/ppt-slide") < 0) return;
      ev.preventDefault();
      t.classList.add("ppt-drop");
    });
    t.addEventListener("dragleave", function () {
      t.classList.remove("ppt-drop");
    });
    t.addEventListener("drop", function (ev) {
      ev.preventDefault();
      t.classList.remove("ppt-drop");
      var from = parseInt(ev.dataTransfer.getData("text/ppt-slide"), 10);
      if (!isNaN(from) && from !== i) self.moveSlideTo(from, i);
    });
    self.thumbs.appendChild(t);
    // gap "+" insert button after each thumb
    var gap = document.createElement("div");
    gap.className = "ppt-gap";
    gap.textContent = "+";
    gap.setAttribute("data-at", i + 1);
    gap.addEventListener("click", function () {
      self.insertSlideAt(parseInt(this.getAttribute("data-at"), 10));
    });
    self.thumbs.appendChild(gap);
  });
};

Editor.prototype.renderCanvas = function () {
  var self = this;
  this.cancelPen();
  this.cancelPathEdit();
  this.scaler.innerHTML = "";
  this.layer = renderSlide(this.slide(), this.doc, {});
  this.layer.classList.add("ppt-canvas");
  this.scaler.appendChild(this.layer);
  this.fit();

  this.layer.addEventListener("pointerdown", function (e) {
    self.onPointerDown(e);
  });
  this.layer.addEventListener("dblclick", function (e) {
    self.onDblClick(e);
  });
  this.drawSelection();
  this.emitState();
};

Editor.prototype.findEl = function (id) {
  return this.slide().elements.find(function (el) {
    return el.id === id;
  });
};

Editor.prototype.elNode = function (id) {
  return this.layer.querySelector('[data-el-id="' + id + '"]');
};

/* ---- selection overlay */

Editor.prototype.selPrimary = function () {
  return this.selIds.length ? this.selIds[this.selIds.length - 1] : null;
};

Editor.prototype.selEls = function () {
  var self = this;
  return this.selIds
    .map(function (id) {
      return self.findEl(id);
    })
    .filter(Boolean);
};

Editor.prototype.drawSelection = function () {
  var old = this.layer.querySelectorAll(".ppt-sel, .ppt-lp");
  for (var i = 0; i < old.length; i++) old[i].remove();
  this.selOv = null;
  // prune dangling ids
  var self = this;
  this.selIds = this.selIds.filter(function (id) {
    return !!self.findEl(id);
  });
  if (!this.selIds.length) return;
  var single = this.selIds.length === 1;
  this.selIds.forEach(function (id, idx) {
    var el = self.findEl(id);
    var primary = idx === self.selIds.length - 1;
    var ov = document.createElement("div");
    ov.className = "ppt-sel" + (primary ? "" : " ppt-sel-aux");
    ov.style.cssText =
      "left:" +
      el.x +
      "px;top:" +
      el.y +
      "px;width:" +
      el.w +
      "px;height:" +
      el.h +
      "px;" +
      (el.rotation ? "transform:rotate(" + el.rotation + "deg);" : "");
    if (single) {
      HANDLES.forEach(function (h) {
        var d = document.createElement("i");
        d.className = "ppt-handle ppt-h-" + h;
        d.setAttribute("data-h", h);
        ov.appendChild(d);
      });
      var rot = document.createElement("i");
      rot.className = "ppt-rot";
      rot.title = "Rotate (Shift = 15\u00B0 steps)";
      ov.appendChild(rot);
    }
    self.layer.appendChild(ov);
    if (primary) self.selOv = ov;
    // line shape: draggable endpoint handles (slide coords, NOT rotated w/ overlay)
    if (single && el.type === "shape" && el.shape === "line") {
      var ep = lineEndpoints(el);
      ["a", "b"].forEach(function (w) {
        var d = document.createElement("i");
        d.className =
          "ppt-lp" + (el[w === "a" ? "from" : "to"] ? " ppt-lp-linked" : "");
        d.setAttribute("data-ep", w);
        d.style.left = ep[w].x + "px";
        d.style.top = ep[w].y + "px";
        self.layer.appendChild(d);
      });
    }
  });
};

Editor.prototype.select = function (id, additive) {
  if (this.editing) this.finishAnyEdit();
  if (id == null) {
    this.selIds = [];
  } else if (additive) {
    var i = this.selIds.indexOf(id);
    if (i >= 0) this.selIds.splice(i, 1);
    else this.selIds.push(id);
  } else {
    this.selIds = [id];
  }
  this.drawSelection();
  this.emitState();
};

/* ---- snap guides */

/** Candidate snap lines (slide coords) from the slide box and every element
 *  NOT in the current selection. Returns {xs:[], ys:[]} of {v, kind}. */
Editor.prototype.snapTargets = function () {
  var W = this.doc.size.width,
    H = this.doc.size.height;
  var xs = [{ v: 0 }, { v: W / 2 }, { v: W }];
  var ys = [{ v: 0 }, { v: H / 2 }, { v: H }];
  var sel = {};
  this.selIds.forEach(function (id) {
    sel[id] = 1;
  });
  this.slide().elements.forEach(function (el) {
    if (sel[el.id]) return;
    xs.push({ v: el.x }, { v: el.x + el.w / 2 }, { v: el.x + el.w });
    ys.push({ v: el.y }, { v: el.y + el.h / 2 }, { v: el.y + el.h });
  });
  return { xs: xs, ys: ys };
};

/** Snap one axis: edges = moving edge values; returns {d, line} — delta to
 *  apply and the snapped target line (for the guide), or null. */
function snapAxis(edges, targets, thr) {
  var best = null;
  for (var i = 0; i < edges.length; i++) {
    for (var j = 0; j < targets.length; j++) {
      var d = targets[j].v - edges[i];
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d)))
        best = { d: d, line: targets[j].v };
    }
  }
  return best;
}

Editor.prototype.showGuides = function (vx, hy) {
  this.clearGuides();
  var self = this;
  if (vx != null) {
    var gv = document.createElement("div");
    gv.className = "ppt-guide ppt-guide-v";
    gv.style.left = vx + "px";
    this.layer.appendChild(gv);
    this._guides.push(gv);
  }
  if (hy != null) {
    var gh = document.createElement("div");
    gh.className = "ppt-guide ppt-guide-h";
    gh.style.top = hy + "px";
    this.layer.appendChild(gh);
    this._guides.push(gh);
  }
};

Editor.prototype.clearGuides = function () {
  for (var i = 0; i < this._guides.length; i++) this._guides[i].remove();
  this._guides = [];
};

/* ---- pointer interactions */

Editor.prototype.slidePoint = function (e) {
  var r = this.layer.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / this.scale,
    y: (e.clientY - r.top) / this.scale,
  };
};

Editor.prototype.onPointerDown = function (e) {
  if (e.button !== 0) return;
  var self = this;
  if (this.pen) {
    this.penPointerDown(e);
    return;
  }
  if (this.pathEdit) {
    this.pathPointerDown(e);
    return;
  }
  var rotNode = e.target.closest ? e.target.closest(".ppt-rot") : null;
  if (rotNode && this.selIds.length === 1) {
    this.startRotate(e);
    return;
  }
  var lpNode = e.target.closest ? e.target.closest(".ppt-lp") : null;
  if (lpNode && this.selIds.length === 1) {
    this.startLinePoint(e, lpNode.getAttribute("data-ep"));
    return;
  }
  var hNode = e.target.closest ? e.target.closest(".ppt-handle") : null;
  if (hNode && this.selIds.length === 1) {
    this.startResize(e, hNode.getAttribute("data-h"));
    return;
  }

  var elNode = e.target.closest ? e.target.closest(".ppt-el") : null;
  if (!elNode) {
    this.startMarquee(e);
    return;
  }
  var id = elNode.getAttribute("data-el-id");
  if (this.editing === id) return; // let contenteditable handle it
  e.preventDefault();
  if (e.shiftKey) {
    this.select(id, true); // toggle membership; no drag on shift-click
    return;
  }
  var wasGroupHit = this.selIds.length > 1 && this.selIds.indexOf(id) >= 0;
  if (this.selIds.indexOf(id) < 0) this.select(id);
  var els = this.selEls();
  if (!els.length) return;
  this.beginChange();

  var startX = e.clientX,
    startY = e.clientY;
  var orig = els.map(function (el) {
    return { el: el, x: el.x, y: el.y, node: self.elNode(el.id) };
  });
  // selection bbox at drag start
  var bx = Math.min.apply(
    null,
    orig.map(function (o) {
      return o.x;
    }),
  );
  var by = Math.min.apply(
    null,
    orig.map(function (o) {
      return o.y;
    }),
  );
  var bw =
    Math.max.apply(
      null,
      orig.map(function (o) {
        return o.x + o.el.w;
      }),
    ) - bx;
  var bh =
    Math.max.apply(
      null,
      orig.map(function (o) {
        return o.y + o.el.h;
      }),
    ) - by;
  var targets = this.snapTargets();
  var moved = false;

  function move(ev) {
    var dx = (ev.clientX - startX) / self.scale;
    var dy = (ev.clientY - startY) / self.scale;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true;
    var thr = 6 / self.scale;
    var sx = snapAxis(
      [bx + dx, bx + bw / 2 + dx, bx + bw + dx],
      targets.xs,
      thr,
    );
    var sy = snapAxis(
      [by + dy, by + bh / 2 + dy, by + bh + dy],
      targets.ys,
      thr,
    );
    var ax = sx ? bx + dx + sx.d : null; // snapped bbox left
    var ay = sy ? by + dy + sy.d : null;
    var fx = ax != null ? ax - bx : dx;
    var fy = ay != null ? ay - by : dy;
    orig.forEach(function (o) {
      o.el.x = Math.round(o.x + fx);
      o.el.y = Math.round(o.y + fy);
      if (o.node) {
        o.node.style.left = o.el.x + "px";
        o.node.style.top = o.el.y + "px";
      }
    });
    self.syncConnectors();
    self.drawSelection();
    self.showGuides(sx ? sx.line : null, sy ? sy.line : null);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    self.clearGuides();
    if (moved) self.commit();
    else if (wasGroupHit) self.select(id); // click-without-drag inside a group: collapse to the hit element
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

/** Rubber-band selection starting on empty canvas. */
Editor.prototype.startMarquee = function (e) {
  var self = this;
  if (this.editing) this.finishAnyEdit();
  var additive = e.shiftKey;
  var base = additive ? this.selIds.slice() : [];
  var p0 = this.slidePoint(e);
  var mq = null;
  var moved = false;

  function move(ev) {
    var p = self.slidePoint(ev);
    if (!moved && Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) < 3 / self.scale)
      return;
    moved = true;
    if (!mq) {
      mq = document.createElement("div");
      mq.className = "ppt-marquee";
      self.layer.appendChild(mq);
    }
    var x = Math.min(p0.x, p.x),
      y = Math.min(p0.y, p.y);
    var w = Math.abs(p.x - p0.x),
      h = Math.abs(p.y - p0.y);
    mq.style.cssText =
      "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;";
    // live-highlight hits
    var hits = [];
    self.slide().elements.forEach(function (el) {
      if (el.x < x + w && el.x + el.w > x && el.y < y + h && el.y + el.h > y)
        hits.push(el.id);
    });
    self.selIds = base.concat(
      hits.filter(function (id) {
        return base.indexOf(id) < 0;
      }),
    );
    self.drawSelection();
  }
  function up(ev) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (mq) {
      mq.remove();
      mq = null;
    }
    if (!moved) {
      if (!additive) self.selIds = [];
      self.drawSelection();
    }
    self.emitState();
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

/** Rotate the single selected element about its centre. */
Editor.prototype.startRotate = function (e) {
  e.preventDefault();
  e.stopPropagation();
  var self = this;
  var el = this.findEl(this.selPrimary());
  var node = el && this.elNode(el.id);
  if (!el || !node) return;
  this.beginChange();
  var r = node.getBoundingClientRect();
  var cx = r.left + r.width / 2,
    cy = r.top + r.height / 2;
  var a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
  var r0 = el.rotation || 0;

  function move(ev) {
    var a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    var deg = r0 + ((a - a0) * 180) / Math.PI;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    deg = Math.round(deg);
    el.rotation = ((deg % 360) + 360) % 360;
    node.style.transform = el.rotation ? "rotate(" + el.rotation + "deg)" : "";
    if (self.selOv) self.selOv.style.transform = node.style.transform;
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    self.commit();
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

Editor.prototype.startResize = function (e, handle) {
  e.preventDefault();
  e.stopPropagation();
  var self = this;
  var el = this.findEl(this.selPrimary());
  var node = el && this.elNode(el.id);
  if (!el || !node) return;
  this.beginChange();
  var startX = e.clientX,
    startY = e.clientY;
  var o = { x: el.x, y: el.y, w: el.w, h: el.h };
  var targets = this.snapTargets();

  function move(ev) {
    var dx = (ev.clientX - startX) / self.scale;
    var dy = (ev.clientY - startY) / self.scale;
    var x = o.x,
      y = o.y,
      w = o.w,
      h = o.h;
    if (handle.indexOf("e") >= 0) w = o.w + dx;
    if (handle.indexOf("s") >= 0) h = o.h + dy;
    if (handle.indexOf("w") >= 0) {
      x = o.x + dx;
      w = o.w - dx;
    }
    if (handle.indexOf("n") >= 0) {
      y = o.y + dy;
      h = o.h - dy;
    }
    if (w < 12) {
      if (handle.indexOf("w") >= 0) x += w - 12;
      w = 12;
    }
    if (h < 12) {
      if (handle.indexOf("n") >= 0) y += h - 12;
      h = 12;
    }
    // snap the moving edge(s)
    var thr = 6 / self.scale,
      gvx = null,
      ghy = null;
    if (handle.indexOf("e") >= 0) {
      var se = snapAxis([x + w], targets.xs, thr);
      if (se) {
        w += se.d;
        gvx = se.line;
      }
    } else if (handle.indexOf("w") >= 0) {
      var sw = snapAxis([x], targets.xs, thr);
      if (sw) {
        w -= sw.d;
        x += sw.d;
        gvx = sw.line;
      }
    }
    if (handle.indexOf("s") >= 0) {
      var ss = snapAxis([y + h], targets.ys, thr);
      if (ss) {
        h += ss.d;
        ghy = ss.line;
      }
    } else if (handle.indexOf("n") >= 0) {
      var sn = snapAxis([y], targets.ys, thr);
      if (sn) {
        h -= sn.d;
        y += sn.d;
        ghy = sn.line;
      }
    }
    el.x = Math.round(x);
    el.y = Math.round(y);
    el.w = Math.round(w);
    el.h = Math.round(h);
    // re-render content so svg/table/chart reflows
    self.refreshEl(el, node);
    node = self.elNode(el.id);
    self.syncConnectors();
    self.drawSelection();
    self.showGuides(gvx, ghy);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    self.clearGuides();
    self.commit();
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

/** Re-render one element in place (after geometry/style change). */
Editor.prototype.refreshEl = function (el, node) {
  node = node || this.elNode(el.id);
  if (!node) return;
  var fresh = renderElement(el, this.doc, {});
  node.replaceWith(fresh);
};

/* ---- inline text editing */

Editor.prototype.onDblClick = function (e) {
  if (this.pen) {
    this.finishPen(false);
    return;
  }
  if (this.pathEdit) {
    this.pathDblClick(e);
    return;
  }
  var elNode = e.target.closest ? e.target.closest(".ppt-el") : null;
  if (!elNode) return;
  var id = elNode.getAttribute("data-el-id");
  var el = this.findEl(id);
  if (!el) return;
  e.preventDefault();
  if (el.type === "table") {
    this.startTableEdit(el, elNode);
    return;
  }
  if (el.type === "shape" && el.shape === "path") {
    this.startPathEdit(el);
    return;
  }
  if (el.type !== "text") return;
  this.select(id);
  this.beginChange();
  this.editing = id;
  if (elNode.getAttribute("data-empty")) elNode.innerHTML = "";
  elNode.contentEditable = "true";
  elNode.classList.add("ppt-editing");
  elNode.focus();
  // caret to end
  var range = document.createRange();
  range.selectNodeContents(elNode);
  range.collapse(false);
  var selObj = window.getSelection();
  selObj.removeAllRanges();
  selObj.addRange(range);
  var self = this;
  elNode.addEventListener("blur", function onBlur() {
    elNode.removeEventListener("blur", onBlur);
    self.finishTextEdit();
  });
};

Editor.prototype.finishTextEdit = function () {
  if (!this.editing) return;
  var id = this.editing;
  this.editing = null;
  var el = this.findEl(id);
  var node = this.elNode(id);
  if (!el || !node || el.type !== "text") return;
  node.contentEditable = "false";
  node.classList.remove("ppt-editing");
  // read the inner wrapper, not the flex host — otherwise the ppt-text-body
  // div would round-trip into el.html
  var body = node.querySelector(".ppt-text-body");
  var html = sanitizeHtml((body || node).innerHTML);
  // normalize an empty edit to truly empty
  if (html === "<br>" || html === "<div><br></div>") html = "";
  if (html !== (el.html || "")) {
    el.html = html;
    this.refreshEl(el, node);
    this.commit();
  }
};

/** Route by element type — called wherever an edit session may be open. */
Editor.prototype.finishAnyEdit = function () {
  if (!this.editing) return;
  var el = this.findEl(this.editing);
  if (el && el.type === "table") this.finishTableEdit();
  else this.finishTextEdit();
};

/* ---- inline table editing (dblclick) */

Editor.prototype.startTableEdit = function (el, node) {
  this.select(el.id);
  this.beginChange();
  this.editing = el.id;
  node.classList.add("ppt-editing");
  var cells = node.querySelectorAll("td, th");
  cells.forEach(function (c) {
    c.contentEditable = "true";
  });
  if (cells[0]) cells[0].focus();
  var self = this;
  node.addEventListener(
    "blur",
    function onBlur(ev) {
      // moving between cells inside the same table: keep editing
      if (ev.relatedTarget && node.contains(ev.relatedTarget)) return;
      node.removeEventListener("blur", onBlur, true);
      self.finishTableEdit();
    },
    true,
  );
};

Editor.prototype.finishTableEdit = function () {
  if (!this.editing) return;
  var id = this.editing;
  this.editing = null;
  var el = this.findEl(id);
  var node = this.elNode(id);
  if (!el || !node || el.type !== "table") return;
  node.classList.remove("ppt-editing");
  var rows = [];
  node.querySelectorAll("tr").forEach(function (tr) {
    var cells = [];
    tr.querySelectorAll("td, th").forEach(function (c) {
      cells.push({ html: sanitizeHtml(c.innerHTML) });
    });
    if (cells.length) rows.push({ cells: cells });
  });
  if (rows.length) {
    el.rows = rows;
    this.refreshEl(el, node);
    this.commit();
  } else {
    this.refreshEl(el, node);
  }
};
/* ---- undo / redo */

Editor.prototype.snapshot = function () {
  return JSON.stringify({
    slides: this.doc.slides,
    theme: this.doc.theme,
    size: this.doc.size,
    title: this.doc.title,
  });
};

Editor.prototype.beginChange = function () {
  // capture the PRE-mutation state; commit() pushes it onto the undo stack
  if (!this._before) this._before = this.snapshot();
};

Editor.prototype.commit = function () {
  this.undoStack.push(this._before || this.snapshot());
  this._before = null;
  if (this.undoStack.length > 60) this.undoStack.shift();
  this.redoStack.length = 0;
  this.ppt.emit("change", { doc: this.ppt.getDoc() });
  this.emitState();
};

Editor.prototype.restore = function (json) {
  var data = JSON.parse(json);
  this.doc.slides = data.slides;
  this.doc.theme = data.theme;
  this.doc.size = data.size;
  this.doc.title = data.title;
  if (this.current >= this.doc.slides.length)
    this.current = this.doc.slides.length - 1;
  this.selIds = [];
  this.renderAll();
  this.syncConnectors();
  this.ppt.emit("change", { doc: this.ppt.getDoc() });
  this.emitState();
};

Editor.prototype.undo = function () {
  if (!this.undoStack.length) return;
  this.redoStack.push(this.snapshot());
  this.restore(this.undoStack.pop());
};

Editor.prototype.redo = function () {
  if (!this.redoStack.length) return;
  this.undoStack.push(this.snapshot());
  this.restore(this.redoStack.pop());
};

/** Push the toolbar-relevant state snapshot to the host. */
Editor.prototype.emitState = function () {
  this.ppt.emit("statechange", this.ppt.getState());
};

/* ---- public editing API (the host toolbar calls these via PPT) ---- */

Editor.prototype.insertText = function () {
  this.beginChange();
  this.addElement("text");
};

Editor.prototype.insertShape = function (kind) {
  if (INSERT_SHAPES.indexOf(kind) < 0) kind = "rect";
  this.beginChange();
  this.addElement(kind);
};

/** Insert an image from a File/Blob supplied by the host. Persists through
 *  the host imageStore when configured, else falls back to a dataURL. */
Editor.prototype.insertImage = function (file) {
  if (!file) return;
  var self = this;
  var store = this.ppt.opts.imageStore;
  this.beginChange();
  // Measure via an object URL first, then persist through the host imageStore
  // (uploads to a real file) or fall back to an inline base64 dataURL.
  var measureUrl = URL.createObjectURL(file);
  var img = new Image();
  img.onload = function () {
    var nw = img.naturalWidth || 100,
      nh = img.naturalHeight || 100;
    URL.revokeObjectURL(measureUrl);
    var place = function (src) {
      var doc = self.doc;
      var maxW = doc.size.width * 0.6;
      var scale = Math.min(1, maxW / nw);
      var w = Math.round(nw * scale);
      var h = Math.round(nh * scale);
      var el = {
        id: uid(),
        type: "image",
        src: src,
        fit: "contain",
        radius: 0,
        x: Math.round((doc.size.width - w) / 2),
        y: Math.round((doc.size.height - h) / 2),
        w: w,
        h: h,
        rotation: 0,
        opacity: 1,
      };
      self.slide().elements.push(el);
      self.renderCanvas();
      self.select(el.id);
      self.commit();
    };
    if (store && typeof store.put === "function") {
      Promise.resolve(store.put(file))
        .then(place)
        .catch(function (e) {
          self._before = null; // drop the pending undo snapshot on failure
          self.ppt.emit("error", { message: String((e && e.message) || e) });
        });
    } else {
      var reader = new FileReader();
      reader.onload = function () {
        place(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };
  img.onerror = function () {
    URL.revokeObjectURL(measureUrl);
    self._before = null;
  };
  img.src = measureUrl;
};

/** Notify the host imageStore that an image element is being removed so its
 *  backing file can be deleted. Fire-and-forget; base64 / external URLs are
 *  ignored by the store. */
Editor.prototype.notifyImageRemoved = function (el) {
  if (!el || el.type !== "image" || !el.src) return;
  var store = this.ppt.opts.imageStore;
  if (store && typeof store.remove === "function") {
    Promise.resolve(store.remove(el.src)).catch(function () {});
  }
};

Editor.prototype.deleteSelected = function () {
  if (!this.selIds.length) return false;
  var slide = this.slide();
  var self = this;
  var ids = {};
  this.selIds.forEach(function (id) {
    ids[id] = 1;
  });
  this.beginChange();
  var removed = 0;
  slide.elements = slide.elements.filter(function (el) {
    if (ids[el.id]) {
      self.notifyImageRemoved(el);
      removed++;
      return false;
    }
    return true;
  });
  if (!removed) {
    this._before = null;
    return false;
  }
  this.selIds = [];
  this.renderCanvas();
  this.syncConnectors(); // drop anchors that pointed at removed elements
  this.commit();
  return true;
};

/** Apply style to every selected element matching `type`; fn(el) mutates. */
Editor.prototype.eachSel = function (type, fn) {
  var els = this.selEls().filter(function (el) {
    return !type || el.type === type;
  });
  if (!els.length) return false;
  this.beginChange();
  var self = this;
  els.forEach(function (el) {
    fn(el);
    self.refreshEl(el);
  });
  this.commit();
  return true;
};

Editor.prototype.setFill = function (color) {
  this.eachSel("shape", function (el) {
    el.fill = color;
    el.fillGradient = undefined;
  });
};

Editor.prototype.setTextColor = function (color) {
  this.eachSel("text", function (el) {
    el.color = color;
    el.colorGradient = undefined;
  });
};

Editor.prototype.setFontSize = function (n) {
  var v = clamp(parseInt(n, 10) || 32, 8, 400);
  this.eachSel("text", function (el) {
    el.fontSize = v;
  });
};

Editor.prototype.toggleBold = function () {
  this.eachSel("text", function (el) {
    el.fontWeight = el.fontWeight >= 700 ? 400 : 700;
  });
};

Editor.prototype.setAlign = function (a) {
  this.eachSel("text", function (el) {
    el.align = a;
  });
};

/**
 * Generic patch API for the properties panel. `props` keys are applied to
 * EVERY selected element (type-appropriate keys only make sense per type);
 * a value of null/undefined DELETES the key. Geometry is sanitised.
 */
var GEOM_KEYS = { x: 1, y: 1, w: 1, h: 1, rotation: 1 };
Editor.prototype.updateSelected = function (props) {
  var els = this.selEls();
  if (!els.length || !props) return;
  this.beginChange();
  var self = this;
  var primary = els[els.length - 1];
  var multi = els.length > 1;
  els.forEach(function (el) {
    Object.keys(props).forEach(function (k) {
      // geometry under multi-selection applies to the PRIMARY only (styles go to all)
      if (multi && GEOM_KEYS[k] && el !== primary) return;
      var v = props[k];
      if (v == null) {
        delete el[k];
        return;
      }
      if (k === "x" || k === "y" || k === "rotation") v = Math.round(+v || 0);
      else if (k === "w" || k === "h") v = Math.max(4, Math.round(+v || 0));
      else if (k === "opacity") v = clamp(+v, 0, 1);
      else if (k === "fontSize") v = clamp(parseInt(v, 10) || 32, 8, 400);
      el[k] = v;
    });
    self.refreshEl(el);
  });
  this.syncConnectors();
  this.drawSelection();
  this.commit();
};

/** Patch the CURRENT slide (background/transition/name/stateOf/notes...). */
Editor.prototype.updateSlide = function (props) {
  var slide = this.slide();
  if (!slide || !props) return;
  this.beginChange();
  Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (v == null) delete slide[k];
    else slide[k] = v;
  });
  this.renderAll();
  this.commit();
};

/** Resize the document coordinate space. */
Editor.prototype.updateDocSize = function (w, h) {
  w = clamp(Math.round(+w || 0), 240, 4096);
  h = clamp(Math.round(+h || 0), 240, 4096);
  if (this.doc.size.width === w && this.doc.size.height === h) return;
  this.beginChange();
  this.doc.size = { width: w, height: h };
  this.renderAll();
  this.commit();
};

/** Linear slide navigation (keyboard [ / ]). */
Editor.prototype.goTo = function (d) {
  var n = clamp(this.current + d, 0, this.doc.slides.length - 1);
  if (n === this.current) return;
  this.current = n;
  this.selIds = [];
  this.renderAll();
  this.ppt.emit("slidechange", { index: n });
  this.emitState();
};

Editor.prototype.setSlideBackground = function (color) {
  var slide = this.slide();
  if (!slide) return;
  this.beginChange();
  slide.background = color;
  if (this.layer) this.layer.style.background = color;
  this.renderThumbs();
  this.commit();
};

Editor.prototype.setTransition = function (t) {
  var slide = this.slide();
  if (!slide) return;
  this.beginChange();
  slide.transition = t;
  this.commit();
};

Editor.prototype.addSlide = function () {
  var doc = this.doc;
  var slide = this.slide();
  this.beginChange();
  var ns = blankSlide(doc.theme);
  ns.transition = slide ? slide.transition : "morph";
  doc.slides.splice(this.current + 1, 0, ns);
  this.current++;
  this.selIds = [];
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: this.current });
};

Editor.prototype.duplicateSlide = function () {
  var doc = this.doc;
  var slide = this.slide();
  if (!slide) return;
  this.beginChange();
  var cp = deepClone(slide);
  cp.id = uid();
  // keep element ids — that's what powers morph between the pair
  doc.slides.splice(this.current + 1, 0, cp);
  this.current++;
  this.selIds = [];
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: this.current });
};

Editor.prototype.deleteSlide = function () {
  var doc = this.doc;
  if (doc.slides.length <= 1) return false;
  var self = this;
  this.beginChange();
  var gone = doc.slides[this.current];
  (gone.elements || []).forEach(function (el) {
    self.notifyImageRemoved(el);
  });
  doc.slides.splice(this.current, 1);
  this.current = clamp(this.current, 0, doc.slides.length - 1);
  this.selIds = [];
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: this.current });
  return true;
};

Editor.prototype.moveSlide = function (d) {
  var doc = this.doc;
  var to = this.current + (d < 0 ? -1 : 1);
  if (to < 0 || to >= doc.slides.length) return false;
  this.beginChange();
  doc.slides.splice(to, 0, doc.slides.splice(this.current, 1)[0]);
  this.current = to;
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: this.current });
  return true;
};

Editor.prototype.addElement = function (kind) {
  var doc = this.doc;
  var theme = doc.theme;
  var W = doc.size.width,
    H = doc.size.height;
  var el;
  if (kind === "text") {
    el = {
      id: uid(),
      type: "text",
      x: W / 2 - 160,
      y: H / 2 - 40,
      w: 320,
      h: 80,
      rotation: 0,
      opacity: 1,
      html: "Text",
      fontSize: 32,
      fontFamily: theme.fontFamily,
      fontWeight: 400,
      color: theme.color,
      align: "center",
      valign: "middle",
      lineHeight: 1.25,
    };
  } else if (kind === "line") {
    el = {
      id: uid(),
      type: "shape",
      shape: "line",
      x: W / 2 - 120,
      y: H / 2 - 10,
      w: 240,
      h: 20,
      rotation: 0,
      opacity: 1,
      fill: "none",
      stroke: theme.color,
      strokeWidth: 3,
      radius: 0,
      lineEnd: "none",
    };
  } else {
    el = {
      id: uid(),
      type: "shape",
      shape: kind,
      x: W / 2 - 100,
      y: H / 2 - 60,
      w: 200,
      h: 120,
      rotation: 0,
      opacity: 1,
      fill: theme.accent,
      stroke: "",
      strokeWidth: 0,
      radius: kind === "rect" ? 8 : 0,
    };
  }
  this.slide().elements.push(el);
  this.renderCanvas();
  this.select(el.id);
  this.commit();
};

Editor.prototype.insertTable = function () {
  var doc = this.doc,
    theme = doc.theme;
  this.beginChange();
  var st = Object.assign(
    {
      headerBg: theme.accent,
      headerColor: "#ffffff",
      zebra: "rgba(128,128,128,.08)",
      borderColor: "rgba(128,128,128,.3)",
      borderWidth: 1,
      cellPadX: 10,
      cellPadY: 8,
      fontSize: 15,
      color: theme.color,
      radius: 6,
    },
    theme.table || {},
  );
  var el = {
    id: uid(),
    type: "table",
    x: Math.round(doc.size.width / 2 - 260),
    y: Math.round(doc.size.height / 2 - 110),
    w: 520,
    h: 220,
    rotation: 0,
    opacity: 1,
    columns: [{ w: 1 }, { w: 1 }, { w: 1 }, { w: 1 }],
    rows: [
      {
        cells: [
          { html: "Name" },
          { html: "Q1" },
          { html: "Q2" },
          { html: "Q3" },
        ],
      },
      {
        cells: [
          { html: "Alpha" },
          { html: "12" },
          { html: "18" },
          { html: "27" },
        ],
      },
      {
        cells: [
          { html: "Beta" },
          { html: "8" },
          { html: "11" },
          { html: "16" },
        ],
      },
    ],
    header: true,
    style: st,
  };
  this.slide().elements.push(el);
  this.renderCanvas();
  this.select(el.id);
  this.commit();
};

Editor.prototype.insertChart = function (preset) {
  var doc = this.doc;
  this.beginChange();
  var option;
  if (preset === "pie") {
    option = {
      series: [
        {
          type: "pie",
          name: "Share",
          data: [
            { name: "A", value: 42 },
            { name: "B", value: 28 },
            { name: "C", value: 18 },
            { name: "D", value: 12 },
          ],
        },
      ],
    };
  } else if (preset === "line" || preset === "scatter") {
    option = {
      xAxis: { data: ["W1", "W2", "W3", "W4", "W5", "W6"] },
      series: [
        { type: preset, name: "Series 1", data: [12, 19, 15, 24, 22, 31] },
        { type: preset, name: "Series 2", data: [8, 11, 13, 17, 19, 24] },
      ],
    };
  } else {
    preset = "bar";
    option = {
      xAxis: { data: ["Q1", "Q2", "Q3", "Q4"] },
      series: [
        { type: "bar", name: "Series 1", data: [12, 19, 15, 24] },
        { type: "bar", name: "Series 2", data: [8, 11, 13, 17] },
      ],
    };
  }
  var el = {
    id: uid(),
    type: "chart",
    preset: preset,
    option: option,
    x: Math.round(doc.size.width / 2 - 280),
    y: Math.round(doc.size.height / 2 - 170),
    w: 560,
    h: 340,
    rotation: 0,
    opacity: 1,
  };
  this.slide().elements.push(el);
  this.renderCanvas();
  this.select(el.id);
  this.commit();
};

/** Re-seed a chart with another type, preserving categories/series shape. */
Editor.prototype.reseedChart = function (preset) {
  var el = this.selPrimary() && this.findEl(this.selPrimary());
  if (!el || el.type !== "chart") return;
  this.beginChange();
  var old = el.option || {};
  var cats = (old.xAxis && old.xAxis.data) || [];
  var series = chartSeries(old);
  if (preset === "pie") {
    var vals = (series[0] && series[0].data) || [];
    el.option = {
      series: [
        {
          type: "pie",
          name: (series[0] && series[0].name) || "Share",
          data: vals.map(function (v, i) {
            return {
              name:
                cats[i] != null
                  ? String(cats[i])
                  : (v && v.name) || "S" + (i + 1),
              value:
                typeof v === "object" && v !== null ? +v.value || 0 : +v || 0,
            };
          }),
        },
      ],
    };
  } else {
    if (!cats.length) cats = ["Q1", "Q2", "Q3", "Q4"];
    el.option = {
      xAxis: { data: cats },
      series: (series.length ? series : [{ name: "Series 1", data: [] }]).map(
        function (s) {
          return {
            type: preset,
            name: s.name || "Series",
            data: (s.data || []).map(function (v) {
              return typeof v === "object" && v !== null
                ? +v.value || 0
                : +v || 0;
            }),
          };
        },
      ),
    };
  }
  el.preset = preset;
  this.refreshEl(el);
  this.commit();
};

/** Insert video/audio from a File/Blob (host file picker). Persists via the
 *  host imageStore like images; falls back to dataURL. */
Editor.prototype.insertMedia = function (kind, file) {
  if (!file) return;
  var self = this;
  var store = this.ppt.opts.imageStore;
  this.beginChange();
  var place = function (src) {
    var doc = self.doc;
    var w = kind === "audio" ? 340 : 480,
      h = kind === "audio" ? 54 : 270;
    var el = {
      id: uid(),
      type: "media",
      kind: kind,
      src: src,
      x: Math.round((doc.size.width - w) / 2),
      y: Math.round((doc.size.height - h) / 2),
      w: w,
      h: h,
      rotation: 0,
      opacity: 1,
      controls: true,
    };
    if (kind === "video") el.fit = "contain";
    self.slide().elements.push(el);
    self.renderCanvas();
    self.select(el.id);
    self.commit();
  };
  if (store && typeof store.put === "function") {
    Promise.resolve(store.put(file))
      .then(place)
      .catch(function (e) {
        self._before = null;
        self.ppt.emit("error", { message: String((e && e.message) || e) });
      });
  } else {
    var reader = new FileReader();
    reader.onload = function () {
      place(reader.result);
    };
    reader.readAsDataURL(file);
  }
};

Editor.prototype.insertSvg = function (markup) {
  markup = String(markup || "").trim();
  if (!markup || markup.indexOf("<svg") < 0) {
    this.ppt.emit("error", { message: "Not SVG markup" });
    return;
  }
  this.beginChange();
  var doc = this.doc;
  var el = {
    id: uid(),
    type: "svg",
    markup: markup,
    x: Math.round(doc.size.width / 2 - 120),
    y: Math.round(doc.size.height / 2 - 120),
    w: 240,
    h: 240,
    rotation: 0,
    opacity: 1,
  };
  this.slide().elements.push(el);
  this.renderCanvas();
  this.select(el.id);
  this.commit();
};

/* ---- clipboard */

Editor.prototype.copySelection = function (cut) {
  var els = this.selEls();
  if (!els.length) return false;
  var payload = {
    __ppt: "clip",
    elements: els.map(function (el) {
      return deepClone(el);
    }),
  };
  try {
    navigator.clipboard
      .writeText(JSON.stringify(payload))
      .catch(function () {});
  } catch (e) {}
  if (cut) this.deleteSelected();
  return true;
};

Editor.prototype.duplicateSelected = function () {
  var els = this.selEls();
  if (!els.length) return;
  this.beginChange();
  var self = this,
    newIds = [];
  els.forEach(function (el) {
    var cp = deepClone(el);
    cp.id = uid();
    cp.x = (+cp.x || 0) + 12;
    cp.y = (+cp.y || 0) + 12;
    delete cp.from;
    delete cp.to; // connector anchors would be stale
    self.slide().elements.push(cp);
    newIds.push(cp.id);
  });
  this.renderCanvas();
  this.selIds = newIds;
  this.drawSelection();
  this.emitState();
  this.commit();
};

Editor.prototype.pastePayload = function (payload) {
  if (!payload || !Array.isArray(payload.elements) || !payload.elements.length)
    return;
  this.beginChange();
  var self = this,
    newIds = [];
  payload.elements.forEach(function (el) {
    var cp = deepClone(el);
    cp.id = uid();
    cp.x = (+cp.x || 0) + 16;
    cp.y = (+cp.y || 0) + 16;
    delete cp.from;
    delete cp.to;
    self.slide().elements.push(cp);
    newIds.push(cp.id);
  });
  this.renderCanvas();
  this.selIds = newIds;
  this.drawSelection();
  this.emitState();
  this.commit();
};

/** Native paste: image files → insertImage; tagged JSON → elements; plain
 *  text → new text element. Skips while editing text / typing in fields. */
Editor.prototype.bindPaste = function () {
  var self = this;
  this._onPaste = function (e) {
    var ae = document.activeElement;
    if (
      ae &&
      (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))
    )
      return;
    var cd = e.clipboardData;
    if (!cd) return;
    if (cd.files && cd.files.length && /^image\//.test(cd.files[0].type)) {
      e.preventDefault();
      self.insertImage(cd.files[0]);
      return;
    }
    var text = cd.getData("text") || "";
    if (!text) return;
    e.preventDefault();
    try {
      var j = JSON.parse(text);
      if (j && j.__ppt === "clip" && Array.isArray(j.elements)) {
        self.pastePayload(j);
        return;
      }
    } catch (err) {}
    self.beginChange();
    var doc = self.doc;
    var el = {
      id: uid(),
      type: "text",
      x: Math.round(doc.size.width / 2 - 200),
      y: Math.round(doc.size.height / 2 - 40),
      w: 400,
      h: 80,
      rotation: 0,
      opacity: 1,
      html: escapeHtml(text.slice(0, 500)).replace(/\r?\n/g, "<br>"),
      fontSize: 24,
      fontFamily: doc.theme.fontFamily,
      fontWeight: 400,
      color: doc.theme.color,
      align: "left",
      valign: "top",
      lineHeight: 1.3,
    };
    self.slide().elements.push(el);
    self.renderCanvas();
    self.select(el.id);
    self.commit();
  };
  document.addEventListener("paste", this._onPaste);
};

/* ---- connectors + line endpoint editing */

/** Endpoints of a line shape in SLIDE coords (horizontal line in rotated box). */
function lineEndpoints(el) {
  var cx = el.x + el.w / 2,
    cy = el.y + el.h / 2;
  var a = ((el.rotation || 0) * Math.PI) / 180;
  var cos = Math.cos(a),
    sin = Math.sin(a);
  var hw = el.w / 2;
  return {
    a: { x: cx - hw * cos, y: cy - hw * sin },
    b: { x: cx + hw * cos, y: cy + hw * sin },
  };
}

function setLineEndpoints(el, pa, pb) {
  var cx = (pa.x + pb.x) / 2,
    cy = (pa.y + pb.y) / 2;
  var dx = pb.x - pa.x,
    dy = pb.y - pa.y;
  var len = Math.max(Math.sqrt(dx * dx + dy * dy), 4);
  el.x = Math.round(cx - len / 2);
  el.y = Math.round(cy - el.h / 2);
  el.w = Math.round(len);
  el.rotation = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

/** Point on an element's border toward `toward` (side 'auto' = ray intersect). */
function anchorPoint(el, side, toward) {
  var cx = el.x + el.w / 2,
    cy = el.y + el.h / 2;
  if (side && side !== "auto") {
    if (side === "top") return { x: cx, y: el.y };
    if (side === "bottom") return { x: cx, y: el.y + el.h };
    if (side === "left") return { x: el.x, y: cy };
    return { x: el.x + el.w, y: cy };
  }
  var dx = toward.x - cx,
    dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  var t = Math.min(
    dx ? el.w / 2 / Math.abs(dx) : Infinity,
    dy ? el.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Recompute every anchored line on the slide (drops dangling refs). Live —
 *  callers invoke it during drags; it mutates but does NOT commit. */
Editor.prototype.syncConnectors = function () {
  var slide = this.slide();
  if (!slide) return;
  var byId = {};
  slide.elements.forEach(function (el) {
    byId[el.id] = el;
  });
  var self = this;
  slide.elements.forEach(function (el) {
    if (el.type !== "shape" || el.shape !== "line") return;
    if (!el.from && !el.to) return;
    if (el.from && !byId[el.from.el]) delete el.from;
    if (el.to && !byId[el.to.el]) delete el.to;
    if (!el.from && !el.to) {
      self.refreshEl(el);
      return;
    }
    var ep = lineEndpoints(el);
    var pa = el.from ? anchorPoint(byId[el.from.el], el.from.side, ep.b) : ep.a;
    var pb = el.to ? anchorPoint(byId[el.to.el], el.to.side, ep.a) : ep.b;
    setLineEndpoints(el, pa, pb);
    self.refreshEl(el);
  });
};

/** Topmost element whose box contains slide point p (excluding excludeId). */
Editor.prototype.elementAt = function (p, excludeId) {
  var els = this.slide().elements;
  for (var i = els.length - 1; i >= 0; i--) {
    var el = els[i];
    if (el.id === excludeId) continue;
    if (p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h)
      return el;
  }
  return null;
};

/** Drag a line endpoint; dropping onto an element anchors it (connector). */
Editor.prototype.startLinePoint = function (e, which) {
  e.preventDefault();
  e.stopPropagation();
  var self = this;
  var el = this.findEl(this.selPrimary());
  if (!el) return;
  this.beginChange();
  var anchorKey = which === "a" ? "from" : "to";
  delete el[anchorKey]; // free while dragging; re-anchored on drop
  var hintNode = null;

  function setHint(node) {
    if (hintNode === node) return;
    if (hintNode) hintNode.classList.remove("ppt-anchor-hint");
    hintNode = node;
    if (hintNode) hintNode.classList.add("ppt-anchor-hint");
  }
  function move(ev) {
    var p = self.slidePoint(ev);
    var ep = lineEndpoints(el);
    ep[which] = p;
    setLineEndpoints(el, ep.a, ep.b);
    self.refreshEl(el);
    self.drawSelection();
    var hit = self.elementAt(p, el.id);
    setHint(hit ? self.elNode(hit.id) : null);
  }
  function up(ev) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    setHint(null);
    var p = self.slidePoint(ev);
    var hit = self.elementAt(p, el.id);
    if (hit) el[anchorKey] = { el: hit.id, side: "auto" };
    self.syncConnectors();
    self.refreshEl(el);
    self.drawSelection();
    self.commit();
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

/* ---- pen tool + bezier path editing */

var bezLerp = function (a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
var bezR = function (v) {
  return Math.round(v * 100) / 100;
};
var bezDist = function (a, b) {
  var dx = a.x - b.x,
    dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Parse SVG path (M/L/C/Q/S/Z, absolute+relative) into cubic bezier nodes.
 *  Straight segments get handles on the chord (thirds) so everything edits
 *  uniformly. Arcs (A) are NOT supported — caller refuses such paths. */
function dToBezier(d) {
  var tokens =
    String(d || "").match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  var nodes = [];
  var closed = false;
  var i = 0,
    cmd = "",
    px = 0,
    py = 0,
    sx = 0,
    sy = 0;
  var num = function () {
    return Number(tokens[i++]);
  };
  function pushNode(x, y, c1, c2) {
    var prev = nodes[nodes.length - 1];
    var p = { x: x, y: y };
    var node = {
      p: p,
      in: c2 || (prev ? bezLerp(prev.p, p, 2 / 3) : undefined),
      out: undefined,
      corner: false,
    };
    if (prev) prev.out = c1 || bezLerp(prev.p, p, 1 / 3);
    nodes.push(node);
    px = x;
    py = y;
  }
  while (i < tokens.length) {
    var tk = tokens[i];
    if (/^[a-zA-Z]$/.test(tk)) {
      cmd = tk;
      i++;
      if (/z/i.test(cmd)) {
        closed = true;
        px = sx;
        py = sy;
      }
      continue;
    }
    var rel = cmd >= "a" && cmd <= "z";
    var C = cmd.toUpperCase();
    if (C === "M") {
      var mx = num() + (rel ? px : 0),
        my = num() + (rel ? py : 0);
      nodes.push({ p: { x: mx, y: my }, corner: false });
      px = sx = mx;
      py = sy = my;
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      pushNode(num() + (rel ? px : 0), num() + (rel ? py : 0));
    } else if (C === "H") {
      pushNode(num() + (rel ? px : 0), py);
    } else if (C === "V") {
      pushNode(px, num() + (rel ? py : 0));
    } else if (C === "C") {
      var c1 = { x: num() + (rel ? px : 0), y: num() + (rel ? py : 0) };
      var c2 = { x: num() + (rel ? px : 0), y: num() + (rel ? py : 0) };
      pushNode(num() + (rel ? px : 0), num() + (rel ? py : 0), c1, c2);
    } else if (C === "S") {
      var prevS = nodes[nodes.length - 1];
      var rc1 =
        prevS && prevS.out
          ? { x: 2 * px - prevS.out.x, y: 2 * py - prevS.out.y }
          : { x: px, y: py };
      var sc2 = { x: num() + (rel ? px : 0), y: num() + (rel ? py : 0) };
      pushNode(num() + (rel ? px : 0), num() + (rel ? py : 0), rc1, sc2);
    } else if (C === "Q") {
      var q = { x: num() + (rel ? px : 0), y: num() + (rel ? py : 0) };
      var qe = { x: num() + (rel ? px : 0), y: num() + (rel ? py : 0) };
      var qc1 = { x: px + (2 / 3) * (q.x - px), y: py + (2 / 3) * (q.y - py) };
      var qc2 = {
        x: qe.x + (2 / 3) * (q.x - qe.x),
        y: qe.y + (2 / 3) * (q.y - qe.y),
      };
      pushNode(qe.x, qe.y, qc1, qc2);
    } else if (C === "A" || C === "T") {
      // T: smooth quadratic — reflect previous Q control is not tracked; treat as line
      if (C === "T") {
        pushNode(num() + (rel ? px : 0), num() + (rel ? py : 0));
      } else return null; // arcs unsupported
    } else {
      i++; // skip unknown token
    }
  }
  if (nodes.length < 2) return null;
  if (closed && nodes.length > 1) {
    var f = nodes[0],
      l = nodes[nodes.length - 1];
    if (!l.out) l.out = bezLerp(l.p, f.p, 1 / 3);
    if (!f.in) f.in = bezLerp(l.p, f.p, 2 / 3);
  }
  return { nodes: nodes, closed: closed };
}

function bezierToD(nodes, closed) {
  if (!nodes.length) return "";
  var d = "M" + bezR(nodes[0].p.x) + " " + bezR(nodes[0].p.y);
  var n = nodes.length;
  var segs = closed ? n : n - 1;
  for (var i = 0; i < segs; i++) {
    var a = nodes[i],
      b = nodes[(i + 1) % n];
    var c1 = a.out || a.p,
      c2 = b.in || b.p;
    d +=
      "C" +
      bezR(c1.x) +
      " " +
      bezR(c1.y) +
      " " +
      bezR(c2.x) +
      " " +
      bezR(c2.y) +
      " " +
      bezR(b.p.x) +
      " " +
      bezR(b.p.y);
  }
  if (closed) d += "Z";
  return d;
}

function cubicAt(p0, c1, c2, p1, t) {
  var u = 1 - t;
  var x =
    u * u * u * p0.x +
    3 * u * u * t * c1.x +
    3 * u * t * t * c2.x +
    t * t * t * p1.x;
  var y =
    u * u * u * p0.y +
    3 * u * u * t * c1.y +
    3 * u * t * t * c2.y +
    t * t * t * p1.y;
  return { x: x, y: y };
}

function splitCubic(p0, c1, c2, p1, t) {
  var q0 = bezLerp(p0, c1, t),
    q1 = bezLerp(c1, c2, t),
    q2 = bezLerp(c2, p1, t);
  var r0 = bezLerp(q0, q1, t),
    r1 = bezLerp(q1, q2, t);
  var m = bezLerp(r0, r1, t);
  return { c1l: q0, c2l: r0, mid: m, c1r: r1, c2r: q2 };
}

function bezierBBox(nodes) {
  var xs = [],
    ys = [];
  nodes.forEach(function (nd) {
    xs.push(nd.p.x);
    ys.push(nd.p.y);
    if (nd.in) {
      xs.push(nd.in.x);
      ys.push(nd.in.y);
    }
    if (nd.out) {
      xs.push(nd.out.x);
      ys.push(nd.out.y);
    }
  });
  return {
    x0: Math.min.apply(null, xs),
    y0: Math.min.apply(null, ys),
    x1: Math.max.apply(null, xs),
    y1: Math.max.apply(null, ys),
  };
}

function shiftNodes(nodes, dx, dy) {
  return nodes.map(function (nd) {
    var n = { p: { x: nd.p.x + dx, y: nd.p.y + dy }, corner: nd.corner };
    if (nd.in) n.in = { x: nd.in.x + dx, y: nd.in.y + dy };
    if (nd.out) n.out = { x: nd.out.x + dx, y: nd.out.y + dy };
    return n;
  });
}

/** Build a path shape element from slide-coord bezier nodes. */
Editor.prototype.pathElFromNodes = function (nodes, closed) {
  var bb = bezierBBox(nodes);
  var pad = 6;
  var x = Math.floor(bb.x0 - pad),
    y = Math.floor(bb.y0 - pad);
  var w = Math.max(4, Math.ceil(bb.x1 + pad) - x);
  var h = Math.max(4, Math.ceil(bb.y1 + pad) - y);
  return {
    id: uid(),
    type: "shape",
    shape: "path",
    x: x,
    y: y,
    w: w,
    h: h,
    rotation: 0,
    opacity: 1,
    d: bezierToD(shiftNodes(nodes, -x, -y), closed),
    pathBox: [0, 0, w, h],
    fill: "none",
    stroke: this.doc.theme.color,
    strokeWidth: 3,
    strokeStyle: "solid",
  };
};

Editor.prototype.togglePen = function () {
  if (this.pen) {
    this.cancelPen();
    return;
  }
  this.cancelPathEdit();
  this.select(null);
  this.pen = { nodes: [], cur: null };
  this.canvasWrap.classList.add("ppt-pen-mode");
  var self = this;
  this._penMove = function (e) {
    if (!self.pen) return;
    self.pen.cur = self.slidePoint(e);
    self.drawPen();
  };
  this.layer.addEventListener("pointermove", this._penMove);
  this.emitState();
};

Editor.prototype.cancelPen = function () {
  if (!this.pen) return;
  this.pen = null;
  this.canvasWrap.classList.remove("ppt-pen-mode");
  if (this._penMove && this.layer)
    this.layer.removeEventListener("pointermove", this._penMove);
  this._penMove = null;
  var ov = this.layer && this.layer.querySelector(".ppt-pen");
  if (ov) ov.remove();
  this.emitState();
};

Editor.prototype.finishPen = function (closed) {
  var nodes = this.pen && this.pen.nodes;
  this.cancelPen();
  if (!nodes || nodes.length < 2) return;
  this.beginChange();
  var el = this.pathElFromNodes(nodes, closed);
  this.slide().elements.push(el);
  this.renderCanvas();
  this.select(el.id);
  this.commit();
};

Editor.prototype.penPointerDown = function (e) {
  e.preventDefault();
  var pen = this.pen;
  var p = this.slidePoint(e);
  // click near the first anchor: close the path
  if (pen.nodes.length >= 3 && bezDist(p, pen.nodes[0].p) < 10 / this.scale) {
    this.finishPen(true);
    return;
  }
  var nd = { p: { x: p.x, y: p.y }, corner: false };
  var prev = pen.nodes[pen.nodes.length - 1];
  if (prev) {
    if (!prev.out) prev.out = bezLerp(prev.p, nd.p, 1 / 3);
    nd.in = bezLerp(prev.p, nd.p, 2 / 3);
  }
  pen.nodes.push(nd);
  var self = this;
  var dragged = false;
  function move(ev) {
    var q = self.slidePoint(ev);
    var dx = q.x - nd.p.x,
      dy = q.y - nd.p.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 4 / self.scale) return;
    dragged = true;
    nd.corner = false;
    nd.bent = true;
    nd.out = { x: nd.p.x + dx, y: nd.p.y + dy };
    nd.in = { x: nd.p.x - dx, y: nd.p.y - dy };
    self.drawPen();
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  this.drawPen();
};

/** The pen/path-edit SVG overlay (slide coords, pointer-events none except marks). */
Editor.prototype.drawPen = function () {
  var old = this.layer.querySelector(".ppt-pen");
  if (old) old.remove();
  var self = this;
  var W = this.doc.size.width,
    H = this.doc.size.height;
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ppt-pen");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  function el(name, attrs, cls) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (cls) n.setAttribute("class", cls);
    svg.appendChild(n);
    return n;
  }
  if (this.pen) {
    var nodes = this.pen.nodes;
    if (nodes.length) {
      var d = bezierToD(nodes, false);
      if (this.pen.cur) {
        var last = nodes[nodes.length - 1];
        var c = this.pen.cur;
        // live preview segment from the last anchor to the cursor
        d = bezierToD(
          nodes.concat([
            {
              p: { x: c.x, y: c.y },
              in: bezLerp(last.p, c, 2 / 3),
              corner: false,
            },
          ]),
          false,
        );
      }
      el("path", { d: d }, "ppt-pen-path");
      nodes.forEach(function (nd, i) {
        // only user-bent handles are shown (chord-virtual handles stay invisible)
        if (nd.bent) {
          if (nd.in) {
            el(
              "line",
              { x1: nd.p.x, y1: nd.p.y, x2: nd.in.x, y2: nd.in.y },
              "ppt-pen-hl",
            );
            el("circle", { cx: nd.in.x, cy: nd.in.y, r: 3 }, "ppt-pen-h");
          }
          if (nd.out) {
            el(
              "line",
              { x1: nd.p.x, y1: nd.p.y, x2: nd.out.x, y2: nd.out.y },
              "ppt-pen-hl",
            );
            el("circle", { cx: nd.out.x, cy: nd.out.y, r: 3 }, "ppt-pen-h");
          }
        }
        el(
          "rect",
          { x: nd.p.x - 3.5, y: nd.p.y - 3.5, width: 7, height: 7 },
          i === 0 && nodes.length >= 3
            ? "ppt-pen-a ppt-pen-first"
            : "ppt-pen-a",
        );
      });
    }
  } else if (this.pathEdit) {
    var pe = this.pathEdit;
    var el2 = this.findEl(pe.id);
    el(
      "path",
      {
        d: bezierToD(pe.nodes, pe.closed),
        style: el2
          ? "fill:" +
            (el2.fill || "none") +
            ";stroke:" +
            (el2.stroke || "none") +
            ";stroke-width:" +
            (el2.strokeWidth || 1)
          : "",
      },
      "ppt-pen-live",
    );
    pe.nodes.forEach(function (nd, i) {
      if (nd.in) {
        el(
          "line",
          { x1: nd.p.x, y1: nd.p.y, x2: nd.in.x, y2: nd.in.y },
          "ppt-pen-hl",
        );
        el(
          "circle",
          { cx: nd.in.x, cy: nd.in.y, r: 4, "data-i": i, "data-h": "in" },
          "ppt-bh",
        );
      }
      if (nd.out) {
        el(
          "line",
          { x1: nd.p.x, y1: nd.p.y, x2: nd.out.x, y2: nd.out.y },
          "ppt-pen-hl",
        );
        el(
          "circle",
          { cx: nd.out.x, cy: nd.out.y, r: 4, "data-i": i, "data-h": "out" },
          "ppt-bh",
        );
      }
      el(
        "rect",
        { x: nd.p.x - 4, y: nd.p.y - 4, width: 8, height: 8, "data-i": i },
        "ppt-ba",
      );
    });
  }
  this.layer.appendChild(svg);
};

/* ---- bezier editing of an existing path shape ---- */

Editor.prototype.startPathEdit = function (el) {
  if ((el.rotation || 0) % 360 !== 0) {
    this.ppt.emit("error", { message: "请先将旋转归零再编辑路径" });
    return;
  }
  if (/[aA]/.test(el.d || "")) {
    this.ppt.emit("error", { message: "路径含弧线命令，暂不支持贝塞尔编辑" });
    return;
  }
  var parsed = dToBezier(el.d);
  if (!parsed) {
    this.ppt.emit("error", { message: "路径过短，无法编辑" });
    return;
  }
  // pathBox coords → slide coords (box origin + non-uniform scale from resize)
  var pb = el.pathBox || [0, 0, el.w, el.h];
  var sx = el.w / Math.max(pb[2], 1),
    sy = el.h / Math.max(pb[3], 1);
  var ox = el.x + pb[0],
    oy = el.y + pb[1];
  var nodes = parsed.nodes.map(function (nd) {
    var n = {
      p: { x: ox + nd.p.x * sx, y: oy + nd.p.y * sy },
      corner: nd.corner,
    };
    if (nd.in) n.in = { x: ox + nd.in.x * sx, y: oy + nd.in.y * sy };
    if (nd.out) n.out = { x: ox + nd.out.x * sx, y: oy + nd.out.y * sy };
    return n;
  });
  this.select(el.id);
  this.beginChange();
  this.pathEdit = { id: el.id, nodes: nodes, closed: parsed.closed };
  var node = this.elNode(el.id);
  if (node) node.classList.add("ppt-path-src");
  this.drawPen();
  this.emitState();
};

Editor.prototype.cancelPathEdit = function () {
  if (!this.pathEdit) return;
  var node = this.elNode(this.pathEdit.id);
  if (node) node.classList.remove("ppt-path-src");
  this.pathEdit = null;
  this._before = null; // element was never touched during edit
  var ov = this.layer && this.layer.querySelector(".ppt-pen");
  if (ov) ov.remove();
};

Editor.prototype.finishPathEdit = function () {
  var pe = this.pathEdit;
  if (!pe) return;
  this.pathEdit = null;
  var ov = this.layer.querySelector(".ppt-pen");
  if (ov) ov.remove();
  var el = this.findEl(pe.id);
  if (!el) {
    this._before = null;
    return;
  }
  var node = this.elNode(pe.id);
  if (node) node.classList.remove("ppt-path-src");
  var pad = Math.max(6, (el.strokeWidth || 0) / 2 + 2);
  var bb = bezierBBox(pe.nodes);
  var x = Math.floor(bb.x0 - pad),
    y = Math.floor(bb.y0 - pad);
  var w = Math.max(4, Math.ceil(bb.x1 + pad) - x);
  var h = Math.max(4, Math.ceil(bb.y1 + pad) - y);
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;
  el.d = bezierToD(shiftNodes(pe.nodes, -x, -y), pe.closed);
  el.pathBox = [0, 0, w, h];
  this.refreshEl(el);
  this.drawSelection();
  this.commit();
};

Editor.prototype.pathPointerDown = function (e) {
  var self = this;
  var pe = this.pathEdit;
  var bh = e.target.closest ? e.target.closest(".ppt-bh") : null;
  var ba = e.target.closest ? e.target.closest(".ppt-ba") : null;
  if (bh) {
    e.preventDefault();
    var iH = +bh.getAttribute("data-i"),
      which = bh.getAttribute("data-h");
    var nd = pe.nodes[iH];
    function moveH(ev) {
      var q = self.slidePoint(ev);
      nd[which] = { x: q.x, y: q.y };
      var other = which === "in" ? "out" : "in";
      if (ev.altKey) {
        nd.corner = true; // Alt breaks the mirror — handles move independently
      } else if (!nd.corner) {
        nd[other] = { x: 2 * nd.p.x - q.x, y: 2 * nd.p.y - q.y };
      }
      self.drawPen();
    }
    function upH() {
      window.removeEventListener("pointermove", moveH);
      window.removeEventListener("pointerup", upH);
    }
    window.addEventListener("pointermove", moveH);
    window.addEventListener("pointerup", upH);
    return;
  }
  if (ba) {
    e.preventDefault();
    var iA = +ba.getAttribute("data-i");
    var ndA = pe.nodes[iA];
    var pull = false;
    function moveA(ev) {
      var q = self.slidePoint(ev);
      if (ev.altKey && !pull && bezDist(q, ndA.p) > 3 / self.scale) pull = true;
      if (pull) {
        // Alt+drag: pull handles out of a corner anchor
        ndA.corner = false;
        ndA.out = { x: q.x, y: q.y };
        ndA.in = { x: 2 * ndA.p.x - q.x, y: 2 * ndA.p.y - q.y };
      } else {
        var dx = q.x - ndA.p.x,
          dy = q.y - ndA.p.y;
        ndA.p = { x: q.x, y: q.y };
        if (ndA.in) ndA.in = { x: ndA.in.x + dx, y: ndA.in.y + dy };
        if (ndA.out) ndA.out = { x: ndA.out.x + dx, y: ndA.out.y + dy };
      }
      self.drawPen();
    }
    function upA() {
      window.removeEventListener("pointermove", moveA);
      window.removeEventListener("pointerup", upA);
    }
    window.addEventListener("pointermove", moveA);
    window.addEventListener("pointerup", upA);
    return;
  }
  // clicked empty canvas: finish the edit
  this.finishPathEdit();
};

Editor.prototype.pathDblClick = function (e) {
  var pe = this.pathEdit;
  if (!pe) return;
  var ba = e.target.closest ? e.target.closest(".ppt-ba") : null;
  if (ba) {
    // remove anchor (keep the path viable)
    var i = +ba.getAttribute("data-i");
    var min = pe.closed ? 3 : 2;
    if (pe.nodes.length > min) {
      pe.nodes.splice(i, 1);
      this.drawPen();
    }
    return;
  }
  this.pathInsertAt(this.slidePoint(e));
};

/** Insert an anchor on the segment nearest to slide point p (de Casteljau). */
Editor.prototype.pathInsertAt = function (p) {
  var pe = this.pathEdit;
  var best = null;
  var n = pe.nodes.length;
  var segs = pe.closed ? n : n - 1;
  for (var i = 0; i < segs; i++) {
    var a = pe.nodes[i],
      b = pe.nodes[(i + 1) % n];
    var c1 = a.out || a.p,
      c2 = b.in || b.p;
    for (var s = 0; s <= 24; s++) {
      var t = s / 24;
      var pt = cubicAt(a.p, c1, c2, b.p, t);
      var d = bezDist(pt, p);
      if (!best || d < best.d) best = { d: d, i: i, t: t, pt: pt };
    }
  }
  if (!best || best.d > 8 / this.scale) return false;
  var a2 = pe.nodes[best.i],
    b2 = pe.nodes[(best.i + 1) % n];
  var sp = splitCubic(a2.p, a2.out || a2.p, b2.in || b2.p, b2.p, best.t);
  a2.out = sp.c1l;
  b2.in = sp.c2r;
  pe.nodes.splice(best.i + 1, 0, {
    p: sp.mid,
    in: sp.c2l,
    out: sp.c1r,
    corner: false,
  });
  this.drawPen();
  return true;
};

/* ---- slide insert / reorder */

Editor.prototype.insertSlideAt = function (i) {
  this.beginChange();
  var ns = blankSlide(this.doc.theme);
  var ref = this.doc.slides[i - 1] || this.doc.slides[0];
  ns.transition = (ref && ref.transition) || "morph";
  this.doc.slides.splice(i, 0, ns);
  this.current = i;
  this.selIds = [];
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: i });
};

Editor.prototype.moveSlideTo = function (from, to) {
  var n = this.doc.slides.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
  this.beginChange();
  var s = this.doc.slides.splice(from, 1)[0];
  this.doc.slides.splice(to, 0, s);
  this.current = to;
  this.renderAll();
  this.commit();
  this.ppt.emit("slidechange", { index: to });
  return true;
};

/* ---- keyboard */

Editor.prototype.bindKeys = function () {
  var self = this;
  this._onKey = function (e) {
    var ae = document.activeElement;
    if (
      ae &&
      (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))
    )
      return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      self.undo();
      return;
    }
    if (
      mod &&
      (e.key.toLowerCase() === "y" ||
        (e.key.toLowerCase() === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      self.redo();
      return;
    }
    // zoom: Cmd/Ctrl + = / - / 0
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      self.zoomIn();
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      self.zoomOut();
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      self.zoomReset();
      return;
    }
    // F5: present from current slide
    if (e.key === "F5") {
      e.preventDefault();
      self.ppt.present(self.current);
      return;
    }
    // [ / ]: previous / next slide
    if (e.key === "[") {
      e.preventDefault();
      self.goTo(-1);
      return;
    }
    if (e.key === "]") {
      e.preventDefault();
      self.goTo(1);
      return;
    }
    // pen / path-edit modes: Enter finishes, Escape cancels
    if (self.pen) {
      if (e.key === "Enter") {
        e.preventDefault();
        self.finishPen(false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        self.cancelPen();
      }
      return;
    }
    if (self.pathEdit) {
      if (e.key === "Enter") {
        e.preventDefault();
        self.finishPathEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        self.cancelPathEdit();
      }
      return;
    }
    // Escape: clear selection
    if (e.key === "Escape") {
      if (self.selIds.length) {
        e.preventDefault();
        self.select(null);
      }
      return;
    }
    if (!self.selIds.length) return;
    // clipboard: Ctrl+C / X / D (paste is a native 'paste' event — see bindPaste)
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      self.copySelection(false);
      return;
    }
    if (mod && e.key.toLowerCase() === "x") {
      e.preventDefault();
      self.copySelection(true);
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      self.duplicateSelected();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      self.deleteSelected();
      return;
    }
    var step = e.shiftKey ? 10 : 1;
    var d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (d) {
      e.preventDefault();
      if (!self._nudging) {
        self._nudging = true;
        self.beginChange();
      }
      self.selEls().forEach(function (el) {
        el.x += d[0];
        el.y += d[1];
        var node = self.elNode(el.id);
        if (node) {
          node.style.left = el.x + "px";
          node.style.top = el.y + "px";
        }
      });
      self.drawSelection();
      clearTimeout(self._nudgeT);
      self._nudgeT = setTimeout(function () {
        self._nudging = false;
        self.commit();
      }, 400);
    }
  };
  document.addEventListener("keydown", this._onKey);
};

Editor.prototype.destroy = function () {
  if (this._ro) this._ro.disconnect();
  document.removeEventListener("keydown", this._onKey);
  if (this._onPaste) document.removeEventListener("paste", this._onPaste);
};
/* ------------------------------------------------------------------ PPT */

/**
 * new PPT(target, options)
 *   target:  css selector or element — the host container (give it a height)
 *   options:
 *     doc:      document object or JSON string (default: starter deck)
 *     mode:     'edit' (default) | 'view' | 'present'
 *     onChange: fn(doc) — called after every committed edit
 *     imageStore: optional { put(file)->Promise<url>, remove(url)->Promise }.
 *                 When present, an inserted image is persisted via put() and the
 *                 returned url is stored in element.src; removing an image
 *                 element (delete element / delete slide) calls remove(url).
 *                 Falls back to an inline base64 dataURL when absent.
 *
 * Headless contract:
 *   - no toolbar, no CSS: style the .ppt-* hooks yourself (see ppt/stage.html
 *     in PPT Studio for a complete reference stylesheet)
 *   - editing is driven through the API methods (insertText, setFill, ...)
 *   - subscribe to 'statechange' for a toolbar-ready snapshot (getState())
 *   - events: change | slidechange | statechange | presentclose | error
 */
function PPT(target, options) {
  options = options || {};
  var root =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error("PPT: target not found: " + target);
  this.root = root;
  this.opts = options;
  this.doc = normalizeDoc(options.doc);
  injectDocFonts(this.doc);
  this._events = {};
  this.presenter = null;
  this.editor = null;
  this.viewer = null;
  this.mode = "edit";
  this.setMode(options.mode || "edit");
}

PPT.VERSION = VERSION;
PPT.starterDoc = starterDoc;
PPT.prototype.VERSION = VERSION;

PPT.prototype.setMode = function (mode) {
  this.destroySubs();
  this.root.innerHTML = "";
  this.root.className = this.root.className.replace(/\bppt-\S+/g, "").trim();
  this.mode = mode;
  if (mode === "edit") {
    this.editor = new Editor(this, this.root);
  } else if (mode === "view") {
    this.viewer = new Viewer(this, this.root);
  } else if (mode === "present") {
    this.root.classList.add("ppt-root", "ppt-viewer");
    this.present(0);
  }
  this.emit("statechange", this.getState());
  return this;
};

PPT.prototype.destroySubs = function () {
  if (this.editor) {
    this.editor.destroy();
    this.editor = null;
  }
  if (this.viewer) {
    this.viewer.destroy();
    this.viewer = null;
  }
};

/** Fullscreen presentation from `startIndex` (slide array index). */
PPT.prototype.present = function (startIndex) {
  if (!this.presenter) this.presenter = new Presenter(this);
  this.presenter.doc = this.doc;
  this.presenter.open(startIndex || 0);
  return this;
};

PPT.prototype.closePresent = function () {
  if (this.presenter) this.presenter.close();
  return this;
};

/** The document as a deep-cloned plain object (safe to JSON.stringify). */
PPT.prototype.getDoc = function () {
  return deepClone(this.doc);
};

PPT.prototype.setDoc = function (doc) {
  this.closePresent();
  this.doc = normalizeDoc(doc);
  injectDocFonts(this.doc);
  if (this.editor) {
    this.editor.doc = this.doc;
    this.editor.current = 0;
    this.editor.selIds = [];
    this.editor.undoStack.length = 0;
    this.editor.redoStack.length = 0;
    this.editor.renderAll();
  }
  if (this.viewer) {
    this.viewer.doc = this.doc;
    this.viewer.idx = 0;
    this.viewer.render();
  }
  this.emit("change", { doc: this.getDoc() });
  this.emit("statechange", this.getState());
  return this;
};

PPT.prototype.on = function (evt, fn) {
  (this._events[evt] = this._events[evt] || []).push(fn);
  return this;
};

PPT.prototype.emit = function (evt, payload) {
  var list = this._events[evt] || [];
  for (var i = 0; i < list.length; i++) {
    try {
      list[i](payload);
    } catch (e) {
      setTimeout(function () {
        throw e;
      }, 0);
    }
  }
  if (evt === "change" && typeof this.opts.onChange === "function") {
    this.opts.onChange(payload.doc);
  }
};

/**
 * Toolbar-ready state snapshot. Subscribe to 'statechange' to receive it
 * whenever selection / slide / history / mode changes.
 *   { mode, presenting, current, count, background, transition,
 *     canUndo, canRedo,
 *     selection: null | { id, type, shape, fill, color, fontSize, bold, align } }
 */
PPT.prototype.getState = function () {
  var st = {
    mode: this.mode || "edit",
    presenting: !!(this.presenter && this.presenter.overlay),
    current: 0,
    count: this.doc.slides.length,
    background: "#ffffff",
    transition: "morph",
    canUndo: false,
    canRedo: false,
    zoom: 100,
    size: { width: this.doc.size.width, height: this.doc.size.height },
    slide: null,
    slides: this.doc.slides.map(function (s, i) {
      return { id: s.id, name: s.name || "", index: i, hidden: !!s.stateOf };
    }),
    pen: false,
    selection: null,
  };
  var ed = this.editor;
  if (ed) {
    st.current = ed.current;
    st.canUndo = ed.undoStack.length > 0;
    st.canRedo = ed.redoStack.length > 0;
    st.zoom = Math.round(ed.fitScale * ed.zoom * 100);
    st.pen = !!ed.pen;
    var slide = ed.slide();
    if (slide) {
      st.background = toHex(slide.background) || "#ffffff";
      st.transition = slide.transition || "morph";
      st.slide = {
        id: slide.id,
        name: slide.name || "",
        stateOf: slide.stateOf || "",
        notes: slide.notes || "",
      };
    }
    var els = ed.selEls();
    if (els.length) {
      // primary element deep clone + legacy toolbar fields
      var el = els[els.length - 1];
      var seln = deepClone(el);
      seln.fill = toHex(el.fill) || "#3a6ff7";
      seln.color = toHex(el.color) || "#1f2430";
      seln.fontSize = el.fontSize || 32;
      seln.bold = (+el.fontWeight || 400) >= 700;
      seln.align = el.align || "left";
      seln._count = els.length;
      seln._ids = els.map(function (x) {
        return x.id;
      });
      st.selection = seln;
    }
  } else if (this.viewer) {
    st.current = this.viewer.idx;
  }
  return st;
};

/* ---- editing API delegation (no-ops outside edit mode) ---- */

PPT.prototype.insertText = function () {
  if (this.editor) this.editor.insertText();
  return this;
};
PPT.prototype.insertShape = function (kind) {
  if (this.editor) this.editor.insertShape(kind);
  return this;
};
PPT.prototype.insertImage = function (file) {
  if (this.editor) this.editor.insertImage(file);
  return this;
};
PPT.prototype.deleteSelected = function () {
  if (this.editor) this.editor.deleteSelected();
  return this;
};
PPT.prototype.setFill = function (color) {
  if (this.editor) this.editor.setFill(color);
  return this;
};
PPT.prototype.setTextColor = function (color) {
  if (this.editor) this.editor.setTextColor(color);
  return this;
};
PPT.prototype.setFontSize = function (n) {
  if (this.editor) this.editor.setFontSize(n);
  return this;
};
PPT.prototype.toggleBold = function () {
  if (this.editor) this.editor.toggleBold();
  return this;
};
PPT.prototype.setAlign = function (a) {
  if (this.editor) this.editor.setAlign(a);
  return this;
};
PPT.prototype.setSlideBackground = function (color) {
  if (this.editor) this.editor.setSlideBackground(color);
  return this;
};
PPT.prototype.setTransition = function (t) {
  if (this.editor) this.editor.setTransition(t);
  return this;
};
PPT.prototype.addSlide = function () {
  if (this.editor) this.editor.addSlide();
  return this;
};
PPT.prototype.duplicateSlide = function () {
  if (this.editor) this.editor.duplicateSlide();
  return this;
};
PPT.prototype.deleteSlide = function () {
  if (this.editor) this.editor.deleteSlide();
  return this;
};
PPT.prototype.moveSlide = function (d) {
  if (this.editor) this.editor.moveSlide(d);
  return this;
};

PPT.prototype.undo = function () {
  if (this.editor) this.editor.undo();
  return this;
};
PPT.prototype.redo = function () {
  if (this.editor) this.editor.redo();
  return this;
};
PPT.prototype.insertTable = function () {
  if (this.editor) this.editor.insertTable();
  return this;
};
PPT.prototype.insertChart = function (preset) {
  if (this.editor) this.editor.insertChart(preset);
  return this;
};
PPT.prototype.insertMedia = function (kind, file) {
  if (this.editor) this.editor.insertMedia(kind, file);
  return this;
};
PPT.prototype.insertSvg = function (markup) {
  if (this.editor) this.editor.insertSvg(markup);
  return this;
};
PPT.prototype.reseedChart = function (preset) {
  if (this.editor) this.editor.reseedChart(preset);
  return this;
};
PPT.prototype.duplicateSelected = function () {
  if (this.editor) this.editor.duplicateSelected();
  return this;
};
PPT.prototype.copySelection = function (cut) {
  if (this.editor) this.editor.copySelection(cut);
  return this;
};
PPT.prototype.moveSlideTo = function (from, to) {
  if (this.editor) this.editor.moveSlideTo(from, to);
  return this;
};
PPT.prototype.insertSlideAt = function (i) {
  if (this.editor) this.editor.insertSlideAt(i);
  return this;
};
PPT.prototype.togglePen = function () {
  if (this.editor) this.editor.togglePen();
  return this;
};

/**
 * Print / PDF export: render every linear slide into a hidden iframe at the
 * document's exact pixel size (one slide per page, backgrounds preserved) and
 * invoke the browser print dialog (choose "Save as PDF").
 */
PPT.prototype.print = function () {
  var doc = this.doc;
  var frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  var w = frame.contentWindow,
    d = frame.contentDocument;
  // embedded fonts travel with the deck
  var fontsCss = "";
  if (doc.fonts && doc.fonts.length) {
    fontsCss = doc.fonts
      .map(function (f) {
        var src = resolveAsset(doc, "asset:" + f.asset);
        if (!src) return "";
        return (
          '@font-face{font-family:"' +
          f.family +
          '";src:url(' +
          src +
          ");" +
          (f.weight ? "font-weight:" + f.weight + ";" : "") +
          (f.style ? "font-style:" + f.style + ";" : "") +
          "}"
        );
      })
      .join("");
  }
  d.open();
  d.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      escapeHtml(doc.title) +
      "</title><style>" +
      "@page{size:" +
      doc.size.width +
      "px " +
      doc.size.height +
      "px;margin:0;}" +
      "html,body{margin:0;padding:0;background:#fff;}" +
      ".ppt-slide{position:relative;overflow:hidden;page-break-after:always;break-inside:avoid;" +
      "-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
      ".ppt-slide:last-child{page-break-after:auto;}" +
      ".ppt-el{position:absolute;}" +
      ".ppt-el svg{display:block;}" +
      fontsCss +
      "</style></head><body></body></html>",
  );
  d.close();
  doc.slides.forEach(function (s) {
    if (s.stateOf || s.broken) return; // interactive states / broken pages are skipped in linear print
    var node = renderSlide(s, doc, { hidePlaceholders: true });
    d.body.appendChild(d.importNode(node, true));
  });
  function cleanup() {
    setTimeout(function () {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    }, 1000);
  }
  var fired = false;
  function fire() {
    if (fired) return;
    fired = true;
    try {
      w.focus();
      w.onafterprint = cleanup;
      w.print();
    } catch (e) {
      cleanup();
    }
  }
  // wait for images to decode (bounded), then print
  var imgs = Array.prototype.slice.call(d.querySelectorAll("img"));
  Promise.all(
    imgs.map(function (img) {
      return img.decode
        ? img.decode().catch(function () {})
        : Promise.resolve();
    }),
  ).then(function () {
    setTimeout(fire, 250);
  });
  setTimeout(fire, 3000); // hard fallback
  return this;
};
/* ------------------------------------------------------- PPTX export
 *
 * Offline PowerPoint (.pptx) export built on PptxGenJS. The library and
 * its only dependency (jszip) are vendored under ./vendor/ as plain ES
 * modules, lazy-loaded on first export — no network, no window globals.
 *
 * Mapping notes (ppt/1 -> OOXML):
 *   - text runs keep bold/italic/underline/inline color; gradient text,
 *     text stroke and hollow fall back to the solid color
 *   - shapes map to the closest preset; freeform `path` is skipped
 *   - shapes without a fill are filled with the slide background color
 *     to mimic transparency (no noFill path through PptxGenJS)
 *   - images / svg are embedded as base64 (svg rasterized to PNG)
 *   - charts map the ECharts-style option subset to native pptx charts
 *   - stateOf / broken slides are skipped, mirroring print()
 *   - engine-only motion (morph, fx, hover interactions) has no OOXML
 *     equivalent and is intentionally dropped
 */

let _pptxgenPromise = null;
function loadPptxGen(url) {
  if (!_pptxgenPromise) {
    // absolute URL (preferred, immune to module-base resolution) or relative fallback
    _pptxgenPromise = import(url || "./vendor/pptxgen.esm.js").then(function (m) {
      var Ctor = (m && m.default) || m;
      if (typeof Ctor !== "function") throw new Error("PptxGenJS module invalid");
      return Ctor;
    });
    // reset on failure so a later click can retry
    _pptxgenPromise.catch(function () {
      _pptxgenPromise = null;
    });
  }
  return _pptxgenPromise;
}

/** Any CSS color (hex / rgb() / rgba()) -> 6-digit uppercase hex or null. */
function pptxHex(c) {
  if (typeof c !== "string") return null;
  c = c.trim();
  var m = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(c);
  if (m) {
    var h = function (n) {
      return ("0" + clamp(+n, 0, 255).toString(16)).slice(-2);
    };
    return (h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
  }
  if (c.charAt(0) === "#") c = c.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(c))
    c = c.charAt(0) + c.charAt(0) + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2);
  return /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : null;
}

function pptxFirstStopColor(grad) {
  var stops = (grad && grad.stops) || [];
  for (var i = 0; i < stops.length; i++) {
    var c = pptxHex(stops[i] && stops[i].color);
    if (c) return c;
  }
  return null;
}

/** Drop null/undefined keys (keeps option objects tidy for PptxGenJS). */
function pptxClean(o) {
  var out = {};
  Object.keys(o).forEach(function (k) {
    if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  });
  return out;
}

/** Rich HTML -> plain text (for table cells). */
function pptxStripText(html) {
  return String(html == null ? "" : html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Sanitized rich HTML -> PptxGenJS run list [{text, options}] (b/i/u + inline color). */
function pptxRuns(html, base) {
  var div = document.createElement("div");
  div.innerHTML = sanitizeHtml(String(html == null ? "" : html));
  var runs = [];
  (function walk(node, st) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) {
        if (n.nodeValue) runs.push({ text: n.nodeValue, options: Object.assign({}, st) });
      } else if (n.nodeType === 1) {
        var tag = n.tagName;
        if (tag === "BR") {
          runs.push({ text: "", options: Object.assign({ breakLine: true }, st) });
          continue;
        }
        var ns = Object.assign({}, st);
        if (tag === "B" || tag === "STRONG") ns.bold = true;
        else if (tag === "I" || tag === "EM") ns.italic = true;
        else if (tag === "U") ns.underline = { style: "sng" };
        var col = n.style && n.style.color;
        if (col) {
          var hc = pptxHex(col);
          if (hc) ns.color = hc;
        }
        walk(n, ns);
      }
    }
  })(div, base || {});
  if (!runs.length) runs.push({ text: " ", options: {} });
  return runs;
}

/** Fetch a URL (same-origin fs or data URI) -> dataURL; "" on failure. */
function pptxUrlToDataUrl(url) {
  return new Promise(function (resolve) {
    if (typeof url !== "string" || !url) return resolve("");
    if (url.indexOf("data:") === 0) return resolve(url);
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      })
      .then(function (blob) {
        var fr = new FileReader();
        fr.onload = function () {
          resolve(typeof fr.result === "string" ? fr.result : "");
        };
        fr.onerror = function () { resolve(""); };
        fr.readAsDataURL(blob);
      })
      .catch(function () { resolve(""); });
  });
}

/** SVG markup -> PNG dataURL (2x raster; "" if tainted/undecodable). */
function pptxSvgToPng(markup, w, h) {
  return new Promise(function (resolve) {
    if (!markup) return resolve("");
    var img = new Image();
    img.onload = function () {
      try {
        var cw = Math.max(1, Math.min(4096, Math.round((w || img.width || 100) * 2)));
        var ch = Math.max(1, Math.min(4096, Math.round((h || img.height || 100) * 2)));
        var cv = document.createElement("canvas");
        cv.width = cw;
        cv.height = ch;
        cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL("image/png"));
      } catch (e) {
        resolve("");
      }
    };
    img.onerror = function () { resolve(""); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  });
}

function pptxFileName(title) {
  var n = String(title || "")
    .replace(/\.\./g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return (n || "presentation") + ".pptx";
}

/** Add one ppt/1 element to a PptxGenJS slide. Async jobs return a promise. */
function pptxAddElement(pptx, slide, el, doc, env) {
  var scale = env.scale;
  var box = {
    x: (el.x || 0) * scale,
    y: (el.y || 0) * scale,
    w: Math.max(0.04, (el.w || 0) * scale),
    h: Math.max(0.04, (el.h || 0) * scale),
  };
  var geo = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (el.rotation) geo.rotate = +el.rotation || 0;

  switch (el.type) {
    case "text": {
      var base = {};
      var tc = pptxHex(el.color);
      if (tc) base.color = tc;
      var runs = pptxRuns(
        resolveFields(el.html || "", { page: env.page, pages: env.pages, title: doc.title || "" }),
        base
      );
      var opt = Object.assign({}, geo, {
        fontSize: el.fontSize ? Math.max(1, Math.round(el.fontSize * 0.75)) : undefined,
        fontFace: el.fontFamily || undefined,
        bold: (+el.fontWeight || 0) >= 600 || undefined,
        align: el.align || undefined,
        valign: el.valign || undefined,
        charSpacing: el.letterSpacing ? el.letterSpacing * 0.75 : undefined,
        lineSpacingMultiple: el.lineHeight ? clamp(+el.lineHeight || 1, 0.5, 4) : undefined,
        margin: 0,
      });
      slide.addText(runs, pptxClean(opt));
      return null;
    }
    case "shape": {
      var SH = pptx.shapes;
      var kind = el.shape || "rect";
      var type =
        kind === "rect" ? (el.radius ? SH.ROUNDED_RECTANGLE : SH.RECTANGLE)
        : kind === "ellipse" ? SH.OVAL
        : kind === "triangle" ? SH.TRIANGLE
        : kind === "arrow" ? SH.RIGHT_ARROW
        : kind === "line" ? SH.LINE
        : null;
      if (!type) return null; // freeform path etc.: no preset equivalent
      var sopt = Object.assign({}, geo);
      var dash =
        el.strokeStyle === "dashed" ? "dash" : el.strokeStyle === "dotted" ? "dot" : undefined;
      if (kind === "line") {
        var lc =
          pptxHex(el.stroke) || pptxHex(el.fill) || pptxHex(env.theme.accent) || "3A6FF7";
        sopt.line = pptxClean({
          color: lc,
          width: Math.max(0.5, (el.strokeWidth || 2) * 0.75),
          dashType: dash,
        });
        var tips = { arrow: "triangle", dot: "oval", bar: "diamond" };
        if (el.lineStart && tips[el.lineStart]) sopt.line.beginArrowType = tips[el.lineStart];
        if (el.lineEnd && tips[el.lineEnd]) sopt.line.endArrowType = tips[el.lineEnd];
      } else {
        var fill = pptxHex(el.fill) || pptxFirstStopColor(el.fillGradient) || env.bg || "FFFFFF";
        sopt.fill = { color: fill };
        if (el.opacity != null && +el.opacity < 1)
          sopt.fill.transparency = Math.round((1 - +el.opacity) * 100);
        var sc = pptxHex(el.stroke);
        if (sc && el.strokeWidth) {
          sopt.line = pptxClean({
            color: sc,
            width: Math.max(0.25, el.strokeWidth * 0.75),
            dashType: dash,
          });
        }
        if (kind === "rect" && el.radius)
          sopt.rectRadius = clamp(el.radius * scale, 0.01, Math.min(box.w, box.h) / 2);
      }
      slide.addShape(type, pptxClean(sopt));
      return null;
    }
    case "image": {
      return pptxUrlToDataUrl(resolveAsset(doc, el.src || "")).then(function (data) {
        if (!data) return;
        var iopt = Object.assign({}, geo, { data: data });
        if (el.fit === "contain" || el.fit === "cover")
          iopt.sizing = { type: el.fit, w: geo.w, h: geo.h };
        slide.addImage(iopt);
      });
    }
    case "svg": {
      var markup = el.markup || (el.asset ? resolveAsset(doc, "asset:" + el.asset) : "") || "";
      return pptxSvgToPng(markup, el.w, el.h).then(function (data) {
        if (data) slide.addImage(Object.assign({}, geo, { data: data }));
      });
    }
    case "table": {
      var st = el.style || {};
      var cols = el.columns || [];
      var data = (el.rows || []).map(function (row, ri) {
        var head = !!(el.header && ri === 0);
        return (row.cells || []).map(function (cell) {
          var fillc = pptxHex(cell.bg || (head ? st.headerBg : "")) || null;
          return {
            text: pptxStripText(cell.html || ""),
            options: pptxClean({
              align: cell.align || "left",
              bold: !!(cell.bold || head) || undefined,
              color: pptxHex(cell.color || (head ? st.headerColor : st.color)) || undefined,
              fill: fillc ? { color: fillc } : undefined,
            }),
          };
        });
      });
      if (!data.length) return null;
      var topt = Object.assign({}, geo, {
        fontSize: Math.max(4, Math.round((st.fontSize || 15) * 0.75)),
        fontFace: st.fontFamily || undefined,
        color: pptxHex(st.color) || undefined,
        valign: "middle",
      });
      var bc = pptxHex(st.borderColor);
      if (bc)
        topt.border = { type: "solid", color: bc, pt: Math.max(0.25, (st.borderWidth || 1) * 0.75) };
      if (cols.length) {
        var total = cols.reduce(function (a, c) { return a + (+c.w || 0); }, 0) || 1;
        topt.colW = cols.map(function (c) {
          return Math.max(0.1, ((+c.w || 0) / total) * box.w);
        });
      }
      slide.addTable(data, pptxClean(topt));
      return null;
    }
    case "chart": {
      var o = el.option || {};
      var series = Array.isArray(o.series) ? o.series : [];
      if (!series.length) return null;
      var ck = series[0].type || "bar";
      var ct =
        ck === "line" ? pptx.charts.LINE
        : ck === "pie" ? pptx.charts.PIE
        : ck === "scatter" ? pptx.charts.SCATTER
        : pptx.charts.BAR;
      var labels =
        (o.xAxis && Array.isArray(o.xAxis.data) && o.xAxis.data) ||
        (series[0].data || []).map(function (_v, i) { return String(i + 1); });
      var cdata = series.map(function (se) {
        return {
          name: String(se.name || se.type || "series"),
          labels: labels,
          values: (se.data || []).map(Number),
        };
      });
      slide.addChart(
        ct,
        cdata,
        Object.assign({}, geo, { showLegend: series.length > 1 || ck === "pie", showTitle: false })
      );
      return null;
    }
    case "media": {
      if (el.poster) {
        return pptxUrlToDataUrl(resolveAsset(doc, el.poster)).then(function (data) {
          if (data) slide.addImage(Object.assign({}, geo, { data: data }));
        });
      }
      return null;
    }
  }
  return null;
}

/**
 * Export the current deck as a PowerPoint file (.pptx) and trigger a
 * browser download. Returns a promise resolving to the file name.
 * PptxGenJS is lazy-loaded from ./vendor/ on first use (fully offline).
 */
PPT.prototype.exportPptx = function (opts) {
  opts = opts || {};
  var doc = this.doc;
  if (!doc || !Array.isArray(doc.slides)) return Promise.reject(new Error("empty document"));
  return loadPptxGen(opts.pptxgenUrl).then(function (PptxGenJS) {
    var pptx = new PptxGenJS();
    var W = +doc.size.width || 1280;
    var H = +doc.size.height || 720;
    var LW = 13.333; // inches; slide height keeps the deck's aspect ratio
    var scale = LW / W;
    pptx.defineLayout({ name: "PPT_STUDIO", width: LW, height: H * scale });
    pptx.layout = "PPT_STUDIO";
    pptx.title = doc.title || "Presentation";
    pptx.author = "PPT Studio";
    var theme = doc.theme || {};
    var linear = doc.slides.filter(function (s) { return s && !s.stateOf && !s.broken; });
    var jobs = [];
    linear.forEach(function (s, si) {
      var slide = pptx.addSlide();
      var bg = pptxHex(s.background || theme.background);
      if (bg) slide.background = { color: bg };
      if (s.notes) {
        try { slide.addNotes(String(s.notes)); } catch (e) {}
      }
      var env = { scale: scale, page: si + 1, pages: linear.length, bg: bg, theme: theme };
      (s.elements || []).forEach(function (el) {
        try {
          var job = pptxAddElement(pptx, slide, el, doc, env);
          if (job) jobs.push(job);
        } catch (e) {
          console.warn("[PPT] pptx export: skip element", el && el.id, e);
        }
      });
    });
    return Promise.all(jobs).then(function () {
      var name = opts.fileName || pptxFileName(doc.title);
      if (!/\.pptx$/i.test(name)) name += ".pptx";
      return pptx.writeFile({ fileName: name }).then(function () { return name; });
    });
  });
};

PPT.prototype.updateSelected = function (props) {
  if (this.editor) this.editor.updateSelected(props);
  return this;
};
PPT.prototype.updateSlide = function (props) {
  if (this.editor) this.editor.updateSlide(props);
  return this;
};
PPT.prototype.updateDocSize = function (w, h) {
  if (this.editor) this.editor.updateDocSize(w, h);
  return this;
};
PPT.prototype.goTo = function (d) {
  if (this.editor) this.editor.goTo(d);
  return this;
};
PPT.prototype.setZoom = function (z) {
  if (this.editor) this.editor.setZoom(z);
  return this;
};
PPT.prototype.zoomIn = function () {
  if (this.editor) this.editor.zoomIn();
  return this;
};
PPT.prototype.zoomOut = function () {
  if (this.editor) this.editor.zoomOut();
  return this;
};
PPT.prototype.zoomReset = function () {
  if (this.editor) this.editor.zoomReset();
  return this;
};

PPT.prototype.destroy = function () {
  this.closePresent();
  this.destroySubs();
  this.root.innerHTML = "";
  this._events = {};
};

export default PPT;
