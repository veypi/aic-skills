/**
 * ============================================================================
 * kernel.js —— 3D 几何内核（纯数据，无 DOM / 无渲染依赖）
 * ============================================================================
 *
 * 内容：
 *   1. 基础数学工具（向量 / 矩阵）
 *   2. GeomError 与内核执行控制（超时 / 中断）
 *   3. Shape —— 三角网格几何体（变换 / CSG / fillet / 统计）
 *   4. 二维轮廓工具（三角化 / 矩形 / 圆 / 圆角）
 *   5. 拉伸与旋转成型
 *   6. 图元（box / cylinder / cone / sphere / torus / pipe / gear）
 *   7. CSG 布尔运算（BSP 树）
 *   8. 网格导出器（STL / OBJ / JSON）
 *   9. @param 参数解析
 *  10. KERNEL_API —— 注入用户代码作用域的内核 API
 *  11. 格式化工具
 * ============================================================================
 */

/* ============================================================================
 * 一、基础数学工具
 * ========================================================================== */

const DEG2RAD = Math.PI / 180;

function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vLength(a) { return Math.hypot(a[0], a[1], a[2]); }
function vNormalize(a) {
  const l = vLength(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function vLerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 行主序 4x4 矩阵 */
function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4Multiply(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
function mat4Apply(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}
function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[3] = x; m[7] = y; m[11] = z;
  return m;
}
function mat4Scale(x, y, z) {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}
/** 绕任意单位轴旋转（Rodrigues），角度制 */
function mat4Rotate(axis, deg) {
  const [x, y, z] = vNormalize(axis);
  const t = deg * DEG2RAD;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C,     x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C,     y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,     0,
    0, 0, 0, 1,
  ];
}

/* ============================================================================
 * 二、几何内核错误类型
 * ========================================================================== */

export class GeomError extends Error {
  constructor(message, { code = 'KERNEL_ERROR', recoverable = false, suggestion = '' } = {}) {
    super(message);
    this.name = 'GeomError';
    this.errorType = 'KERNEL_ERROR';
    this.code = code;
    this.recoverable = recoverable;
    this.suggestion = suggestion;
  }
}

/** 内核执行控制（超时 / 中断），由 Viewer.run 注入 */
const _kernelCtrl = { deadline: 0, aborted: false };
let _kernelCheckCounter = 0;
function kernelCheckpoint() {
  if ((++_kernelCheckCounter & 0xff) !== 0) return;
  if (_kernelCtrl.aborted) {
    throw new GeomError('计算已被用户中断', { code: 'ABORTED', recoverable: true, suggestion: '点击"运行"重新开始' });
  }
  if (_kernelCtrl.deadline && Date.now() > _kernelCtrl.deadline) {
    throw new GeomError('计算超时', { code: 'TIMEOUT', recoverable: true, suggestion: '请减小模型精度（如降低圆弧分段数）或简化布尔运算' });
  }
}

/* ============================================================================
 * 三·五、执行追踪（设计步骤树）
 *
 * run() 期间记录真实发生的几何操作：图元创建 / 草图拉伸 / 布尔 / 变换 / 镜像 / 阵列 / 孔。
 * 循环与条件自动展开为实际步骤；每步经调用栈记录源码行号（与错误定位同规则 -3）。
 * Shape/Sketch/OCCTShape 方法为常驻钩子（active 门控零开销）；api 函数由 traceApi 逐次包装。
 * ========================================================================== */

const _trace = { active: false, entries: [], srcLines: [], suspend: 0 };

function _traceStart(srcCode) {
  _trace.active = true;
  _trace.entries = [];
  _trace.srcLines = String(srcCode || '').split('\n');
  _trace.suspend = 0;
}
function _traceStop() { _trace.active = false; }
function _traceSuspend() { _trace.suspend++; }
function _traceResume() { _trace.suspend--; }

/** 记录一步（resultId 新形状 / targetId 目标形状 / argIds 参与形状） */
function _recTrace(op, args, { resultId = null, targetId = null, argIds = [] } = {}) {
  if (!_trace.active || _trace.suspend > 0) return;
  let line = null;
  try {
    const m = (new Error().stack || '').match(/<anonymous>:(\d+):(\d+)/);
    if (m) line = Math.max(1, parseInt(m[1], 10) - 3);
  } catch (_) { }
  _trace.entries.push({ seq: _trace.entries.length + 1, op, args, resultId, targetId, argIds, line });
}

const _TRACE_SKIP = new Set(['deg2rad', 'gearProfile', 'Sketch', 'Shape']);
/** 包装内核 API 表：图元/草图/孔等函数逐项记录（类与纯函数跳过） */
function traceApi(api) {
  const out = {};
  for (const k of Object.keys(api)) {
    const v = api[k];
    if (typeof v !== 'function' || _TRACE_SKIP.has(k)) { out[k] = v; continue; }
    out[k] = function (...args) {
      const r = v.apply(this, args);
      _recTrace(k, args, { resultId: r && r.id !== undefined ? r.id : null });
      return r;
    };
  }
  return out;
}

const _fmtN = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
};

function _stepText(e, nameOf) {
  const a = e.args || [];
  switch (e.op) {
    case 'box': { const w = a[0] ?? 10, d = a[1] ?? w, h = a[2] ?? d; return `立方体 ${_fmtN(w)} × ${_fmtN(d)} × ${_fmtN(h)}`; }
    case 'cylinder': { const r = a[0] ?? 5, h = a[1] ?? 10; return `圆柱 ⌀${_fmtN(r * 2)} × ${_fmtN(h)}`; }
    case 'cone': return `圆台 ⌀${_fmtN((a[0] ?? 5) * 2)}→⌀${_fmtN((a[1] ?? 0) * 2)} × ${_fmtN(a[2] ?? 10)}`;
    case 'sphere': return `球 ⌀${_fmtN((a[0] ?? 5) * 2)}`;
    case 'torus': return `圆环 R${_fmtN(a[0] ?? 8)} × r${_fmtN(a[1] ?? 2)}`;
    case 'pipe': return `圆管 ⌀${_fmtN((a[0] ?? 6) * 2)}/⌀${_fmtN((a[1] ?? 4) * 2)} × ${_fmtN(a[2] ?? 10)}`;
    case 'revolve': case 'lathe': return `旋转成型（${(a[0] || []).length} 个轮廓点）`;
    case 'hole': {
      const o = a[2] || {};
      const kind = o.cboreR ? `沉头 ⌀${_fmtN(o.cboreR * 2)}×${_fmtN(o.cboreH)}` : o.csinkAngle ? `锥孔 ${o.csinkAngle}°` : '过孔';
      return `孔刀具：${kind} ⌀${_fmtN((a[0] ?? 3) * 2)} 深 ${_fmtN(a[1] ?? 10)}`;
    }
    case 'sketchRect': return `草图：矩形 ${_fmtN(a[0] ?? 10)} × ${_fmtN(a[1] ?? 10)}`;
    case 'sketchCircle': return `草图：圆 ⌀${_fmtN((a[0] ?? 5) * 2)}`;
    case 'sketchRoundedRect': return `草图：圆角矩形 ${_fmtN(a[0] ?? 10)} × ${_fmtN(a[1] ?? 10)} R${_fmtN(a[2] ?? 2)}`;
    case 'sketchPolygon': return `草图：多边形（${(a[0] || []).length} 点）`;
    case 'extrude': return `拉伸 ${_fmtN(a[0])}mm（${nameOf(e.targetId)}）`;
    case 'fuse': return `组合：${nameOf(e.targetId)} ∪ ${nameOf(e.argIds[0])}`;
    case 'cut': return `切割：${nameOf(e.targetId)} − ${nameOf(e.argIds[0])}`;
    case 'intersect': return `求交：${nameOf(e.targetId)} ∩ ${nameOf(e.argIds[0])}`;
    case 'fillet': return `圆角 R${_fmtN(a[0] ?? 1)}（${nameOf(e.targetId)}）`;
    case 'mirror': return `镜像 ${a[0] || 'XY'}（${nameOf(e.targetId)}）`;
    case 'linearPattern': return `线性阵列 ×${a[0] ?? 2}（步进 ${_fmtN(a[1])}, ${_fmtN(a[2])}, ${_fmtN(a[3])}）`;
    case 'circularPattern': return `圆周阵列 ×${a[0] ?? 3}（${typeof a[1] === 'string' ? a[1] : '自定义轴'}${a[2] !== undefined && a[2] !== 360 ? '，' + _fmtN(a[2]) + '°' : ''}）`;
    case 'translate': return `移动 (${_fmtN(a[0])}, ${_fmtN(a[1])}, ${_fmtN(a[2])})`;
    case 'rotateX': return `旋转 X ${_fmtN(a[0])}°`;
    case 'rotateY': return `旋转 Y ${_fmtN(a[0])}°`;
    case 'rotateZ': return `旋转 Z ${_fmtN(a[0])}°`;
    case 'rotate': return `绕轴旋转 ${_fmtN(a[1])}°`;
    case 'scale': return `缩放 ${a.map(_fmtN).join(', ')}`;
    default: return e.op;
  }
}

const _STEP_BASE = {
  box: '立方体', cylinder: '圆柱', cone: '圆台', sphere: '球', torus: '圆环', pipe: '圆管',
  revolve: '旋转体', lathe: '旋转体', hole: '孔刀具',
  sketchRect: '草图', sketchCircle: '草图', sketchRoundedRect: '草图', sketchPolygon: '草图',
  extrude: '拉伸体', fuse: '组合体', cut: '切割体', intersect: '交集体',
  mirror: '镜像体', linearPattern: '阵列体', circularPattern: '阵列体', fillet: '圆角体',
};

/** 形状命名：源行变量名（const side = ...）优先，否则按类型编号 */
function _shapeNamer(entries, srcLines) {
  const names = new Map();
  const counters = new Map();
  for (const e of entries) {
    if (e.resultId == null || names.has(e.resultId)) continue;
    let nm = null;
    if (e.line != null) {
      const m = (srcLines[e.line - 1] || '').match(/(?:const|let|var)\s+([\w$\u4e00-\u9fa5]+)\s*=/);
      if (m) nm = m[1];
    }
    // 链式调用继承目标名（如 const side = sketch().extrude() —— extrude 结果继承 side）
    if (!nm && e.targetId != null && names.has(e.targetId)) nm = names.get(e.targetId);
    if (!nm) {
      const base = _STEP_BASE[e.op] || '几何体';
      const c = (counters.get(base) || 0) + 1;
      counters.set(base, c);
      nm = base + c;
    }
    names.set(e.resultId, nm);
  }
  return (id) => (id == null ? '?' : names.get(id) || '中间件#' + id);
}

/** 由追踪记录构建按部件分组的设计步骤树 */
function buildSteps(parts) {
  const entries = _trace.entries;
  const srcLines = _trace.srcLines;
  const nameOf = _shapeNamer(entries, srcLines);
  const lastProducer = new Map();
  const parents = entries.map((e, i) => {
    const ps = new Set();
    if (e.targetId != null && lastProducer.has(e.targetId)) ps.add(lastProducer.get(e.targetId));
    for (const aid of e.argIds || []) if (aid != null && lastProducer.has(aid)) ps.add(lastProducer.get(aid));
    if (e.resultId != null) lastProducer.set(e.resultId, i);
    return [...ps];
  });
  const lineageOf = (id) => {
    const out = new Set();
    const start = lastProducer.get(id);
    if (start === undefined) return out;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (out.has(i)) continue;
      out.add(i);
      for (const p of parents[i]) stack.push(p);
    }
    return out;
  };
  const MINOR = new Set(['translate', 'rotateX', 'rotateY', 'rotateZ', 'rotate', 'scale']);
  const used = new Set();
  const groups = parts.map((p, pi) => {
    const steps = [...lineageOf(p.shape.id)].sort((a, b) => a - b).map((i) => {
      const e = entries[i];
      used.add(i);
      return {
        seq: i + 1,
        text: _stepText(e, nameOf),
        minor: MINOR.has(e.op),
        src: e.line != null ? (srcLines[e.line - 1] || '').trim() : '',
      };
    });
    return { name: p.name, partIndex: pi, steps };
  });
  return { groups, unusedCount: entries.length - used.size };
}


/* ============================================================================
 * 三、Shape —— 三角网格几何体（内核核心数据结构）
 * ========================================================================== */

let _shapeUid = 0;

export class Shape {
  /**
   * @param {Array<number>|Float32Array} positions 扁平的 xyz 顶点数组
   * @param {Array<number>|Uint32Array}  indices   三角形索引
   * @param {object|null} meta 生成元数据（用于 fillet 等参数化操作）
   */
  constructor(positions, indices, meta = null) {
    this.id = ++_shapeUid;
    this.positions = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    this.indices = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
    this.meta = meta; // { kind, params, matrix }
  }

  get vertexCount() { return this.positions.length / 3; }
  get triangleCount() { return this.indices.length / 3; }

  clone() {
    return new Shape(
      Float32Array.from(this.positions),
      Uint32Array.from(this.indices),
      this.meta ? { ...this.meta, matrix: [...(this.meta.matrix || mat4Identity())], params: { ...this.meta.params } } : null,
    );
  }

  /* ---------- 几何统计 ---------- */

  bounds() {
    const p = this.positions;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
    return { min, max };
  }

  /** 有符号四面体体积求和（自动取绝对值） */
  volume() {
    const p = this.positions, idx = this.indices;
    let v = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      v +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return Math.abs(v / 6);
  }

  area() {
    const p = this.positions, idx = this.indices;
    let s = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      s += vLength(vCross(ab, ac)) / 2;
    }
    return s;
  }

  /** 唯一边统计（用于属性面板） */
  edgeCount() {
    const idx = this.indices;
    const set = new Set();
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = idx[i + k], b = idx[i + ((k + 1) % 3)];
        set.add(a < b ? a * 0x100000000 + b : b * 0x100000000 + a);
      }
    }
    return set.size;
  }

  /* ---------- 变换（链式，原地修改并返回 this） ---------- */

  _applyMatrix(m) {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i]     = m[0] * x + m[1] * y + m[2] * z + m[3];
      p[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
      p[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    if (this.meta) {
      this.meta.matrix = mat4Multiply(m, this.meta.matrix || mat4Identity());
    }
    return this;
  }

  translate(x = 0, y = 0, z = 0) {
    const r = this._applyMatrix(mat4Translate(x, y, z));
    _recTrace('translate', [x, y, z], { targetId: this.id, resultId: this.id });
    return r;
  }
  scale(x = 1, y, z) {
    if (y === undefined) { y = x; z = x; }
    const r = this._applyMatrix(mat4Scale(x, y, z));
    _recTrace('scale', [x, y, z], { targetId: this.id, resultId: this.id });
    return r;
  }
  rotateX(deg) { const r = this._applyMatrix(mat4Rotate([1, 0, 0], deg)); _recTrace('rotateX', [deg], { targetId: this.id, resultId: this.id }); return r; }
  rotateY(deg) { const r = this._applyMatrix(mat4Rotate([0, 1, 0], deg)); _recTrace('rotateY', [deg], { targetId: this.id, resultId: this.id }); return r; }
  rotateZ(deg) { const r = this._applyMatrix(mat4Rotate([0, 0, 1], deg)); _recTrace('rotateZ', [deg], { targetId: this.id, resultId: this.id }); return r; }
  rotate(axis, deg) { const r = this._applyMatrix(mat4Rotate(axis, deg)); _recTrace('rotate', [axis, deg], { targetId: this.id, resultId: this.id }); return r; }

  /* ---------- 布尔运算（CSG） ---------- */

  fuse(other) { const r = _csgCombine(this, other, 'union'); _recTrace('fuse', [], { targetId: this.id, argIds: [other && other.id], resultId: r.id }); return r; }
  cut(other) { const r = _csgCombine(this, other, 'subtract'); _recTrace('cut', [], { targetId: this.id, argIds: [other && other.id], resultId: r.id }); return r; }
  intersect(other) { const r = _csgCombine(this, other, 'intersect'); _recTrace('intersect', [], { targetId: this.id, argIds: [other && other.id], resultId: r.id }); return r; }

  /* ---------- 圆角 ----------
   * 支持：box / 任意拉伸体（对截面多边形的凸角倒圆）。
   * 其他类型返回警告并保持不变。
   */
  fillet(radius = 1, segments = 5) {
    const meta = this.meta;
    let out;
    if (!meta) {
      this._warning = `fillet: 该几何体经过布尔运算，内置内核不支持对其倒圆角（已忽略）`;
      out = this;
    } else if (meta.kind === 'box') {
      const { w, d, h } = meta.params;
      const r = Math.min(radius, w / 2 - 1e-6, d / 2 - 1e-6);
      const profile = roundedRectProfile(w, d, r, segments);
      out = extrudeProfile(profile, h);
      out._applyMatrix(meta.matrix || mat4Identity());
    } else if (meta.kind === 'extrude') {
      const r = radius;
      const profile = roundProfileCorners(meta.params.profile, r, segments);
      out = extrudeProfile(profile, meta.params.height);
      out._applyMatrix(meta.matrix || mat4Identity());
    } else {
      this._warning = `fillet: 内置内核暂不支持对 ${meta.kind} 倒圆角（已忽略）`;
      out = this;
    }
    _recTrace('fillet', [radius, segments], { targetId: this.id, resultId: out.id });
    return out;
  }

  /* ---------- 镜像 ----------
   * plane: 'XY' | 'XZ' | 'YZ'（过原点的坐标平面）。
   * 镜像行列式为负，需翻转三角形绕序保持法线朝外。
   * 注意：镜像后 meta 失效（应先倒圆角再镜像）。
   */
  mirror(plane = 'XY') {
    const p = String(plane).toUpperCase();
    const m =
      p === 'XY' ? mat4Scale(1, 1, -1) :
      p === 'XZ' ? mat4Scale(1, -1, 1) :
      p === 'YZ' ? mat4Scale(-1, 1, 1) : null;
    if (!m) {
      throw new GeomError(`mirror: 不支持的镜像平面 "${plane}"`, {
        code: 'INVALID_ARGUMENT', recoverable: true, suggestion: 'plane 只能是 XY / XZ / YZ',
      });
    }
    this._applyMatrix(m);
    const idx = this.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    this.meta = null;
    _recTrace('mirror', [plane], { targetId: this.id, resultId: this.id });
    return this;
  }

  /* ---------- 阵列 ----------
   * 网格级副本合并（副本应互不重叠；需要重叠合并请对结果再 fuse）。
   * 阵列不修改原形状，返回合并后的新 Shape。
   */
  _patternConcat(mats) {
    const pos = [], idx = [];
    for (const m of mats) {
      const off = pos.length / 3;
      const p = this.positions;
      if (!m) {
        for (let i = 0; i < p.length; i++) pos.push(p[i]);
      } else {
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          pos.push(
            m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11],
          );
        }
      }
      for (let i = 0; i < this.indices.length; i++) idx.push(this.indices[i] + off);
    }
    return new Shape(pos, idx, null);
  }

  /** 线性阵列：n 个等距副本（含原体），步进向量 (dx, dy, dz) */
  linearPattern(n = 2, dx = 0, dy = 0, dz = 0) {
    n = Math.max(1, Math.floor(n));
    const mats = [];
    for (let k = 0; k < n; k++) mats.push(k === 0 ? null : mat4Translate(k * dx, k * dy, k * dz));
    const out = this._patternConcat(mats);
    _recTrace('linearPattern', [n, dx, dy, dz], { targetId: this.id, resultId: out.id });
    return out;
  }

  /**
   * 圆周阵列：绕轴 n 个副本（含原体），轴过原点。
   * axis: 'Z'（默认）/ 'X' / 'Y' / [x,y,z]。
   * angle: 总角度——默认 360 均布（步进 360/n）；非 360 时步进 angle/(n-1)（首尾都在）。
   */
  circularPattern(n = 3, axis = 'Z', angle = 360) {
    n = Math.max(1, Math.floor(n));
    if (typeof axis === 'string') {
      const a = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[axis.toUpperCase()];
      if (!a) {
        throw new GeomError(`circularPattern: 不支持的轴 "${axis}"`, {
          code: 'INVALID_ARGUMENT', recoverable: true, suggestion: 'axis 只能是 X / Y / Z 或 [x,y,z] 向量',
        });
      }
      axis = a;
    }
    const step = n <= 1 ? 0 : (Math.abs(angle) >= 360 ? angle / n : angle / (n - 1));
    const mats = [];
    for (let k = 0; k < n; k++) mats.push(k === 0 ? null : mat4Rotate(axis, k * step));
    const out = this._patternConcat(mats);
    _recTrace('circularPattern', [n, axis, angle], { targetId: this.id, resultId: out.id });
    return out;
  }

  toJSON() {
    return {
      positions: Array.from(this.positions),
      indices: Array.from(this.indices),
    };
  }
}

/** 顶点焊接：消除 CSG 输出的重复顶点，减小网格体积 */
function weldShape(positions, precision = 1e4) {
  const map = new Map();
  const outPos = [];
  const outIdx = [];
  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${Math.round(positions[o] * precision)},${Math.round(positions[o + 1] * precision)},${Math.round(positions[o + 2] * precision)}`;
      let idx = map.get(key);
      if (idx === undefined) {
        idx = outPos.length / 3;
        map.set(key, idx);
        outPos.push(positions[o], positions[o + 1], positions[o + 2]);
      }
      outIdx.push(idx);
    }
  }
  return { positions: outPos, indices: outIdx };
}

/* ============================================================================
 * 四、二维轮廓工具
 * ========================================================================== */

function polygonSignedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function ensureCCW(pts) {
  return polygonSignedArea(pts) < 0 ? [...pts].reverse() : pts;
}

/** 耳切法三角化（支持简单凹多边形），返回索引三元组 */
function triangulateProfile(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  const tris = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p, a, b, c) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return d1 > -1e-9 && d2 > -1e-9 && d3 > -1e-9;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 100 * n) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue; // 凹角或退化
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(pts[j], a, b, c)) { ok = false; break; }
      }
      if (ok) {
        tris.push([ia, ib, ic]);
        idx.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // 兜底：扇形三角化
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

/** 矩形轮廓（中心在原点） */
function rectProfile(w, d) {
  return [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ];
}

/** 圆轮廓 */
function circleProfile(r, segments = 48) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/** 圆角矩形轮廓 */
function roundedRectProfile(w, d, r, cornerSeg = 5) {
  const pts = [];
  const hw = w / 2, hd = d / 2;
  const corners = [
    [hw - r, hd - r, 0],
    [-hw + r, hd - r, Math.PI / 2],
    [-hw + r, -hd + r, Math.PI],
    [hw - r, -hd + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= cornerSeg; i++) {
      const t = start + (i / cornerSeg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  return ensureCCW(pts);
}

/** 对任意凸/凹多边形的凸角倒圆 */
function roundProfileCorners(profile, r, seg = 5) {
  const pts = ensureCCW(profile);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = [cur[0] - prev[0], cur[1] - prev[1]];
    const e2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const u1 = [e1[0] / l1, e1[1] / l1];
    const u2 = [e2[0] / l2, e2[1] / l2];
    const crossZ = u1[0] * u2[1] - u1[1] * u2[0];
    if (crossZ <= 1e-9) { out.push(cur); continue; } // 凹角或共线，保持尖锐
    const dot = Math.min(1, Math.max(-1, u1[0] * u2[0] + u1[1] * u2[1]));
    const theta = Math.acos(dot); // 转角
    const half = theta / 2;
    const trim = Math.min(r / Math.tan(half), l1 * 0.49, l2 * 0.49);
    const rEff = trim * Math.tan(half);
    const a = [cur[0] - u1[0] * trim, cur[1] - u1[1] * trim];
    const b = [cur[0] + u2[0] * trim, cur[1] + u2[1] * trim];
    // 圆心：角平分线方向，距顶点 rEff/sin(half)
    const bis = vNormalize([u2[0] - u1[0], u2[1] - u1[1], 0]);
    const center = [cur[0] + bis[0] * (rEff / Math.sin(half)), cur[1] + bis[1] * (rEff / Math.sin(half))];
    const a0 = Math.atan2(a[1] - center[1], a[0] - center[0]);
    const a1 = Math.atan2(b[1] - center[1], b[0] - center[0]);
    let delta = a1 - a0;
    while (delta > 0) delta -= Math.PI * 2; // 顺时针弧
    while (delta < -Math.PI * 2) delta += Math.PI * 2;
    for (let k = 0; k <= seg; k++) {
      const t = a0 + (delta * k) / seg;
      out.push([center[0] + rEff * Math.cos(t), center[1] + rEff * Math.sin(t)]);
    }
  }
  return ensureCCW(out);
}

/* ============================================================================
 * 五、拉伸与旋转成型
 * ========================================================================== */

/** 沿 Z 轴拉伸二维轮廓（-h/2 ~ +h/2），生成封闭棱柱 */
function extrudeProfile(profile, height) {
  const pts = ensureCCW(profile);
  const n = pts.length;
  const h2 = height / 2;
  const positions = [];
  const indices = [];
  // 底环 0..n-1（z=-h2），顶环 n..2n-1（z=+h2）
  for (const [x, y] of pts) positions.push(x, y, -h2);
  for (const [x, y] of pts) positions.push(x, y, h2);
  // 侧面
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  // 顶盖（法线 +Z，CCW）
  const caps = triangulateProfile(pts);
  for (const [a, b, c] of caps) indices.push(n + a, n + b, n + c);
  // 底盖（法线 -Z，反向）
  for (const [a, b, c] of caps) indices.push(a, c, b);
  return new Shape(positions, indices, {
    kind: 'extrude',
    params: { profile: pts.map((p) => [...p]), height },
    matrix: mat4Identity(),
  });
}

/**
 * 绕 Z 轴旋转成型（lathe）。
 * profile: [[半径, z], ...]，closed=true 时首尾相连（可生成管道等中空体）。
 */
function revolveProfile(profile, segments = 64, closed = false) {
  let pts = profile.filter((p, i) => i === 0 || Math.hypot(p[0] - profile[i - 1][0], p[1] - profile[i - 1][1]) > 1e-9);
  const M = pts.length;
  const positions = [];
  const indices = [];
  for (const [r, z] of pts) {
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      positions.push(r * Math.cos(t), r * Math.sin(t), z);
    }
  }
  const rowPairs = closed ? M : M - 1;
  for (let j = 0; j < rowPairs; j++) {
    const j2 = (j + 1) % M;
    for (let i = 0; i < segments; i++) {
      const i2 = (i + 1) % segments;
      const a = j * segments + i;
      const b = j * segments + i2;
      const c = j2 * segments + i2;
      const d = j2 * segments + i;
      // 过滤极点处的退化三角形（极点行 r≈0，含浮点误差）
      if (Math.abs(pts[j][0]) > 1e-9) indices.push(a, b, c);
      if (Math.abs(pts[j2][0]) > 1e-9) indices.push(a, c, d);
    }
  }
  return new Shape(positions, indices, {
    kind: 'revolve',
    params: { profile: pts.map((p) => [...p]), segments, closed },
    matrix: mat4Identity(),
  });
}

/* ============================================================================
 * 六、图元（kernel API）
 * ========================================================================== */

/** 立方体，中心在原点 */
function box(w = 10, d = w, h = d) {
  const shape = extrudeProfile(rectProfile(w, d), h);
  shape.meta = { kind: 'box', params: { w, d, h }, matrix: mat4Identity() };
  return shape;
}

/** 圆柱，轴向为 Z，中心在原点 */
function cylinder(r = 5, h = 10, segments = 48) {
  const shape = revolveProfile([[r, -h / 2], [r, h / 2]], segments);
  // 补上下端盖
  const pos = Array.from(shape.positions);
  const idx = Array.from(shape.indices);
  const addCap = (z, flip) => {
    const cIdx = pos.length / 3;
    pos.push(0, 0, z);
    for (let i = 0; i < segments; i++) {
      const i2 = (i + 1) % segments;
      const row = z > 0 ? segments : 0; // 顶行或底行
      if (flip) idx.push(cIdx, row + i2, row + i);
      else idx.push(cIdx, row + i, row + i2);
    }
  };
  addCap(-h / 2, true);  // 底盖，法线 -Z
  addCap(h / 2, false);  // 顶盖，法线 +Z
  const out = new Shape(pos, idx, { kind: 'cylinder', params: { r, h, segments }, matrix: mat4Identity() });
  return out;
}

/** 圆台/圆锥，轴向为 Z（rBottom 在 -Z 端） */
function cone(rBottom = 5, rTop = 0, h = 10, segments = 48) {
  const parts = [];
  const shape = revolveProfile([[rBottom, -h / 2], [rTop, h / 2]], segments);
  const pos = Array.from(shape.positions);
  const idx = Array.from(shape.indices);
  if (rBottom > 1e-9) {
    const c = pos.length / 3;
    pos.push(0, 0, -h / 2);
    for (let i = 0; i < segments; i++) idx.push(c, (i + 1) % segments, i);
  }
  if (rTop > 1e-9) {
    const c = pos.length / 3;
    pos.push(0, 0, h / 2);
    for (let i = 0; i < segments; i++) idx.push(c, segments + i, segments + ((i + 1) % segments));
  }
  return new Shape(pos, idx, { kind: 'cone', params: { rBottom, rTop, h, segments }, matrix: mat4Identity() });
}

/** 球体，中心在原点 */
function sphere(r = 5, segments = 48, rings = 24) {
  const profile = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    profile.push([r * Math.sin(phi), -r * Math.cos(phi)]);
  }
  const shape = revolveProfile(profile, segments);
  shape.meta = { kind: 'sphere', params: { r, segments, rings }, matrix: mat4Identity() };
  return shape;
}

/** 圆环（主半径 R，截面半径 r），绕 Z 轴 */
function torus(R = 8, r = 2, segments = 48, tubeSeg = 24) {
  const profile = [];
  for (let i = 0; i <= tubeSeg; i++) {
    const t = (i / tubeSeg) * Math.PI * 2;
    profile.push([R + r * Math.cos(t), r * Math.sin(t)]);
  }
  const shape = revolveProfile(profile, segments, true);
  shape.meta = { kind: 'torus', params: { R, r, segments, tubeSeg }, matrix: mat4Identity() };
  return shape;
}

/** 圆管（空心圆柱），轴向为 Z */
function pipe(rOuter = 6, rInner = 4, h = 10, segments = 48) {
  const shape = revolveProfile(
    [[rOuter, -h / 2], [rOuter, h / 2], [rInner, h / 2], [rInner, -h / 2]],
    segments,
    true,
  );
  shape.meta = { kind: 'pipe', params: { rOuter, rInner, h, segments }, matrix: mat4Identity() };
  return shape;
}

/** 旋转成型（用户 API 别名） */
function revolve(profile, segments = 64) {
  return revolveProfile(profile, segments);
}
function lathe(profile, segments = 64) {
  return revolveProfile(profile, segments);
}

/** 齿轮轮廓（简化梯形齿）：module 模数, teeth 齿数 */
function gearProfile(teeth = 20, module = 2) {
  const rPitch = (module * teeth) / 2;
  const rTip = rPitch + module;
  const rRoot = Math.max(rPitch - 1.25 * module, module);
  const pts = [];
  const ta = (Math.PI * 2) / teeth;
  for (let t = 0; t < teeth; t++) {
    const a = t * ta;
    pts.push(
      [rRoot * Math.cos(a), rRoot * Math.sin(a)],
      [rRoot * Math.cos(a + 0.25 * ta), rRoot * Math.sin(a + 0.25 * ta)],
      [rTip * Math.cos(a + 0.4 * ta), rTip * Math.sin(a + 0.4 * ta)],
      [rTip * Math.cos(a + 0.6 * ta), rTip * Math.sin(a + 0.6 * ta)],
      [rRoot * Math.cos(a + 0.75 * ta), rRoot * Math.sin(a + 0.75 * ta)],
    );
  }
  return pts;
}

/* ---------- 孔刀具（配合 cut 使用，轴向 Z、中心原点） ----------
 * opts.cboreR/cboreH: 沉头孔大径/深度（在 +Z 端）
 * opts.csinkAngle/csinkDepth: 锥孔角度（如 90°）/深度（在 +Z 端，大径由角度与深度推导）
 * 都不是时为过孔圆柱。
 */
function hole(r = 3, h = 10, opts = {}) {
  _traceSuspend(); // 内部图元/布尔不单独记录（孔刀具整体作为一步由 api 包装层记录）
  try {
    const { cboreR = 0, cboreH = 0, csinkAngle = 0, csinkDepth = 0 } = opts || {};
    let tool = cylinder(r, h);
    if (cboreR > r && cboreH > 0) {
      tool = tool.fuse(cylinder(cboreR, cboreH).translate(0, 0, h / 2 - cboreH / 2));
    } else if (csinkAngle > 0 && csinkDepth > 0) {
      const rTop = r + csinkDepth / Math.tan((csinkAngle / 2) * DEG2RAD);
      tool = tool.fuse(cone(r, rTop, csinkDepth).translate(0, 0, h / 2 - csinkDepth / 2));
    }
    return tool;
  } finally {
    _traceResume();
  }
}

/* ---------- Sketch（二维草图 API） ---------- */

export class Sketch {
  constructor(points) {
    this.id = ++_shapeUid;
    this.points = ensureCCW(points);
  }
  /** 沿 Z 拉伸为实体（中心在 z=0） */
  extrude(height) {
    const out = extrudeProfile(this.points, height);
    _recTrace('extrude', [height], { targetId: this.id, resultId: out.id });
    return out;
  }
}

function sketchRect(w = 10, h = 10) { return new Sketch(rectProfile(w, h)); }
function sketchCircle(r = 5, segments = 48) { return new Sketch(circleProfile(r, segments)); }
function sketchRoundedRect(w = 10, h = 10, r = 2, seg = 5) { return new Sketch(roundedRectProfile(w, h, r, seg)); }
function sketchPolygon(points) { return new Sketch(points); }

/* ============================================================================
 * 六·五、有机形态 API（网格级：meshFromVerts / loft / sweep / subdivide / displace / smooth）
 *
 * 语义（§13 双内核一致）：builtin 直接操作三角网格；OCCT 内核经
 * BRepBuilderAPI 重建 B-Rep（occt-kernel.js 镜像）。本批为纯加法，不改既有能力。
 * 有机形态验证（阶段 1 验收）：树/花瓶曲面/有机装饰 = loft/sweep+displace/smooth 组合。
 * ========================================================================== */

/** 顶点焊接（按坐标去重，重建索引）——有机 API 入口统一焊接，保证输出水密语义 */
function _weldShape(shape, precision = 1e5) {
  const p = shape.positions, idx = shape.indices;
  const map = new Map();
  const outPos = [];
  const outIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const vi = idx[t + k] * 3;
      const key = `${Math.round(p[vi] * precision)},${Math.round(p[vi + 1] * precision)},${Math.round(p[vi + 2] * precision)}`;
      let w = map.get(key);
      if (w === undefined) { w = outPos.length / 3; map.set(key, w); outPos.push(p[vi], p[vi + 1], p[vi + 2]); }
      outIdx.push(w);
    }
  }
  return new Shape(Float32Array.from(outPos), Uint32Array.from(outIdx), shape.meta ? { ...shape.meta } : null);
}

/** 顶点法线（邻接三角形面积加权，供 displace/smooth） */
function _vertexNormals(shape) {
  const p = shape.positions, idx = shape.indices;
  const n = p.length / 3;
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    for (const v of [idx[i], idx[i + 1], idx[i + 2]]) { nx[v] += cx; ny[v] += cy; nz[v] += cz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nx[i], ny[i], nz[i]) || 1;
    out[i * 3] = nx[i] / l;
    out[i * 3 + 1] = ny[i] / l;
    out[i * 3 + 2] = nz[i] / l;
  }
  return out;
}

/** 可复现的多频正弦噪声（fBm-lite，非真实 Perlin，有机凹凸外观足够） */
function _noise3(x, y, z, seed) {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 + seed * 1.7) * Math.sin(z * 1.1 + seed * 2.3) +
    0.5 * Math.sin(x * 3.1 + seed * 3.1) * Math.cos(y * 2.7 + seed * 0.6) * Math.sin(z * 3.7 + seed * 1.1)
  ) / 1.5;
}

/** 闭合环弧长均匀重采样（loft 各截面点数对齐） */
function _loopResample(pts, n) {
  const m = pts.length;
  if (n <= 0 || m < 3) return pts.map((p) => [...p]);
  const seg = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    seg.push(d);
    total += d;
  }
  if (total < 1e-12) return pts.slice(0, n).map((p) => [...p]);
  const out = [];
  let acc = 0, j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (j < m - 1 && acc + seg[j] < target) { acc += seg[j]; j++; }
    const t = (target - acc) / Math.max(seg[j], 1e-12);
    const a = pts[j % m], b = pts[(j + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** 点集质心 */
function _centroid(ring) {
  const c = [0, 0, 0];
  for (const p of ring) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = Math.max(ring.length, 1);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** 闭合环 Newell 法线（cap 三角化的投影平面基准） */
function _loopNormal(ring) {
  let nx = 0, ny = 0, nz = 0;
  const m = ring.length;
  for (let i = 0; i < m; i++) {
    const p = ring[i], q = ring[(i + 1) % m];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return vNormalize([nx, ny, nz]);
}

/** 环投影到自身平面（2D），供 ear-clipping cap */
function _projectLoop2D(ring) {
  const n = _loopNormal(ring);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = vNormalize(vCross(n, ref));
  const vv = vCross(n, u);
  return ring.map((p) => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * vv[0] + p[1] * vv[1] + p[2] * vv[2]]);
}

/** 两闭合环桥接的最优旋转偏移（O(n²) 抽样能量最小，n>64 时取 0） */
function _loopOffset(a, b) {
  const n = a.length;
  if (n > 64) return 0;
  let best = 0, bestE = Infinity;
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = 0; i < n; i += 4) {
      const p = a[i], q = b[(i + k) % n];
      e += vLength(vSub(p, q));
    }
    if (e < bestE) { bestE = e; best = k; }
  }
  return best;
}

/**
 * 从顶点/面构造网格（verts: [[x,y,z],...] 或扁平 [x,y,z,...]；faces: [[a,b,c],...] 索引 0 起）。
 * faces 可省略（开放网格，用 smooth/displace 后仍可作装饰面）；索引越界的三角形被跳过。
 */
function meshFromVerts(verts, faces) {
  if (!verts || !verts.length) return new Shape([], []);
  const flat = Array.isArray(verts[0]) ? verts.flat() : Array.from(verts);
  const nv = Math.floor(flat.length / 3);
  const idx = [];
  for (const tri of faces || []) {
    if (tri.length < 3) continue;
    const a = tri[0], b = tri[1], c = tri[2];
    if (a < 0 || b < 0 || c < 0 || a >= nv || b >= nv || c >= nv) continue;
    idx.push(a, b, c);
  }
  return new Shape(Float32Array.from(flat), Uint32Array.from(idx), null);
}

/**
 * 截面放样：sections = [截面1, 截面2, …]，每截面为闭合轮廓点数组（3D）；
 * 自动重采样对齐到首截面点数。opts: { segments=96, closed=true（首尾封盖） }。
 * 截面顺序即放样方向；反转 geometry 可产生凹陷/鼓包（花瓶/树躯干）。
 */
function loft(sections, opts = {}) {
  const capped = opts.closed !== false;
  const nMax = opts.segments || 96;
  const secs = (sections || []).filter((s) => s && s.length >= 3);
  if (secs.length < 2) return new Shape([], []);
  const n = Math.max(3, Math.min(nMax, secs[0].length));
  const rings = secs.map((s) => _loopResample(s, n));
  // 环绕序校正：后续环 Newell 与首环不一致时反转（保证桥接/端盖法线连续）
  const n0 = _loopNormal(rings[0]);
  for (let si = 1; si < rings.length; si++) {
    if (vDot(n0, _loopNormal(rings[si])) < 0) rings[si].reverse();
  }
  const pos = [];
  const idx = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const ringAt = (si, i) => si * n + (i % n);
  let off = 0;
  for (let si = 0; si < rings.length - 1; si++) {
    const a = rings[si], b = rings[si + 1];
    if (si > 0) off = _loopOffset(rings[si - 1], a);
    const k = (off + _loopOffset(a, b)) % n;
    for (let i = 0; i < n; i++) {
      const a0 = ringAt(si, i + off), a1 = ringAt(si, i + off + 1);
      const b0 = ringAt(si + 1, i + k), b1 = ringAt(si + 1, i + k + 1);
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  if (capped) {
    // 端盖：法线 = ±放样方向（首盖朝放样起点外侧，尾盖朝终点外侧）
    const cap = (si, toward) => {
      const tris = triangulateProfile(_projectLoop2D(rings[si]));
      const base = si * n;
      const ref = si === 0
        ? vSub(rings.length > 1 ? _centroid(rings[1]) : _centroid(rings[0]), _centroid(rings[0]))
        : vSub(_centroid(rings[si]), _centroid(rings[si - 1]));
      const flip = vDot(ref, _loopNormal(rings[si])) * toward < 0;
      for (const [a, b, c] of tris) {
        if (flip) idx.push(base + a, base + c, base + b);
        else idx.push(base + a, base + b, base + c);
      }
    };
    cap(0, -1);
    cap(rings.length - 1, 1);
  }
  return new Shape(Float32Array.from(pos), Uint32Array.from(idx), {
    kind: 'loft',
    params: { sections: secs.length, segments: n },
    matrix: mat4Identity(),
  });
}

/**
 * 扫掠：profile（局部 2D 轮廓 [[u,v],…]）沿 path（3D 点序）扫掠，平行传输帧避免扭转。
 * opts: { closedPath=false（环路径，首尾相接）, cap=true }。
 * 用途：弯曲管/椅腿/栏杆/有机曲线零件；path 稀疏时先 subdivide 仍平滑（帧按段插值）。
 */
function sweep(profile, path, opts = {}) {
  const closedPath = !!opts.closedPath;
  const capped = opts.cap !== false;
  const prof = (profile || []).filter((p) => p && p.length >= 2);
  const pts = (path || []).filter((p) => p && p.length >= 3);
  if (prof.length < 3 || pts.length < 2) return new Shape([], []);
  const m = pts.length;
  const tan = [];
  for (let i = 0; i < m; i++) {
    const p0 = closedPath ? pts[(i - 1 + m) % m] : pts[Math.max(0, i - 1)];
    const p1 = closedPath ? pts[(i + 1) % m] : pts[Math.min(m - 1, i + 1)];
    tan.push(vNormalize(vSub(p1, p0)));
  }
  // 平行传输：初始法向选与首切向最接近垂直的参考，逐段正交化
  let N = vNormalize(vCross([0, 0, 1], tan[0]));
  if (vLength(N) < 1e-9) N = vNormalize(vCross([0, 1, 0], tan[0]));
  const frames = [];
  for (let i = 0; i < m; i++) {
    const t = tan[i];
    const d = vDot(N, t);
    N = vNormalize(vSub(N, vScale(t, d)));
    const B = vNormalize(vCross(t, N));
    frames.push({ N, B });
  }
  const n = prof.length;
  const pos = [];
  const idx = [];
  for (let i = 0; i < m; i++) {
    const { N: fN, B: fB } = frames[i];
    const P = pts[i];
    for (const [u, v] of prof) {
      pos.push(P[0] + u * fN[0] + v * fB[0], P[1] + u * fN[1] + v * fB[1], P[2] + u * fN[2] + v * fB[2]);
    }
  }
  const at = (i, j) => (i % m) * n + (j % n);
  const span = closedPath ? m : m - 1;
  for (let i = 0; i < span; i++) {
    for (let j = 0; j < n; j++) {
      const a0 = at(i, j), a1 = at(i, j + 1);
      const b0 = at(i + 1, j), b1 = at(i + 1, j + 1);
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  if (capped && !closedPath) {
    const cap0 = triangulateProfile(_projectLoop2D(prof.map(([u, v]) => [u, v, 0])));
    for (const [a, b, c] of cap0) idx.push(c, b, a); // 首盖反向
    for (const [a, b, c] of cap0) idx.push((m - 1) * n + a, (m - 1) * n + b, (m - 1) * n + c);
  }
  return new Shape(Float32Array.from(pos), Uint32Array.from(idx), {
    kind: 'sweep',
    params: { profile: prof.map((p) => [...p]), path: pts.map((p) => [...p]), closedPath },
    matrix: mat4Identity(),
  });
}

/**
 * 中点细分（1→4）：形状不变，仅提高网格密度（配合 displace/smooth 产出有机细节）。
 * levels 建议 1~2；每级面数 ×4。顶点按坐标焊接（共享边中点一致）。
 */
function subdivide(shape, levels = 1) {
  if (!shape || !shape.vertexCount) return shape;
  shape = _weldShape(shape);
  let pos = Array.from(shape.positions);
  let idx = Array.from(shape.indices);
  for (let L = 0; L < Math.min(levels || 1, 3); L++) {
    const vkey = new Map();
    const vid = (x, y, z) => {
      const k = Math.round(x * 1e5) + '_' + Math.round(y * 1e5) + '_' + Math.round(z * 1e5);
      let i = vkey.get(k);
      if (i === undefined) { i = pos.length / 3; vkey.set(k, i); pos.push(x, y, z); }
      return i;
    };
    const nidx = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ab = vid((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      const bc = vid((pos[b * 3] + pos[c * 3]) / 2, (pos[b * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[b * 3 + 2] + pos[c * 3 + 2]) / 2);
      const ca = vid((pos[c * 3] + pos[a * 3]) / 2, (pos[c * 3 + 1] + pos[a * 3 + 1]) / 2, (pos[c * 3 + 2] + pos[a * 3 + 2]) / 2);
      nidx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    idx = nidx;
  }
  return new Shape(Float32Array.from(pos), Uint32Array.from(idx), shape.meta ? { ...shape.meta } : null);
}

/**
 * 顶点沿法线位移（可复现噪声）。opts: { amp=1（mm）, freq=0.5（空间频率）, seed=1 }。
 * 典型用法：subdivide 后 displace 出有机凹凸（树皮/鳞片/曲面装饰）。
 */
function displace(shape, amp = 1, opts = {}) {
  if (!shape || !shape.vertexCount) return shape;
  shape = _weldShape(shape);
  const freq = opts.freq || 0.5;
  const seed = opts.seed ?? 1;
  const p = shape.positions;
  const nr = _vertexNormals(shape);
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const d = _noise3(x * freq, y * freq, z * freq, seed) * amp;
    out[i] = x + nr[i] * d;
    out[i + 1] = y + nr[i + 1] * d;
    out[i + 2] = z + nr[i + 2] * d;
  }
  return new Shape(out, new Uint32Array(shape.indices), shape.meta ? { ...shape.meta } : null);
}

/**
 * 拉普拉斯平滑（顶点=邻接平均）。iterations 1~3；步长 0.25 防过度收缩。
 * 用途：消除 displace/细分后的尖角、柔化有机网格。
 */
function smooth(shape, iterations = 1) {
  if (!shape || !shape.vertexCount) return shape;
  shape = _weldShape(shape);
  let pos = Float32Array.from(shape.positions);
  const idx = shape.indices;
  const nv = pos.length / 3;
  const STEP = 0.25;
  for (let it = 0; it < Math.min(iterations || 1, 5); it++) {
    const adj = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (!adj.has(u)) adj.set(u, []);
        adj.get(u).push(v);
        if (!adj.has(v)) adj.set(v, []);
        adj.get(v).push(u);
      }
    }
    const np = new Float32Array(pos.length);
    for (let i = 0; i < nv; i++) {
      const nb = adj.get(i) || [];
      if (!nb.length) {
        np[i * 3] = pos[i * 3]; np[i * 3 + 1] = pos[i * 3 + 1]; np[i * 3 + 2] = pos[i * 3 + 2];
        continue;
      }
      let x = 0, y = 0, z = 0;
      for (const j of nb) { x += pos[j * 3]; y += pos[j * 3 + 1]; z += pos[j * 3 + 2]; }
      const inv = STEP / nb.length;
      np[i * 3] = pos[i * 3] + (x - pos[i * 3] * nb.length) * inv;
      np[i * 3 + 1] = pos[i * 3 + 1] + (y - pos[i * 3 + 1] * nb.length) * inv;
      np[i * 3 + 2] = pos[i * 3 + 2] + (z - pos[i * 3 + 2] * nb.length) * inv;
    }
    pos = np;
  }
  return new Shape(pos, new Uint32Array(shape.indices), shape.meta ? { ...shape.meta } : null);
}

/* ============================================================================
 * 七、CSG 布尔运算（BSP 树实现，支持 并 fuse / 差 cut / 交 intersect）
 * ========================================================================== */

const CSG_EPSILON = 1e-5;

class CSGVertex {
  constructor(pos) { this.pos = pos; }
  clone() { return new CSGVertex([...this.pos]); }
  interpolate(other, t) { return new CSGVertex(vLerp(this.pos, other.pos, t)); }
}

class CSGPolygon {
  constructor(vertices) {
    this.vertices = vertices;
    this.plane = CSGPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  clone() { return new CSGPolygon(this.vertices.map((v) => v.clone())); }
  flip() {
    this.vertices.reverse();
    this.plane.flip();
  }
}

class CSGPlane {
  constructor(normal, w) { this.normal = normal; this.w = w; }
  clone() { return new CSGPlane([...this.normal], this.w); }
  flip() { this.normal = vScale(this.normal, -1); this.w = -this.w; }
  static fromPoints(a, b, c) {
    const n = vNormalize(vCross(vSub(b, a), vSub(c, a)));
    return new CSGPlane(n, vDot(n, a));
  }
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let polygonType = 0;
    const types = [];
    for (const v of polygon.vertices) {
      const t = vDot(this.normal, v.pos) - this.w;
      const type = t < -CSG_EPSILON ? BACK : t > CSG_EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }
    switch (polygonType) {
      case COPLANAR:
        (vDot(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING: {
        const f = [], b = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i], tj = types[j];
          const vi = polygon.vertices[i], vj = polygon.vertices[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - vDot(this.normal, vi.pos)) / vDot(this.normal, vSub(vj.pos, vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new CSGPolygon(f));
        if (b.length >= 3) back.push(new CSGPolygon(b));
        break;
      }
    }
  }
}

class CSGNode {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }
  clone() {
    const node = new CSGNode();
    node.plane = this.plane ? this.plane.clone() : null;
    node.front = this.front ? this.front.clone() : null;
    node.back = this.back ? this.back.clone() : null;
    node.polygons = this.polygons.map((p) => p.clone());
    return node;
  }
  invert() {
    for (const p of this.polygons) p.flip();
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }
  clipPolygons(polygons) {
    kernelCheckpoint();
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    for (const p of polygons) this.plane.splitPolygon(p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }
  allPolygons() {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }
  build(polygons) {
    kernelCheckpoint();
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (const p of polygons) {
      this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      if (!this.front) this.front = new CSGNode();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new CSGNode();
      this.back.build(back);
    }
  }
}

function shapeToCSGNode(shape) {
  const p = shape.positions, idx = shape.indices;
  const polygons = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = [p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]];
    const b = [p[idx[i + 1] * 3], p[idx[i + 1] * 3 + 1], p[idx[i + 1] * 3 + 2]];
    const c = [p[idx[i + 2] * 3], p[idx[i + 2] * 3 + 1], p[idx[i + 2] * 3 + 2]];
    if (vLength(vCross(vSub(b, a), vSub(c, a))) < 1e-12) continue; // 跳过退化三角形
    polygons.push(new CSGPolygon([new CSGVertex(a), new CSGVertex(b), new CSGVertex(c)]));
  }
  return new CSGNode(polygons);
}

function csgNodeToShape(node) {
  const positions = [];
  for (const poly of node.allPolygons()) {
    const vs = poly.vertices;
    for (let i = 1; i < vs.length - 1; i++) {
      positions.push(...vs[0].pos, ...vs[i].pos, ...vs[i + 1].pos);
    }
  }
  const welded = weldShape(positions);
  return new Shape(welded.positions, welded.indices, null);
}

function _csgCombine(shapeA, shapeB, op) {
  if (!(shapeB instanceof Shape)) {
    throw new GeomError(`布尔运算 ${op} 需要另一个 Shape 作为参数`, {
      code: 'INVALID_OPERAND', recoverable: true, suggestion: '请检查参数是否为几何体',
    });
  }
  const a = shapeToCSGNode(shapeA);
  const b = shapeToCSGNode(shapeB);
  switch (op) {
    case 'union':
      a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons());
      break;
    case 'subtract':
      a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons());
      a.invert();
      break;
    case 'intersect':
      a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
      a.build(b.allPolygons());
      a.invert();
      break;
    default:
      throw new GeomError(`未知布尔运算: ${op}`, { code: 'INVALID_OP' });
  }
  const result = csgNodeToShape(a);
  if (result.triangleCount === 0) {
    throw new GeomError(`布尔运算 ${op} 产生了空几何体`, {
      code: 'EMPTY_RESULT', recoverable: true, suggestion: '请检查两个几何体是否相交',
    });
  }
  return result;
}

/* ============================================================================
 * 八、网格导出器（STL / OBJ / JSON；GLB 由 Three.js GLTFExporter 完成）
 * ========================================================================== */

function mergeShapes(shapes) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const s of shapes) {
    positions.push(...s.positions);
    for (const i of s.indices) indices.push(i + offset);
    offset += s.vertexCount;
  }
  return { positions, indices };
}

function toSTLBinary(shapes) {
  const { positions: p, indices: idx } = mergeShapes(shapes);
  const triCount = idx.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  let offset = 80;
  view.setUint32(offset, triCount, true);
  offset += 4;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = vNormalize(vCross(ab, ac));
    for (const val of n) { view.setFloat32(offset, val, true); offset += 4; }
    for (const vi of [a, b, c]) {
      view.setFloat32(offset, p[vi], true); offset += 4;
      view.setFloat32(offset, p[vi + 1], true); offset += 4;
      view.setFloat32(offset, p[vi + 2], true); offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'model/stl' });
}

function toSTLAscii(shapes) {
  const { positions: p, indices: idx } = mergeShapes(shapes);
  const lines = ['solid 3dmaker'];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = vNormalize(vCross(ab, ac));
    lines.push(`  facet normal ${n.map((v) => v.toExponential(6)).join(' ')}`);
    lines.push('    outer loop');
    for (const vi of [a, b, c]) {
      lines.push(`      vertex ${p[vi].toExponential(6)} ${p[vi + 1].toExponential(6)} ${p[vi + 2].toExponential(6)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid 3dmaker');
  return new Blob([lines.join('\n')], { type: 'model/stl' });
}

function toOBJ(shapes) {
  const lines = ['# 3D Maker OBJ export'];
  let offset = 1;
  shapes.forEach((s, si) => {
    lines.push(`o part_${si}`);
    const p = s.positions;
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`);
    const idx = s.indices;
    for (let i = 0; i < idx.length; i += 3) {
      lines.push(`f ${idx[i] + offset} ${idx[i + 1] + offset} ${idx[i + 2] + offset}`);
    }
    offset += s.vertexCount;
  });
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

function toModelJSON(shapes) {
  return new Blob(
    [JSON.stringify({ format: '3dmaker-model/1', generator: '3D Maker kernel', parts: shapes.map((s) => s.toJSON()) })],
    { type: 'application/json' },
  );
}

/* ---------- 3MF 导出（OPC/ZIP 容器，STORE 无压缩 + 部件颜色/透明度） ---------- */

let _crcTable = null;
function _crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 生成 ZIP 包（STORE 无压缩）。files: [{name, data: Uint8Array}] */
function _zipStore(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = ((((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate())) & 0xffff;
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = _crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); // local file header
    h.setUint16(4, 20, true);
    h.setUint16(6, 0, true);
    h.setUint16(8, 0, true); // method: store
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true);
    h.setUint32(22, f.data.length, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, f.data);
    central.push({ name, crc, size: f.data.length, offset });
    offset += 30 + name.length + f.data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); // central directory header
    h.setUint16(4, 20, true);         // version made by
    h.setUint16(6, 20, true);         // version needed
    h.setUint16(8, 0, true);          // flags
    h.setUint16(10, 0, true);         // method: store
    h.setUint16(12, dosTime, true);
    h.setUint16(14, dosDate, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, c.size, true);    // compressed size
    h.setUint32(24, c.size, true);    // uncompressed size
    h.setUint16(28, c.name.length, true);
    h.setUint16(30, 0, true);         // extra len
    h.setUint16(32, 0, true);         // comment len
    h.setUint16(34, 0, true);         // disk number start
    h.setUint16(36, 0, true);         // internal attrs
    h.setUint32(38, 0, true);         // external attrs
    h.setUint32(42, c.offset, true);  // local header offset
    chunks.push(new Uint8Array(h.buffer), c.name);
    offset += 46 + c.name.length;
  }
  const cdSize = offset - cdStart;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); // end of central directory
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, cdStart, true);
  e.setUint16(20, 0, true);
  chunks.push(new Uint8Array(e.buffer));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const _xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 颜色 → 3MF displaycolor（#RRGGBB 或 #RRGGBBAA，支持透明度） */
function _toDisplayColor(color) {
  if (!color) return null;
  const s = String(color).trim();
  let rgb = null, a = null;
  const hex = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    rgb = hex[1].toLowerCase();
    a = hex[2] ? hex[2].toLowerCase() : null;
  } else {
    const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (rgba) {
      const h = (v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0');
      rgb = h(rgba[1]) + h(rgba[2]) + h(rgba[3]);
      a = rgba[4] !== undefined && +rgba[4] < 1 ? Math.round(+rgba[4] * 255).toString(16).padStart(2, '0') : null;
    }
  }
  if (!rgb) return null;
  return '#' + rgb + (a || '');
}

/**
 * 导出 3MF（3D 打印格式）。
 * @param {Array<{shape: Shape, name?: string, color?: string}>} items 带名称/颜色的部件列表
 * @returns {Blob} 3MF 文件（ZIP 容器，单位毫米，保留部件颜色/透明度）
 */
function to3MF(items) {
  const enc = new TextEncoder();
  // 颜色去重 → basematerials（含透明色 #RRGGBBAA）
  const colorMap = new Map(); // color → materialId
  let matSeq = 0;
  const materials = [];
  const objects = [];
  const buildItems = [];
  items.forEach(({ shape, name, color }, i) => {
    const objId = i + 1;
    const p = shape.positions, idx = shape.indices;
    const verts = [];
    for (let k = 0; k < p.length; k += 3) {
      verts.push(`<vertex x="${+p[k].toFixed(4)}" y="${+p[k + 1].toFixed(4)}" z="${+p[k + 2].toFixed(4)}"/>`);
    }
    const tris = [];
    for (let k = 0; k < idx.length; k += 3) {
      tris.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    }
    let pidAttr = '';
    const dc = _toDisplayColor(color);
    if (dc) {
      let mid = colorMap.get(dc);
      if (mid === undefined) {
        mid = ++matSeq;
        colorMap.set(dc, mid);
        materials.push(`<basematerials id="${mid}"><base name="${_xmlEsc(name || 'part')}" displaycolor="${dc}"/></basematerials>`);
      }
      pidAttr = ` pid="${mid}" pindex="0"`;
    }
    objects.push(
      `<object id="${objId}" type="model"${name ? ` name="${_xmlEsc(name)}"` : ''}><mesh${pidAttr}>` +
      `<vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    buildItems.push(`<item objectid="${objId}"/>`);
  });

  const modelXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<resources>${materials.join('')}${objects.join('')}</resources>` +
    `<build>${buildItems.join('')}</build></model>`;
  const ctXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>';
  const relsXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>';

  const zip = _zipStore([
    { name: '[Content_Types].xml', data: enc.encode(ctXml) },
    { name: '_rels/.rels', data: enc.encode(relsXml) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml) },
  ]);
  return new Blob([zip], { type: 'model/3mf' });
}

/* ============================================================================
 * 八·二、部件干涉检测（AABB 严格重叠粗筛 + 空间哈希三角形相交）
 *
 * 语义：仅报告“实体内穿”式干涉；表面贴合/边界接触不算冲突（AABB 用严格重叠）。
 * 性能：预算制（三角形对测试数上限），超预算标记 approximate，不阻断结果。
 * ========================================================================== */

const _v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const _v2sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const _cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

/** AABB 严格重叠（边界接触不算） */
function _aabbStrictHit(a, b) {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
         a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
         a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

/** 线段 ab 与三角形 v0v1v2 相交（Möller–Trumbore，不含共面） */
function _segTriHit(a, b, v0, v1, v2) {
  const dir = _v3sub(b, a);
  const e1 = _v3sub(v1, v0);
  const e2 = _v3sub(v2, v0);
  const pv = _v3cross(dir, e2);
  const det = _v3dot(e1, pv);
  if (Math.abs(det) < 1e-12) return false; // 共面/平行
  const inv = 1 / det;
  const tv = _v3sub(a, v0);
  const u = _v3dot(tv, pv) * inv;
  if (u < 0 || u > 1) return false;
  const qv = _v3cross(tv, e1);
  const v = _v3dot(dir, qv) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = _v3dot(e2, qv) * inv;
  return t > 0 && t < 1; // 排除端点（边界接触）
}

function _ptInTri2(p, t) {
  const d1 = _cross2(_v2sub(p, t[0]), _v2sub(t[1], t[0]));
  const d2 = _cross2(_v2sub(p, t[1]), _v2sub(t[2], t[1]));
  const d3 = _cross2(_v2sub(p, t[2]), _v2sub(t[0], t[2]));
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function _segSeg2Hit(a, b, c, d) {
  const o1 = _cross2(_v2sub(b, a), _v2sub(c, a));
  const o2 = _cross2(_v2sub(b, a), _v2sub(d, a));
  if ((o1 > 0 && o2 > 0) || (o1 < 0 && o2 < 0)) return false;
  const o3 = _cross2(_v2sub(d, c), _v2sub(a, c));
  const o4 = _cross2(_v2sub(d, c), _v2sub(b, c));
  return ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** 两个三角形相交（边穿透 + 共面 2D 投影） */
function _triTriHit(t1, t2) {
  for (let i = 0; i < 3; i++) {
    if (_segTriHit(t1[i], t1[(i + 1) % 3], t2[0], t2[1], t2[2])) return true;
    if (_segTriHit(t2[i], t2[(i + 1) % 3], t1[0], t1[1], t1[2])) return true;
  }
  // 共面/接触：投影到 2D 判定（AABB 已严格重叠，此时重叠即干涉）
  const n1 = _v3cross(_v3sub(t1[1], t1[0]), _v3sub(t1[2], t1[0]));
  const n2 = _v3cross(_v3sub(t2[1], t2[0]), _v3sub(t2[2], t2[0]));
  const n = _v3add(n1, n2);
  const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : (Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2);
  const proj = (p) => (ax === 0 ? [p[1], p[2]] : ax === 1 ? [p[0], p[2]] : [p[0], p[1]]);
  const a = t1.map(proj), b = t2.map(proj);
  for (const p of a) if (_ptInTri2(p, b)) return true;
  for (const p of b) if (_ptInTri2(p, a)) return true;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (_segSeg2Hit(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3])) return true;
  }
  return false;
}

const INTERFERE_MAX_TRI_PAIRS = 400000; // 单次检测三角形对总预算
const INTERFERE_MAX_PAIRS = 64;         // 最多报告冲突对数
const INTERFERE_MAX_SAMPLES = 400;      // 包含检测最大采样点数

const _hashKeyOf = (x, y, z, cell) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);

/** 构建空间哈希：pos/idx 三角形按包围盒装入 cell */
function _buildTriHash(pos, idx, cell) {
  const hash = new Map();
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [
      [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]],
      [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]],
      [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]],
    ];
    const bi = tris.length;
    tris.push(v);
    let minX = Math.min(v[0][0], v[1][0], v[2][0]), maxX = Math.max(v[0][0], v[1][0], v[2][0]);
    let minY = Math.min(v[0][1], v[1][1], v[2][1]), maxY = Math.max(v[0][1], v[1][1], v[2][1]);
    let minZ = Math.min(v[0][2], v[1][2], v[2][2]), maxZ = Math.max(v[0][2], v[1][2], v[2][2]);
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
        for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
          const k = _hashKeyOf(cx * cell, cy * cell, cz * cell, cell);
          let arr = hash.get(k);
          if (!arr) { arr = []; hash.set(k, arr); }
          arr.push(bi);
        }
      }
    }
  }
  return { hash, tris };
}

/** 三角形相交检测：A 的每个三角形只测覆盖 cell 内的候选。onTest 超预算时返回 'approx' */
function _triMeshHit(pa, ia, hb, cell, onTest) {
  const { hash, tris } = hb;
  let found = false;
  for (let t = 0; t < ia.length && !found; t += 3) {
    const tri = [
      [pa[ia[t] * 3], pa[ia[t] * 3 + 1], pa[ia[t] * 3 + 2]],
      [pa[ia[t + 1] * 3], pa[ia[t + 1] * 3 + 1], pa[ia[t + 1] * 3 + 2]],
      [pa[ia[t + 2] * 3], pa[ia[t + 2] * 3 + 1], pa[ia[t + 2] * 3 + 2]],
    ];
    let minX = Math.min(tri[0][0], tri[1][0], tri[2][0]), maxX = Math.max(tri[0][0], tri[1][0], tri[2][0]);
    let minY = Math.min(tri[0][1], tri[1][1], tri[2][1]), maxY = Math.max(tri[0][1], tri[1][1], tri[2][1]);
    let minZ = Math.min(tri[0][2], tri[1][2], tri[2][2]), maxZ = Math.max(tri[0][2], tri[1][2], tri[2][2]);
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell) && !found; cx++) {
      for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell) && !found; cy++) {
        for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell) && !found; cz++) {
          const cands = hash.get(_hashKeyOf(cx * cell, cy * cell, cz * cell, cell));
          if (!cands) continue;
          for (const bi of cands) {
            if (onTest()) return 'approx';
            if (_triTriHit(tri, tris[bi])) { found = true; break; }
          }
        }
      }
    }
  }
  return found;
}

/** 包含检测：inner 网格的三角形重心沿法线双向偏移后，在 outer 网格内部（沿 +X 射线奇偶计数）
 *  重心本身在表面（box 等平直部件），须沿法线偏移才进入实体内部，避免表面点奇偶不稳定 */
function _containmentHit(innerPos, innerIdx, outerBox, hb, cell, onTest) {
  const { hash, tris } = hb;
  let inside = 0, tested = 0;
  const step = Math.max(1, Math.floor(innerIdx.length / 3 / INTERFERE_MAX_SAMPLES));
  const off = cell * 0.06; // 法线偏移量（进入实体内部）
  for (let t = 0; t < innerIdx.length && tested < INTERFERE_MAX_SAMPLES; t += step * 3) {
    const a = [innerPos[innerIdx[t] * 3], innerPos[innerIdx[t] * 3 + 1], innerPos[innerIdx[t] * 3 + 2]];
    const b = [innerPos[innerIdx[t + 1] * 3], innerPos[innerIdx[t + 1] * 3 + 1], innerPos[innerIdx[t + 1] * 3 + 2]];
    const c = [innerPos[innerIdx[t + 2] * 3], innerPos[innerIdx[t + 2] * 3 + 1], innerPos[innerIdx[t + 2] * 3 + 2]];
    const n = _v3cross(_v3sub(b, a), _v3sub(c, a));
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const ux = (n[0] / nl) * off, uy = (n[1] / nl) * off, uz = (n[2] / nl) * off;
    const gx = (a[0] + b[0] + c[0]) / 3, gy = (a[1] + b[1] + c[1]) / 3, gz = (a[2] + b[2] + c[2]) / 3;
    const pts = [[gx + ux, gy + uy, gz + uz], [gx - ux, gy - uy, gz - uz]];
    for (const q of pts) {
      if (q[0] <= outerBox.min[0] || q[0] >= outerBox.max[0] ||
          q[1] <= outerBox.min[1] || q[1] >= outerBox.max[1] ||
          q[2] <= outerBox.min[2] || q[2] >= outerBox.max[2]) continue;
      tested++;
      const rayEnd = [outerBox.max[0] + 1, q[1], q[2]];
      const seen = new Set();
      let cnt = 0;
      const cyKey = Math.floor(q[1] / cell) * cell;
      const czKey = Math.floor(q[2] / cell) * cell;
      for (let cx = Math.floor(q[0] / cell); cx <= Math.floor(rayEnd[0] / cell); cx++) {
        const cands = hash.get(_hashKeyOf(cx * cell, cyKey, czKey, cell));
        if (!cands) continue;
        for (const bi of cands) {
          if (seen.has(bi)) continue;
          seen.add(bi);
          if (onTest()) return 'approx';
          if (_segTriHit(q, rayEnd, tris[bi][0], tris[bi][1], tris[bi][2])) cnt++;
        }
      }
      if (cnt % 2 === 1) { inside++; break; }
    }
    if (inside >= 3) return true;
  }
  return false;
}

/**
 * 检测多部件模型的位置干涉（内穿/重叠/完全包含）。
 * @param {Array<{name?: string, shape: Shape}>} parts 部件列表
 * @returns {{count: number, pairs: Array<{a:number,b:number,aName:string,bName:string}>, approximate: boolean}}
 */
function detectInterference(parts) {
  const empty = { count: 0, pairs: [], approximate: false };
  if (!parts || parts.length < 2) return empty;
  const boxes = parts.map((p) => p.shape.bounds());
  const pairs = [];
  let triTests = 0;
  let approximate = false;
  const onTest = () => (++triTests > INTERFERE_MAX_TRI_PAIRS);

  for (let i = 0; i < parts.length && pairs.length < INTERFERE_MAX_PAIRS; i++) {
    for (let j = i + 1; j < parts.length && pairs.length < INTERFERE_MAX_PAIRS; j++) {
      if (!_aabbStrictHit(boxes[i], boxes[j])) continue;
      const pa = parts[i].shape.positions, ia = parts[i].shape.indices;
      const pb = parts[j].shape.positions, ib = parts[j].shape.indices;
      const diag = Math.hypot(
        boxes[j].max[0] - boxes[j].min[0], boxes[j].max[1] - boxes[j].min[1], boxes[j].max[2] - boxes[j].min[2],
      ) || 1;
      const cell = Math.max(diag / 24, 0.05);
      const hb = _buildTriHash(pb, ib, cell);
      let res = _triMeshHit(pa, ia, hb, cell, onTest);
      if (res === 'approx') { approximate = true; continue; }
      let hit = res;
      if (!hit) {
        // 完全包含：小体积部件的重心采样点（沿法线偏移）在大部件内部（射线奇偶）
        const volA = parts[i].shape.volume(), volB = parts[j].shape.volume();
        if (volA <= volB) res = _containmentHit(pa, ia, boxes[j], hb, cell, onTest);
        else res = _containmentHit(pb, ib, boxes[i], hb, cell, onTest);
        if (res === 'approx') { approximate = true; continue; }
        hit = res;
      }
      if (hit) {
        pairs.push({
          a: i, b: j,
          aName: parts[i].name || ('部件 ' + (i + 1)),
          bName: parts[j].name || ('部件 ' + (j + 1)),
        });
      }
    }
  }
  return { count: pairs.length, pairs, approximate };
}

/* ============================================================================
 * 八·三、网格拓扑分析（打印就绪检测 + 完整面/完整边提取）
 *
 * 顶点按位置焊接后重建拓扑：边分类（边界/锐边/平滑/非流形）、
 * 平滑边 flood fill 合并出完整面区域（平面/曲面）、锐边+边界边串成完整边链。
 * 结果缓存在 shape._topo（按 sharpDeg 阈值区分）。
 * ========================================================================== */

function meshTopology(shape, sharpDeg = 30) {
  if (shape._topo && shape._topo.sharpDeg === sharpDeg) return shape._topo;
  const pos = shape.positions, idx = shape.indices;
  const triCount = idx.length / 3;

  // ---- 顶点焊接（拓扑用，不改原网格） ----
  const weldMap = new Map();
  const vmap = new Uint32Array(pos.length / 3);
  const wpos = [];
  for (let i = 0, vi = 0; i < pos.length; i += 3, vi++) {
    const key = `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
    let w = weldMap.get(key);
    if (w === undefined) { w = wpos.length / 3; weldMap.set(key, w); wpos.push(pos[i], pos[i + 1], pos[i + 2]); }
    vmap[vi] = w;
  }
  const vAt = (w, out) => { out = out || [0, 0, 0]; out[0] = wpos[w * 3]; out[1] = wpos[w * 3 + 1]; out[2] = wpos[w * 3 + 2]; return out; };

  // ---- 三角形（焊接后索引）+ 单位法线 + 面积 ----
  const tris = new Uint32Array(triCount * 3);
  const normals = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);
  const degenerate = new Uint8Array(triCount); // 零面积三角形（不参与拓扑/区域/边表）
  let degenerateCount = 0;
  for (let t = 0; t < triCount; t++) {
    const w0 = vmap[idx[t * 3]], w1 = vmap[idx[t * 3 + 1]], w2 = vmap[idx[t * 3 + 2]];
    tris[t * 3] = w0; tris[t * 3 + 1] = w1; tris[t * 3 + 2] = w2;
    const a = vAt(w0), b = vAt(w1), c = vAt(w2);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = _v3cross(ab, ac);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12 || w0 === w1 || w1 === w2 || w0 === w2) {
      degenerate[t] = 1;
      degenerateCount++;
      continue;
    }
    normals[t * 3] = n[0] / l; normals[t * 3 + 1] = n[1] / l; normals[t * 3 + 2] = n[2] / l;
    areas[t] = l / 2;
  }

  // ---- 边表 ----
  const edgeMap = new Map(); // 'min_max'(焊接索引) → {v1,v2,tris,boundary,nonManifold,sharp}
  const edgeOf = (a, b) => {
    const key = a < b ? a + '_' + b : b + '_' + a;
    let e = edgeMap.get(key);
    if (!e) { e = { v1: Math.min(a, b), v2: Math.max(a, b), tris: [], boundary: false, nonManifold: false, sharp: false }; edgeMap.set(key, e); }
    return e;
  };
  for (let t = 0; t < triCount; t++) {
    if (degenerate[t]) continue;
    for (let k = 0; k < 3; k++) edgeOf(tris[t * 3 + k], tris[t * 3 + ((k + 1) % 3)]).tris.push(t);
  }
  const cosSharp = Math.cos(sharpDeg * DEG2RAD);
  let boundaryCount = 0, nonManifoldCount = 0, sharpCount = 0;
  for (const e of edgeMap.values()) {
    e.boundary = e.tris.length === 1;
    e.nonManifold = e.tris.length > 2;
    if (!e.boundary && !e.nonManifold) {
      const t1 = e.tris[0] * 3, t2 = e.tris[1] * 3;
      e.sharp = (normals[t1] * normals[t2] + normals[t1 + 1] * normals[t2 + 1] + normals[t1 + 2] * normals[t2 + 2]) < cosSharp;
    }
    if (e.boundary) boundaryCount++;
    if (e.nonManifold) nonManifoldCount++;
    if (e.sharp) sharpCount++;
  }

  // ---- 完整面区域：跨平滑边（非锐/非边界/非流形）flood fill ----
  const triRegion = new Int32Array(triCount).fill(-1);
  for (let t = 0; t < triCount; t++) if (degenerate[t]) triRegion[t] = -2; // 退化三角形不属于任何区域
  const regions = [];
  const stack = [];
  for (let t0 = 0; t0 < triCount; t0++) {
    if (triRegion[t0] >= 0) continue;
    const rid = regions.length;
    const region = { tris: [], area: 0, nx: 0, ny: 0, nz: 0, planar: true };
    regions.push(region);
    triRegion[t0] = rid;
    stack.push(t0);
    while (stack.length) {
      const t = stack.pop();
      region.tris.push(t);
      region.area += areas[t];
      region.nx += normals[t * 3] * areas[t];
      region.ny += normals[t * 3 + 1] * areas[t];
      region.nz += normals[t * 3 + 2] * areas[t];
      for (let k = 0; k < 3; k++) {
        const e = edgeOf(tris[t * 3 + k], tris[t * 3 + ((k + 1) % 3)]);
        if (e.sharp || e.boundary || e.nonManifold) continue;
        for (const nt of e.tris) {
          if (nt !== t && triRegion[nt] < 0) { triRegion[nt] = rid; stack.push(nt); }
        }
      }
    }
  }
  // 平面判定：区域内所有法线与加权平均法线夹角 < 1°
  for (const region of regions) {
    const l = Math.hypot(region.nx, region.ny, region.nz) || 1;
    region.nx /= l; region.ny /= l; region.nz /= l;
    for (const t of region.tris) {
      const d = normals[t * 3] * region.nx + normals[t * 3 + 1] * region.ny + normals[t * 3 + 2] * region.nz;
      if (d < 0.99985) { region.planar = false; break; }
    }
  }

  // ---- 完整边链：锐边+边界边按顶点连通串链（交点/端点断开） ----
  const buildChains = (filter) => {
    const edges = [];
    const vEdges = new Map();
    for (const e of edgeMap.values()) {
      if (!filter(e)) continue;
      const i = edges.length;
      edges.push(e);
      for (const v of [e.v1, e.v2]) {
        let arr = vEdges.get(v);
        if (!arr) { arr = []; vEdges.set(v, arr); }
        arr.push(i);
      }
    }
    const used = new Set();
    const chains = [];
    const extend = (v0, e0) => {
      const pts = [];
      let len = 0, v = v0, ei = e0;
      const pa = [0, 0, 0], pb = [0, 0, 0];
      for (;;) {
        used.add(ei);
        const e = edges[ei];
        const nv = e.v1 === v ? e.v2 : e.v1;
        vAt(v, pa); vAt(nv, pb);
        pts.push([pa[0], pa[1], pa[2]]);
        len += Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        v = nv;
        if (v === v0) return { closed: true, points: pts, length: len };
        const inc = vEdges.get(v) || [];
        if (inc.length !== 2) { pts.push([pb[0], pb[1], pb[2]]); return { closed: false, points: pts, length: len }; }
        const next = inc[0] === ei ? inc[1] : inc[0];
        if (used.has(next)) { pts.push([pb[0], pb[1], pb[2]]); return { closed: false, points: pts, length: len }; }
        ei = next;
      }
    };
    // 交点（valence!==2）优先起步，保证环在交点处断开
    for (const [v, inc] of vEdges) if (inc.length !== 2) for (const ei of inc) if (!used.has(ei)) chains.push(extend(v, ei));
    for (const [v, inc] of vEdges) for (const ei of inc) if (!used.has(ei)) chains.push(extend(v, ei));
    return chains;
  };
  const featureChains = buildChains((e) => e.sharp || e.boundary);
  const boundaryChains = buildChains((e) => e.boundary);

  const topo = {
    sharpDeg, weldedCount: wpos.length / 3, triCount, degenerateCount,
    regions, triRegion, featureChains, boundaryChains,
    boundaryCount, nonManifoldCount, sharpCount,
    // 供可视化：边界边线段（扁平 xyz）
    boundarySegments() {
      const out = [];
      const pa = [0, 0, 0], pb = [0, 0, 0];
      for (const e of edgeMap.values()) {
        if (!e.boundary) continue;
        vAt(e.v1, pa); vAt(e.v2, pb);
        out.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
      }
      return out;
    },
    // 供可视化：过角度阈值的下表面三角形索引（zBed：接触热床的面排除）
    overhangTris(deg = 45, zBed = null) {
      const out = [];
      const cosO = Math.cos(deg * DEG2RAD);
      for (let t = 0; t < triCount; t++) {
        if (normals[t * 3 + 2] >= -cosO) continue;
        if (zBed !== null) {
          const a = vAt(tris[t * 3]), b = vAt(tris[t * 3 + 1]), c = vAt(tris[t * 3 + 2]);
          if (a[2] <= zBed && b[2] <= zBed && c[2] <= zBed) continue;
        }
        out.push(t);
      }
      return out;
    },
    // 三角形法线查询（原始三角形索引）
    triNormal(t) { return [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]]; },
  };
  shape._topo = topo;
  return topo;
}

/** 打印就绪综合检测（结果可直接反馈给 AI） */
function analyzePrintability(shape, opts = {}) {
  const { overhangDeg = 45 } = opts || {};
  const topo = meshTopology(shape);
  const oh = topo.overhangTris(overhangDeg);
  let overhangArea = 0;
  const idx = shape.indices, pos = shape.positions;
  const zBed = shape.bounds().min[2] + 0.2; // 接触热床的下表面不算悬空
  for (const t of oh) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    if (pos[a + 2] <= zBed && pos[b + 2] <= zBed && pos[c + 2] <= zBed) continue;
    const ab = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const ac = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    overhangArea += vLength(_v3cross(ab, ac)) / 2;
  }
  const totalArea = shape.area() || 1;
  const watertight = topo.boundaryCount === 0 && topo.nonManifoldCount === 0;
  return {
    watertight,
    openEdges: topo.boundaryCount,
    openLoops: topo.boundaryChains.length,
    nonManifoldEdges: topo.nonManifoldCount,
    overhangDeg,
    overhangArea,
    overhangRatio: overhangArea / totalArea,
    regions: topo.regions.length,
    planarFaces: topo.regions.filter((r) => r.planar).length,
    featureEdges: topo.sharpCount,
  };
}

/* ============================================================================
 * 八·三·五、壁厚近似检测（网格级）：从表面三角形重心沿 -法线（指向实体内部）
 * 发射线，最近命中距离 = 局部厚度近似。薄壁/薄板件准确；复杂内腔/孔洞件
 * 的最近命中可能是孔壁而非对侧壁（会低估，仅供定位薄壁嫌疑）。
 * ========================================================================== */

/** Möller–Trumbore 射线-三角形交点参数 t（dir 归一化；未命中/平行返回 null） */
function _rayTriT(ox, oy, oz, dx, dy, dz, v0, v1, v2) {
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const pv = _v3cross([dx, dy, dz], e2);
  const det = _v3dot(e1, pv);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = [ox - v0[0], oy - v0[1], oz - v0[2]];
  const u = _v3dot(tv, pv) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qv = _v3cross(tv, e1);
  const v = _v3dot([dx, dy, dz], qv) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = _v3dot(e2, qv) * inv;
  return t > 0 ? t : null;
}

/**
 * 壁厚近似检测。opts: { minWall=1.2, maxDist=60, samples=160 }——
 * minWall=关注阈值（低于记为薄壁样本）；maxDist=射线最大行程（mm）；
 * samples=采样三角形上限。返回 { skipped?, reason?, minWall, avgWall, samples, below, minAt }。
 */
function detectThinWalls(shape, opts = {}) {
  const { minWall = 1.2, maxDist = 60, samples = 160, triBudget = 400000 } = opts || {};
  const empty = { skipped: true, reason: 'empty mesh', minWall: null, avgWall: null, samples: 0, below: 0, minAt: null };
  const pos = shape.positions, idx = shape.indices;
  const triCount = idx.length / 3;
  if (!triCount) return empty;
  if (triCount > 500000) return { skipped: true, reason: 'triangles > 500k, wall detection skipped', minWall: null, avgWall: null, samples: 0, below: 0, minAt: null };
  const box = shape.bounds();
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 1;
  const cell = Math.max(diag / 24, 0.05);
  const hb = _buildTriHash(pos, idx, cell);
  const eps = cell * 0.06; // 起点沿 -法线进入实体内部（同 _containmentHit 口径）
  let min = Infinity, sum = 0, tested = 0, below = 0;
  let minAt = null;
  let budget = triBudget;

  // 分层均匀采样：k 在 [0,samples) 内每层取代表三角形（小网格全覆盖，大网格均匀）
  const seenTri = new Set();
  for (let k = 0; k < samples && budget > 0; k++) {
    const t = Math.min(triCount - 1, Math.floor(((k + 0.5) / samples) * triCount)) * 3;
    if (seenTri.has(t)) continue;
    seenTri.add(t);
    const a = [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]];
    const b = [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]];
    const c = [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]];
    const n = _v3cross(_v3sub(b, a), _v3sub(c, a));
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-9) continue; // 零面积
    const nx = n[0] / nl, ny = n[1] / nl, nz = n[2] / nl;
    const gx = (a[0] + b[0] + c[0]) / 3, gy = (a[1] + b[1] + c[1]) / 3, gz = (a[2] + b[2] + c[2]) / 3;
    const ox = gx - nx * eps, oy = gy - ny * eps, oz = gz - nz * eps;

    // Amanatides–Woo 体素遍历，沿 -法线方向找最近命中
    let cx = Math.floor(ox / cell), cy = Math.floor(oy / cell), cz = Math.floor(oz / cell);
    const sx = nx < 0 ? 1 : -1, sy = ny < 0 ? 1 : -1, sz = nz < 0 ? 1 : -1; // 射线方向 = (-nx,-ny,-nz)
    const tdx = nx !== 0 ? Math.abs(cell / nx) : Infinity;
    const tdy = ny !== 0 ? Math.abs(cell / ny) : Infinity;
    const tdz = nz !== 0 ? Math.abs(cell / nz) : Infinity;
    let tmx = nx !== 0 ? ((cx + (sx > 0 ? 1 : 0)) * cell - ox) / -nx : Infinity;
    let tmy = ny !== 0 ? ((cy + (sy > 0 ? 1 : 0)) * cell - oy) / -ny : Infinity;
    let tmz = nz !== 0 ? ((cz + (sz > 0 ? 1 : 0)) * cell - oz) / -nz : Infinity;
    let nearest = null;
    while (true) {
      const cands = hb.hash.get(_hashKeyOf(cx * cell, cy * cell, cz * cell, cell));
      if (cands) {
        for (const bi of cands) {
          budget--;
          const tri = hb.tris[bi];
          const d = _rayTriT(ox, oy, oz, -nx, -ny, -nz, tri[0], tri[1], tri[2]);
          if (d !== null && d > eps && d <= maxDist && (nearest === null || d < nearest)) nearest = d;
        }
      }
      if (nearest !== null) break; // DDA 按 t 单调访问 cell：首个含命中 cell 即全局最近
      if (tmx <= tmy && tmx <= tmz) {
        if (tmx > maxDist) break;
        cx += sx; tmx += tdx;
      } else if (tmy <= tmz) {
        if (tmy > maxDist) break;
        cy += sy; tmy += tdy;
      } else {
        if (tmz > maxDist) break;
        cz += sz; tmz += tdz;
      }
    }

    if (nearest !== null) {
      tested++;
      sum += nearest;
      if (nearest < min) { min = nearest; minAt = [Math.round(gx * 100) / 100, Math.round(gy * 100) / 100, Math.round(gz * 100) / 100]; }
      if (nearest < minWall) below++;
    }
  }
  if (!tested) return { skipped: false, reason: 'no inward hits', minWall: null, avgWall: null, samples: 0, below: 0, minAt: null };
  return {
    skipped: false,
    minWall: Math.round(min * 100) / 100,
    avgWall: Math.round((sum / tested) * 100) / 100,
    samples: tested,
    below,
    minAt: minAt ? [minAt[0], minAt[1], minAt[2]] : null,
  };
}

/* ============================================================================
 * 八·四、切片分析：平面 z=h 与网格求交，线段连接成截面环（2D 预览用）
 * ========================================================================== */

function sliceMesh(shape, z) {
  const pos = shape.positions, idx = shape.indices;
  const zz = z + 1e-7; // 微偏避免顶点恰好落在切平面上
  const segs = [];
  for (let i = 0; i < idx.length; i += 3) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = idx[i + k] * 3, b = idx[i + ((k + 1) % 3)] * 3;
      const da = pos[a + 2] - zz, db = pos[b + 2] - zz;
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        pts.push([pos[a] + (pos[b] - pos[a]) * t, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t]);
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  // 连接成环/折线（按量化端点）
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const end of [0, 1]) {
      const k = key(s[end]);
      let arr = adj.get(k);
      if (!arr) { arr = []; adj.set(k, arr); }
      arr.push(i);
    }
  });
  const used = new Set();
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const chain = [segs[i][0], segs[i][1]];
    // 两端延伸
    for (const end of ['head', 'tail']) {
      for (;;) {
        const tip = end === 'head' ? chain[0] : chain[chain.length - 1];
        const cands = adj.get(key(tip)) || [];
        let advanced = false;
        for (const ci of cands) {
          if (used.has(ci)) continue;
          used.add(ci);
          const s = segs[ci];
          const np = key(s[0]) === key(tip) ? s[1] : s[0];
          if (end === 'head') chain.unshift(np); else chain.push(np);
          advanced = true;
          break;
        }
        if (!advanced) break;
      }
    }
    const closed = key(chain[0]) === key(chain[chain.length - 1]);
    loops.push({ points: chain, closed });
  }
  return { z, segments: segs.length, loops };
}

/* ============================================================================
 * 九、参数化面板：解析 @param 注释并生成 UI 数据
 *
 * 约定格式（写在 const 声明的上一行）：
 *   // @param width 房屋宽度 (mm) {min: 4000, max: 20000, step: 100}
 *   const width = 8000;
 * ========================================================================== */

const PARAM_RE = /\/\/\s*@param\s+([A-Za-z_$][\w$]*)\s+([^\n{]*?)\s*(\{[^}]*\})?\s*\n\s*(?:const|let|var)\s+\1\s*=\s*(-?[\d.]+)/g;

function parseParams(code) {
  const params = [];
  let m;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(code)) !== null) {
    const opts = {};
    if (m[3]) {
      const optRe = /(\w+)\s*:\s*(-?[\d.]+)/g;
      let om;
      while ((om = optRe.exec(m[3])) !== null) opts[om[1]] = parseFloat(om[2]);
    }
    params.push({
      name: m[1],
      label: (m[2] || m[1]).trim(),
      value: parseFloat(m[4]),
      min: opts.min ?? 0,
      max: opts.max ?? (parseFloat(m[4]) * 3 || 100),
      step: opts.step ?? (Number.isInteger(parseFloat(m[4])) ? 1 : 0.1),
    });
  }
  return params;
}

function applyParamValue(code, name, value) {
  const re = new RegExp(`((?:const|let|var)\\s+${name.replace(/[$]/g, '\\$')}\\s*=\\s*)-?[\\d.]+`);
  return code.replace(re, `$1${value}`);
}

/* ============================================================================
 * 十、用户代码内核 API（注入到用户代码作用域）
 * ========================================================================== */

const KERNEL_API = {
  box, cylinder, cone, sphere, torus, pipe,
  lathe, revolve, gearProfile, hole,
  sketchRect, sketchCircle, sketchPolygon, sketchRoundedRect,
  meshFromVerts, loft, sweep, subdivide, displace, smooth,
  Sketch, Shape,
  deg2rad: (d) => d * DEG2RAD,
};

/* ============================================================================
 * 十一、格式化工具
 * ========================================================================== */

function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(3) + ' m³';
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' cm³';
  return v.toFixed(1) + ' mm³';
}
function fmtArea(a) {
  if (a >= 1e6) return (a / 1e6).toFixed(3) + ' m²';
  if (a >= 1e4) return (a / 1e4).toFixed(3) + ' cm²';
  return a.toFixed(1) + ' mm²';
}
function fmtLen(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(3) + ' m';
  return v.toFixed(1) + ' mm';
}

/* ============================================================================
 * 十二、导出
 * ========================================================================== */

export {
  KERNEL_API,
  parseParams, applyParamValue,
  toSTLBinary, toSTLAscii, toOBJ, toModelJSON, to3MF,
  detectInterference,
  meshTopology, analyzePrintability, detectThinWalls, sliceMesh,
  traceApi, buildSteps, _recTrace, _traceStart, _traceStop, _traceSuspend, _traceResume, _trace,
  meshFromVerts, loft, sweep, subdivide, displace, smooth,
  fmtInt, fmtVol, fmtArea, fmtLen,
};
export { _kernelCtrl as kernelCtrl };
