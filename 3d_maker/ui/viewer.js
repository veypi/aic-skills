/**
 * ============================================================================
 * Viewer —— 轻量级 Web 3D CAD 查看器（纯逻辑引擎，无 DOM / 无样式）
 * ============================================================================
 *
 * 职责边界：
 *   - 本文件只做「数据处理 + 相关事件」：几何内核执行、Three.js 渲染、
 *     选择 / 测量 / 剖切 / 导出等能力，并通过事件向外暴露状态。
 *   - 不创建任何 DOM / 样式 / 界面元素；UI 全部由宿主页面（index.html）实现。
 *   - 构造函数接收一个 <canvas> 元素作为渲染目标。
 *
 * 用法：
 *   import Viewer from './viewer.js';
 *   const viewer = new Viewer(canvasEl, { theme: 'light', shadows: true });
 *   viewer.on('shapeLoaded', (r) => { ... });
 *   await viewer.run('return box(50, 30, 20).fillet(4);');
 *
 * 事件（viewer.on(name, cb)）：
 *   ready                          初始化完成
 *   status    {type,text}          运行状态（type: ok | busy | error）
 *   shapeLoaded result             模型更新（run() 的成功 result）
 *   error     result               运行错误（success:false 的 result）
 *   warnings  string[]             非致命警告（如不支持的 fillet）
 *   reset                          场景已清空
 *   kernelChange {name,reverted?}  几何内核切换（OCCT 加载完成 / 失败回退）
 *   viewModeChange mode            视图模式变化
 *   projectionChange mode          投影变化（perspective | orthographic）
 *   themeChange theme              场景主题变化（light | dark）
 *   selectionChange array          选中部件变化 [{index,name,volume,area}]
 *   visibilityChange array         部件可见性变化（部件树/隔离/隐藏后）[{index,name,color,visible,volume}]
 *   pickModeChange mode            拾取模式变化（part | face | edge | vertex）
 *   pick      result|null          拾取元素数据（点=坐标 / 边=端点+长度 / 面=法线+面积+拾取点）；null 表示清除
 *   explodeChange factor           爆炸程度变化（0~1）
 *   sliceChange result|null        切片更新 {z,min,max,segments,loops}；null 表示关闭
 *   measure   result|null          测量完成 {distance,points,text}；null 表示清除
 *   measureModeChange bool         测量模式开关
 *   sectionRange {axis,min,max,value}  剖切范围（模型变化 / 进入剖面时触发）
 *   click     {partIndex,partName,point}  部件点击
 *   export    {blob,format}        导出完成
 * ============================================================================
 */

import * as THREE from './three.module.js';
import { OrbitControls } from './orbit-controls.js';
import { GLTFExporter } from './gltf-exporter.js';
import { runCodeAndAnalyze, makeErrorResult } from './run-core.js';
import {
  GeomError, Shape, KERNEL_API, kernelCtrl,
  parseParams, applyParamValue,
  toSTLBinary, toSTLAscii, toOBJ, toModelJSON, to3MF,
  detectInterference,
  meshTopology, analyzePrintability, detectThinWalls, sliceMesh,
  fmtInt, fmtVol, fmtArea, fmtLen,
} from './kernel.js';

const DEG2RAD = Math.PI / 180;
const _xcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _xlen = (a) => Math.hypot(a[0], a[1], a[2]);

export class Viewer {
  /**
   * @param {string|HTMLCanvasElement} canvas 画布选择器或元素
   * @param {object} options
   *   theme: 'light' | 'dark' | 'auto'   场景主题（只影响 3D 场景配色）
   *   antialias / shadows / grid / axes / groundPlane: 显示开关
   *   maxTriangles: 三角面警告上限
   *   transparency: 透明 / X 光模式的不透明度
   *   kernel: 外部内核（默认内置 KERNEL_API）
   *   onReady / onError / onShapeChange: 兼容回调（等价于同名事件）
   *   autoInit: false 时需手动 await init()
   */
  constructor(canvas, options = {}) {
    const el = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
    if (!el || !(el instanceof HTMLCanvasElement)) {
      throw new Error('Viewer: 需要一个 <canvas> 元素作为渲染目标');
    }
    this.canvas = el;
    this.options = {
      theme: 'light',
      antialias: true,
      shadows: true,
      grid: true,
      axes: true,
      groundPlane: true,
      maxTriangles: 1_000_000,
      transparency: 0.5,
      kernel: null,
      onReady: null,
      onError: null,
      onShapeChange: null,
      ...options,
    };

    // 运行状态
    this._theme = this.options.theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : this.options.theme;
    this._parts = [];            // [{ name, shape, color, mesh, edges, wire, visible }]
    this._result = null;         // 最近一次 run 的返回值
    this._running = false;
    this._code = '';             // 最近一次执行的代码
    this._viewMode = 'solid';
    this._projection = 'perspective';
    this._measureMode = false;
    this._measure = { points: [], objects: [] };
    this._selected = new Set();
    this._explode = 0;             // 爆炸视图程度 0~1
    this._pickMode = 'part';       // 拾取模式：part（部件）| face（面）| edge（边）| vertex（点）
    this._pick = null;             // 当前拾取 {mode, data, objects}
    this._showOpenEdges = false;   // 开放边高亮
    this._showOverhang = false;    // 悬空面高亮
    this._slicing = false;         // 切片分析开关
    this._sliceZ = 0;
    this._sliceMin = 0;
    this._sliceMax = 0;
    this._listeners = {};
    this._clip = { axis: 'XY', offset: 0, invert: false, plane: null };
    this._kernelName = 'builtin';    // 当前内核：builtin（内置 JS）| occt（WASM 高性能）| custom
    this._params = [];
    this._animFrame = null;
    this._downPos = null;

    if (this.options.autoInit !== false) {
      this._initPromise = this.init();
      this.ready = this._initPromise;
    }
  }

  /* ================= 事件系统 ================= */

  on(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
    return this;
  }
  addEventListener(evt, cb) { return this.on(evt, cb); }
  off(evt, cb) {
    const arr = this._listeners[evt];
    if (arr) this._listeners[evt] = arr.filter((f) => f !== cb);
    return this;
  }
  _emit(evt, ...args) {
    for (const cb of this._listeners[evt] || []) {
      try { cb(...args); } catch (e) { console.error(`[Viewer] ${evt} 事件回调出错`, e); }
    }
  }
  _emitStatus(type, text) {
    this._status = { type, text };
    this._emit('status', this._status);
  }

  /* ================= 初始化 ================= */

  async init() {
    if (this._initialized) return this;
    this._initThree();
    this._bindPointer();
    this._initialized = true;
    this._emitStatus('ok', '就绪');
    this._emit('ready');
    this.options.onReady?.();
    return this;
  }

  _frame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }

  /* ================= Three.js 场景 ================= */

  _initThree() {
    const o = this.options;
    const dark = this._theme === 'dark';

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: o.antialias });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = o.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(dark ? 0x10131a : 0xeef0f4);

    // CAD 约定：Z 轴向上
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    this.perspCamera.up.set(0, 0, 1);
    this.perspCamera.position.set(140, -170, 110);
    this.orthoCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, -1e5, 1e5);
    this.orthoCamera.up.set(0, 0, 1);
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.camera = this.perspCamera;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 0);

    // 灯光
    this.hemiLight = new THREE.HemisphereLight(0xffffff, dark ? 0x20242c : 0xbfc5cf, 0.85);
    this.scene.add(this.hemiLight);
    this.keyLight = new THREE.DirectionalLight(0xffe2b8, 1.6);
    this.keyLight.position.set(120, -100, 180);
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    fill.position.set(-120, 100, 60);
    this.scene.add(fill);

    // 网格 / 坐标轴 / 地面（Z-up：网格位于 XY 平面）
    this.gridHelper = new THREE.GridHelper(2000, 40, dark ? 0x39404e : 0xc8ccd4, dark ? 0x262b36 : 0xdfe2e8);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.visible = o.grid;
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(80);
    this.axesHelper.visible = o.axes;
    this.scene.add(this.axesHelper);

    this.groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.2 }),
    );
    this.groundMesh.position.z = -0.01;
    this.groundMesh.receiveShadow = true;
    this.groundMesh.visible = o.groundPlane;
    this.scene.add(this.groundMesh);

    this._applyShadows();

    // 模型分组
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.measureGroup = new THREE.Group();
    this.scene.add(this.measureGroup);
    this.pickGroup = new THREE.Group();
    this.scene.add(this.pickGroup);
    this.printGroup = new THREE.Group();
    this.scene.add(this.printGroup);
    this.sliceGroup = new THREE.Group();
    this.sliceGroup.visible = false;
    this.scene.add(this.sliceGroup);
    this.slicePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.sliceGroup.add(this.slicePlane);

    this._materialProps = { color: '#8fa3bf', metalness: 0.1, roughness: 0.6 };

    // 尺寸自适应（画布由 CSS 控制显示尺寸，这里只同步绘图缓冲）
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas);
    this._resize();

    // 渲染循环
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /* ================= 截图 ================= */

  // shot：渲染当前视图并返回 JPEG Blob + 尺寸。
  // 注意：WebGLRenderer 默认 preserveDrawingBuffer=false——必须在本次 render 后
  // 的同一同步块内调用 toBlob/toDataURL，否则读回的是空缓冲。
  // opts: { maxWidth: 输出最大宽度（等比缩放，默认 1600）, quality: JPEG 质量（默认 0.85） }
  async shot(opts = {}) {
    if (!this.renderer) throw new Error('renderer not ready');
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const maxW = Math.max(1, opts.maxWidth || 1600);
    const scale = Math.min(1, maxW / Math.max(1, src.width));
    let out = src;
    if (scale < 1) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * scale));
      c.height = Math.max(1, Math.round(src.height * scale));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      out = c;
    }
    // toBlob 与 toDataURL 同为调用瞬间同步快照（preserveDrawingBuffer 语义一致）；
    // 直接产 Blob 免 base64 中转——fetch(dataUrl) 还会踩 vhtml scoped 把 data: 前缀化
    const blob = await new Promise((resolve, reject) =>
      out.toBlob(resolve, 'image/jpeg', opts.quality || 0.85));
    if (!blob) throw new Error('toBlob failed');
    return { blob, width: out.width, height: out.height };
  }

  /* ================= 逐部件打印审计（parts_audit） ================= */

  // audit：当前场景逐部件问题清单（水密/非流形/悬空/薄壁/干涉），供 AI 修模定位。
  // opts: { minWall=1.2（mm，低于记为薄壁 critical） }。
  // 输出 { summary:{parts,critical,warning,ready}, parts:[{index,name,watertight,openEdges,
  //        openLoops,nonManifoldEdges,overhangDeg,overhangArea,overhangRatio,minWall,
  //        minWallSamples,volume,area,conflicts,issues:[{level,type,detail}]}], approximate }。
  audit(opts = {}) {
    const minWall = opts.minWall ?? 1.2;
    const parts = this._parts || [];
    const out = {
      ok: true,
      summary: { parts: parts.length, critical: 0, warning: 0, ready: false },
      parts: [],
      approximate: false,
    };
    if (!parts.length) {
      out.summary.ready = true;
      return out;
    }

    // 干涉（全局一次）
    let interference = { count: 0, pairs: [], approximate: false };
    if (parts.length > 1) {
      try { interference = detectInterference(parts); } catch (e) { console.warn('[Viewer] 干涉检测异常:', (e && e.message) || e); }
    }
    out.approximate = interference.approximate;
    const conflictOf = (i) => interference.pairs
      .flatMap((p) => [[p.a, p.bName], [p.b, p.aName]])
      .filter(([x]) => x === i)
      .map(([, n]) => n);

    let critical = 0, warning = 0;
    const items = parts.map((p, i) => {
      const pr = analyzePrintability(p.shape);
      const wall = detectThinWalls(p.shape, { minWall });
      const issues = [];
      if (!pr.watertight) {
        issues.push({ level: 'critical', type: 'not_watertight', detail: `水密性失败：开放边 ${pr.openEdges} 条 / 裂缝环 ${pr.openLoops} 个` });
      }
      if (pr.nonManifoldEdges > 0) {
        issues.push({ level: 'critical', type: 'non_manifold', detail: `${pr.nonManifoldEdges} 条非流形边` });
      }
      if (wall.minWall !== null && wall.minWall < minWall) {
        issues.push({ level: 'critical', type: 'thin_wall', detail: `壁厚近似 ${wall.minWall}mm < ${minWall}mm（位于 ${(wall.minAt || []).join(', ')}）` });
      }
      const totalArea = p.shape.area() || 1;
      const oh = pr.overhangArea / totalArea;
      if (pr.overhangArea > 50 && oh > 0.01) {
        issues.push({ level: 'warning', type: 'overhang', detail: `悬空 ${fmtArea(pr.overhangArea)}（${(oh * 100).toFixed(1)}%）超过 ${pr.overhangDeg}°，打印需支撑` });
      }
      const conflicts = conflictOf(i);
      if (conflicts.length) {
        issues.push({ level: 'warning', type: 'interference', detail: `与 ${conflicts.join('、')} 位置干涉` });
      }
      if (issues.some((x) => x.level === 'critical')) critical++;
      else if (issues.length) warning++;
      return {
        index: i,
        name: p.name || ('部件 ' + (i + 1)),
        watertight: pr.watertight,
        openEdges: pr.openEdges,
        openLoops: pr.openLoops,
        nonManifoldEdges: pr.nonManifoldEdges,
        overhangDeg: pr.overhangDeg,
        overhangArea: Math.round(pr.overhangArea * 100) / 100,
        overhangRatio: Math.round(oh * 10000) / 10000,
        minWall: wall.minWall,
        minWallSamples: wall.samples || 0,
        volume: Math.round(p.shape.volume() * 100) / 100,
        area: Math.round(p.shape.area() * 100) / 100,
        conflicts,
        issues,
      };
    });
    out.parts = items;
    out.summary.critical = critical;
    out.summary.warning = warning;
    out.summary.ready = critical === 0;
    return out;
  }

  _resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); // 不改 canvas.style，尺寸交给 CSS
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    const halfH = this.orthoCamera.top;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.updateProjectionMatrix();
  }

  _applyShadows() {
    const on = !!this.options.shadows;
    if (this.renderer) this.renderer.shadowMap.enabled = on;
    this.keyLight.castShadow = on;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    for (const part of this._parts || []) {
      part.mesh.castShadow = on;
      part.mesh.receiveShadow = on;
      part.mesh.material.needsUpdate = true;
    }
  }

  /* ================= 指针 / 键盘交互（绑定在 canvas 上） ================= */

  _bindPointer() {
    const c = this.canvas;
    this._onPointerDown = (e) => { this._downPos = [e.clientX, e.clientY]; };
    this._onPointerUp = (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
      this._downPos = null;
      if (moved > 5 || e.target !== c) return;
      if (this._measureMode) this._measureClick(e);
      else if (this._pickMode !== 'part') this._pickClick(e);
      else this._selectClick(e);
    };
    this._onDblClick = (e) => {
      const hit = this._raycastParts(e);
      if (hit) this._fitToObject(hit.object);
    };
    this._onKeyDown = (e) => this._hotkeys(e);
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointerup', this._onPointerUp);
    c.addEventListener('dblclick', this._onDblClick);
    c.addEventListener('keydown', this._onKeyDown);
  }

  _hotkeys(e) {
    switch (e.key.toLowerCase()) {
      case 'f': this.fitToView(); break;
      case 'm': this.enableMeasurement(!this._measureMode); break;
      case 's': this.setViewMode(this._viewMode === 'section' ? 'solid' : 'section'); break;
      case 'escape':
        if (this._running) this.abort();
        else if (this._measureMode) this.enableMeasurement(false);
        else this._clearPick();
        break;
    }
  }

  /* ================= 代码执行 ================= */

  /**
   * 运行用户代码。
   * @param {string} code 建模代码，需 return 一个 Shape / Shape[] / {name,shape,color}[]
   * @param {object} opts { timeout, onProgress }
   * @returns {Promise<object>} result（success / parts / stats / warnings / executionTime）
   */
  async run(code, opts = {}) {
    if (this._running) return this._result;
    this._running = true;
    this._code = code;
    this._emitStatus('busy', '编译中…');
    opts.onProgress?.(10);
    await this._frame(); // 让状态先绘制

    const t0 = performance.now();
    const kernel = this.options.kernel || null;
    let result;
    try {
      let parts = null;
      if (kernel && kernel.worker) {
        // OCCT Worker：执行+分析全在 worker（与主线程共享 run-core 管线），主线程只收
        // result + mesh 数据；重建内置 Shape 仅供渲染/交互（精确体积/面积等统计已由
        // worker 侧用 B-Rep 算好放进 result，AI 通道以 result 为准）
        const out = await kernel.run(code, { timeout: opts.timeout, maxTriangles: this.options.maxTriangles });
        result = out.result;
        if (result.success && out.partsMesh) {
          parts = out.partsMesh.map((m) => ({
            name: m.name,
            color: m.color,
            shape: new Shape(m.positions, m.indices, null),
          }));
        }
      } else {
        ({ result, parts } = runCodeAndAnalyze(code, null, {
          timeout: opts.timeout,
          maxTriangles: this.options.maxTriangles,
        }));
      }
      opts.onProgress?.(60);

      if (!result.success) {
        // 内核级失败（OCCT 对开放网格 B-Rep 重建限 2 万三角面，超限报错）：自动回退内置内核重跑一次。
        // 只对“重建超限”类错误回退（不掩盖用户代码 bug）；重跑成功的结果带 kernelFallback 标记，
        // 保证「切 OCCT 后重跑大模型」不炸——超限模型仍内置渲染，小模型照常 OCCT。
        const msg = String(result.message || result.errorType || '');
        if (kernel && !opts._fallback && /rebuild|too large|B-Rep|Brep|BRep|reconstruct/i.test(msg)) {
          const prevKernelName = this._kernelName;
          console.warn('[Viewer] 内核执行失败，自动回退内置内核重试:', msg);
          this.options.kernel = null;
          this._kernelName = 'builtin';
          this._emit('kernelChange', { name: 'builtin', reverted: true, error: msg });
          this._running = false;
          const r2 = await this.run(code, { ...opts, _fallback: true });
          if (r2 && r2.success) {
            r2.kernelFallback = { from: prevKernelName, reason: msg };
            r2.warnings = (r2.warnings || []).concat([`当前模型超出 ${prevKernelName} 的网格重建限额，已自动用内置内核渲染（${msg}）`]);
          }
          return r2;
        }
        this._result = result;
        this._emitStatus('error', '错误：' + (result.message || '未知错误'));
        this._emit('error', result);
        this.options.onError?.(result);
        return result;
      }

      this._setParts(parts);
      this._result = result;
      this._emitStatus('ok', `就绪（${result.executionTime} ms）`);
      this._emit('shapeLoaded', result);
      this.options.onShapeChange?.(result);
      if (result.warnings && result.warnings.length) this._emit('warnings', result.warnings);
    } catch (err) {
      // 传输级异常（worker 不可用/消息破损）或主线程内置路径抛错
      result = makeErrorResult(err, performance.now() - t0);
      this._result = result;
      this._emitStatus('error', '错误：' + (result.message || '未知错误'));
      this._emit('error', result);
      this.options.onError?.(result);
    } finally {
      this._running = false;
      opts.onProgress?.(100);
    }
    return result;
  }

  /** 中断当前计算：builtin = 协作标记（CSG 等长循环检查）；OCCT worker = terminate + 后台重建 */
  abort() {
    if (!this._running) return;
    const kernel = this.options.kernel;
    if (kernel && kernel.worker) kernel.abort();
    else kernelCtrl.aborted = true;
    this._emitStatus('busy', '正在中断…');
  }

  get running() { return this._running; }
  getCode() { return this._code; }
  getResult() { return this._result; }
  getStats() { return this._result && this._result.success ? this._result.stats : null; }

  get kernelName() { return this._kernelName; }

  /**
   * 运行时切换几何内核（如内置 JS 内核 → OCCT WASM 高性能内核）。
   * 切换后默认用最近执行的代码重建模型；若新内核运行失败则自动回退旧内核。
   * @param {object|null} kernel 内核 API 对象（null 表示回退内置内核）
   * @param {object} opts { name: 内核标识名, rerun: 是否立即重建 }
   */
  async setKernel(kernel, { name = 'custom', rerun = true } = {}) {
    const prevKernel = this.options.kernel;
    const prevName = this._kernelName;
    this.options.kernel = kernel;
    this._kernelName = name;
    this._emit('kernelChange', { name });
    let r = null; // 提升为函数级：成功返回需带 kernelFallback/warnings（块级 const 在 return 处不可达）
    if (rerun && this._code) {
      r = await this.run(this._code);
      if (!r || !r.success) {
        console.warn(`[Viewer] 内核(${name})运行失败，回退(${prevName}):`, r && r.message);
        this.options.kernel = prevKernel;
        this._kernelName = prevName;
        this._emit('kernelChange', { name: prevName, reverted: true, error: r && r.message });
        await this.run(this._code);
        return { success: false, reverted: true, error: r };
      }
    }
    return { success: true, name, kernelFallback: r && r.kernelFallback, warnings: r && r.warnings };
  }

  /* ================= 场景内容管理 ================= */

  /** 解析带透明度的颜色：支持 #rrggbbaa / rgba(r,g,b,a)，返回 { color: 6位hex|null, a: alpha }；其他格式返回 null */
  _parseColorAlpha(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim();
    // #rrggbbaa：THREE.Color 不支持 8 位 hex，拆成 #rrggbb + alpha
    const hex8 = s.match(/^#([0-9a-f]{8})$/i);
    if (hex8) {
      return { color: '#' + hex8[1].slice(0, 6).toLowerCase(), a: parseInt(hex8[1].slice(6, 8), 16) / 255 };
    }
    // rgba(r,g,b,a)：RGB 交给 THREE.Color 原生解析（保持色彩管理一致），这里只取 alpha
    const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (rgba) {
      return { color: null, a: rgba[4] !== undefined ? Math.min(1, +rgba[4]) : 1 };
    }
    return null;
  }

  _setParts(parts) {
    // 清理旧模型
    this._clearPick();
    for (const p of this._parts) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.edges.geometry.dispose();
      p.wire.geometry.dispose();
      this.modelGroup.remove(p.mesh, p.edges, p.wire);
    }
    this._parts = [];
    this._selected.clear();
    this._emit('selectionChange', []);

    const edgeColor = this._theme === 'dark' ? 0x9ca3af : 0x374151;
    const wireColor = this._theme === 'dark' ? 0x6b7280 : 0x4b5563;

    for (const [i, part] of parts.entries()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.shape.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(part.shape.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const color = new THREE.Color(part.color || this._materialProps.color);
      // 部件颜色支持带透明度（rgba() / #rrggbbaa）：透明部件开启 transparent + depthWrite=false
      let alpha = 1;
      const pa = this._parseColorAlpha(part.color);
      if (pa) {
        if (pa.color) color.setStyle(pa.color); // 8 位 hex 拆出的 RGB 重新走色彩管理解析
        alpha = pa.a;
      }
      const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: this._materialProps.metalness,
        roughness: this._materialProps.roughness,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      if (alpha < 1) {
        mat.transparent = true;
        mat.opacity = alpha;
        mat.depthWrite = false;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.options.shadows;
      mesh.receiveShadow = this.options.shadows;
      mesh.userData.partIndex = i;

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 20),
        new THREE.LineBasicMaterial({ color: edgeColor }),
      );
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: wireColor }),
      );
      edges.userData.partIndex = i;
      wire.userData.partIndex = i;

      this.modelGroup.add(mesh, edges, wire);
      this._parts.push({ ...part, alpha, mesh, edges, wire, visible: true });
    }
    this._applyViewMode();
    this._applyExplode();
    this._applyPrintViz();
    if (this._slicing) {
      const mb = this._modelBounds();
      if (mb) {
        this._sliceMin = mb.min[2];
        this._sliceMax = mb.max[2];
        this._sliceZ = Math.max(this._sliceMin, Math.min(this._sliceMax, this._sliceZ));
        this._updateSlice();
      } else {
        this.setSlicing(false);
      }
    }
    this.fitToView();
    this._emitSectionRange();
  }

  /* ================= 视图控制 ================= */

  get viewMode() { return this._viewMode; }

  /** solid | wireframe | hidden | transparent | xray | section */
  setViewMode(mode) {
    this._viewMode = mode;
    if (mode === 'section' && !this._clip.plane) {
      const r = this.getSectionRange();
      if (r) this.setSectionPlane(r.axis, r.value, this._clip.invert);
    }
    this._applyViewMode();
    this._emit('viewModeChange', mode);
    if (mode === 'section') this._emitSectionRange();
  }

  _applyViewMode() {
    const mode = this._viewMode;
    const t = this.options.transparency;
    const clipPlanes = mode === 'section' && this._clip.plane ? [this._clip.plane] : [];
    for (const p of this._parts) {
      const m = p.mesh.material;
      const base = p.alpha !== undefined ? p.alpha : 1; // 部件自身透明度（来自 rgba 颜色）
      m.clippingPlanes = clipPlanes;
      m.transparent = base < 1;
      m.opacity = base;
      m.depthWrite = base >= 1;
      p.mesh.visible = p.visible && mode !== 'wireframe';
      p.edges.visible = p.visible && (mode === 'hidden' || mode === 'xray');
      p.wire.visible = p.visible && mode === 'wireframe';
      if (mode === 'transparent') {
        m.transparent = true;
        m.opacity = base * t;
        m.depthWrite = false;
        p.edges.visible = p.visible;
        p.edges.material.opacity = 0.5;
        p.edges.material.transparent = true;
      }
      if (mode === 'xray') {
        m.transparent = true;
        m.opacity = Math.min(base * t, 0.2);
        m.depthWrite = false;
      }
      m.needsUpdate = true;
    }
  }

  /**
   * 设置剖切平面。
   * @param {'XY'|'XZ'|'YZ'|'none'} plane 平面（法向分别为 Z / Y / X）
   * @param {number} offset 沿法向的偏移
   * @param {boolean} invert 翻转保留方向
   */
  setSectionPlane(plane = 'XY', offset = 0, invert = false) {
    this._clip.axis = plane;
    this._clip.offset = offset;
    this._clip.invert = invert;
    if (plane === 'none') {
      this._clip.plane = null;
    } else {
      const normal = { XY: [0, 0, -1], XZ: [0, -1, 0], YZ: [-1, 0, 0] }[plane];
      if (invert) normal.forEach((v, i) => (normal[i] = -v));
      this._clip.plane = new THREE.Plane(
        new THREE.Vector3(...normal),
        invert ? -offset : offset,
      );
    }
    if (this._viewMode === 'section') this._applyViewMode();
  }

  /** 当前轴向的剖切范围（供 UI 设置滑杆 min/max/value） */
  getSectionRange(axis = this._clip.axis) {
    if (!this._parts.length || !this.modelGroup) return null;
    const a = axis === 'none' ? 'XY' : axis;
    const box3 = new THREE.Box3().setFromObject(this.modelGroup);
    const key = { XY: 'z', XZ: 'y', YZ: 'x' }[a];
    const pad = (box3.max[key] - box3.min[key]) * 0.05 + 1;
    return {
      axis: a,
      min: Math.floor(box3.min[key] - pad),
      max: Math.ceil(box3.max[key] + pad),
      value: (box3.min[key] + box3.max[key]) / 2,
    };
  }

  _emitSectionRange() {
    const r = this.getSectionRange();
    if (r) this._emit('sectionRange', r);
  }

  /** 自适应缩放至全部模型 */
  fitToView(padding = 1.25) {
    if (!this._parts.length || !this.camera) {
      this.camera?.position.set(140, -170, 110);
      this.controls?.target.set(0, 0, 0);
      return;
    }
    const box3 = new THREE.Box3().setFromObject(this.modelGroup);
    this._fitToBox(box3, padding);
  }

  _fitToObject(object3d) {
    const box3 = new THREE.Box3().setFromObject(object3d);
    if (!box3.isEmpty()) this._fitToBox(box3, 1.6);
  }

  _fitToBox(box3, padding) {
    const center = box3.getCenter(new THREE.Vector3());
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, -1.2, 0.8);
    dir.normalize();

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfFovTan = Math.tan((this.perspCamera.fov / 2) * DEG2RAD);
    const dist = (sphere.radius / (halfFovTan * Math.min(1, aspect))) * padding;

    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, sphere.radius * 1.5));
    this.controls.target.copy(center);
    this.perspCamera.near = Math.max(dist / 1000, 0.1);
    this.perspCamera.far = dist * 100;
    this.perspCamera.updateProjectionMatrix();

    // 正交相机保持一致的视野高度
    const halfH = dist * halfFovTan;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.position.copy(this.camera.position);
    this.orthoCamera.updateProjectionMatrix();

    // 主光源与阴影范围
    this.keyLight.position.copy(center).add(new THREE.Vector3(0.7, -0.9, 1.4).multiplyScalar(sphere.radius * 3));
    this.keyLight.target.position.copy(center);
    this.keyLight.target.updateMatrixWorld();
    const d = sphere.radius * 2.2;
    Object.assign(this.keyLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 0.1, far: sphere.radius * 10 });
    this.keyLight.shadow.camera.updateProjectionMatrix();

    // 网格 / 坐标轴 / 地面自适应模型尺寸，并贴到模型底部
    const floorZ = box3.min.z;
    const gridScale = Math.max((sphere.radius * 6) / 2000, 0.005);
    this.gridHelper.scale.set(gridScale, 1, gridScale);
    this.gridHelper.position.z = floorZ;
    const axesLen = Math.max(sphere.radius * 0.8, 1) / 80; // AxesHelper 默认长 80
    this.axesHelper.scale.set(axesLen, axesLen, axesLen);
    if (this.groundMesh) this.groundMesh.position.z = floorZ - 0.01;

    this.controls.update();
  }

  setCamera({ position, target } = {}) {
    if (position) this.camera.position.set(...position);
    if (target) this.controls.target.set(...target);
    this.controls.update();
  }

  get projection() { return this._projection; }

  /** perspective | orthographic */
  setProjection(mode) {
    if (mode === this._projection) return this._projection;
    const old = this.camera;
    const oldTarget = this.controls.target.clone();
    this._projection = mode;
    this.camera = mode === 'orthographic' ? this.orthoCamera : this.perspCamera;
    this.camera.position.copy(old.position);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.copy(oldTarget);
    this._resize();
    this._emit('projectionChange', mode);
    return mode;
  }

  toggleProjection() {
    return this.setProjection(this._projection === 'orthographic' ? 'perspective' : 'orthographic');
  }

  /* ================= 显示设置 / 主题 / 材质 ================= */

  /** { grid, axes, ground, shadows, transparency } —— 只传需要修改的键 */
  setDisplay(patch = {}) {
    const o = this.options;
    if (patch.grid !== undefined) {
      o.grid = !!patch.grid;
      if (this.gridHelper) this.gridHelper.visible = o.grid;
    }
    if (patch.axes !== undefined) {
      o.axes = !!patch.axes;
      if (this.axesHelper) this.axesHelper.visible = o.axes;
    }
    if (patch.ground !== undefined) {
      o.groundPlane = !!patch.ground;
      if (this.groundMesh) this.groundMesh.visible = o.groundPlane;
    }
    if (patch.shadows !== undefined) {
      o.shadows = !!patch.shadows;
      this._applyShadows();
    }
    if (patch.transparency !== undefined) {
      o.transparency = Math.min(0.95, Math.max(0.05, Number(patch.transparency)));
      if (this._viewMode === 'transparent' || this._viewMode === 'xray') this._applyViewMode();
    }
  }

  /** light | dark | auto —— 只影响 3D 场景配色，不涉及任何 DOM */
  setTheme(theme) {
    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    this._theme = theme;
    const dark = theme === 'dark';
    if (this.scene) this.scene.background = new THREE.Color(dark ? 0x10131a : 0xeef0f4);
    if (this.hemiLight) this.hemiLight.groundColor.set(dark ? 0x20242c : 0xbfc5cf);
    if (this.gridHelper) this.gridHelper.material.color.set(dark ? 0x39404e : 0xc8ccd4);
    if (this.groundMesh) this.groundMesh.material.opacity = dark ? 0.35 : 0.2;
    for (const p of this._parts) {
      p.edges.material.color.set(dark ? 0x9ca3af : 0x374151);
      p.wire.material.color.set(dark ? 0x6b7280 : 0x4b5563);
    }
    this._emit('themeChange', theme);
  }

  get theme() { return this._theme; }

  /** { color, metalness, roughness } —— 只传需要修改的键 */
  setMaterial(patch = {}) {
    Object.assign(this._materialProps, patch);
    const { color, metalness, roughness } = this._materialProps;
    for (const p of this._parts) {
      p.mesh.material.color.set(p.color || color);
      p.mesh.material.metalness = metalness;
      p.mesh.material.roughness = roughness;
    }
  }

  getMaterial() { return { ...this._materialProps }; }

  /** 启用/关闭剖切工具（等价于切换 section 视图模式） */
  enableSection(on = true) {
    this.setViewMode(on ? 'section' : 'solid');
  }

  /** 高亮某个部件（按索引或名称） */
  highlight(kind, id) {
    if (kind === 'part' || kind === 'body' || kind === 'face') {
      const idx = typeof id === 'number' ? id : this._parts.findIndex((p) => p.name === id);
      if (idx >= 0) {
        this._selected.clear();
        this._selected.add(idx);
        this._applySelection();
      }
    }
  }

  /* ================= 选择与隔离 ================= */

  _raycastParts(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = this._parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
    const hits = ray.intersectObjects(meshes, false);
    return hits[0] || null;
  }

  _selectClick(e) {
    const hit = this._raycastParts(e);
    if (!hit) {
      if (!e.shiftKey) { this._selected.clear(); this._applySelection(); }
      return;
    }
    const idx = hit.object.userData.partIndex;
    if (!e.shiftKey) this._selected.clear();
    if (this._selected.has(idx) && e.shiftKey) this._selected.delete(idx);
    else this._selected.add(idx);
    this._applySelection();
    this._emit('click', {
      partIndex: idx,
      partName: this._parts[idx].name,
      point: hit.point.toArray(),
    });
  }

  clearSelection() {
    this._selected.clear();
    this._applySelection();
  }

  _applySelection() {
    this._parts.forEach((p, i) => {
      const sel = this._selected.has(i);
      p.mesh.material.emissive = new THREE.Color(sel ? 0x2563eb : 0x000000);
      p.mesh.material.emissiveIntensity = sel ? 0.4 : 0;
    });
    this._emit('selectionChange', this.getSelection());
  }

  /** 当前选中部件摘要 [{index,name,volume,area}] */
  getSelection() {
    return [...this._selected]
      .filter((i) => this._parts[i])
      .map((i) => ({
        index: i,
        name: this._parts[i].name,
        volume: this._parts[i].shape.volume(),
        area: this._parts[i].shape.area(),
      }));
  }

  /** 只显示选中部件 */
  isolateSelected() {
    this._parts.forEach((p, i) => { p.visible = this._selected.has(i); });
    this._applyViewMode();
    this._emitVisibility();
  }

  /** 隐藏选中部件并清除选择 */
  hideSelected() {
    this._parts.forEach((p, i) => { if (this._selected.has(i)) p.visible = false; });
    this._selected.clear();
    this._applySelection();
    this._applyViewMode();
    this._emitVisibility();
  }

  /** 全部显示 */
  showAllParts() {
    this._parts.forEach((p) => { p.visible = true; });
    this._applyViewMode();
    this._emitVisibility();
  }

  /* ================= 爆炸视图 ================= */

  get explode() { return this._explode; }

  /** factor: 0（装配态）~ 1（完全爆炸）。部件沿「部件中心 − 装配中心」方向等比外移 */
  setExplode(factor = 0) {
    this._explode = Math.max(0, Math.min(1, Number(factor) || 0));
    this._applyExplode();
    this.fitToView();
    this._emit('explodeChange', this._explode);
  }

  _applyExplode() {
    if (!this._parts.length) return;
    this._clearPick();
    const f = this._explode || 0;
    const centers = this._parts.map((p) => {
      const b = p.shape.bounds();
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    });
    const C = [0, 0, 0];
    for (const c of centers) {
      C[0] += c[0] / centers.length;
      C[1] += c[1] / centers.length;
      C[2] += c[2] / centers.length;
    }
    this._parts.forEach((p, i) => {
      const d = [centers[i][0] - C[0], centers[i][1] - C[1], centers[i][2] - C[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      const off = l * f * 1.5;
      const px = l > 1e-9 ? (d[0] / l) * off : 0;
      const py = l > 1e-9 ? (d[1] / l) * off : 0;
      const pz = l > 1e-9 ? (d[2] / l) * off : 0;
      p.mesh.position.set(px, py, pz);
      p.edges.position.set(px, py, pz);
      p.wire.position.set(px, py, pz);
      // 打印高亮层跟随爆炸位移
      for (const obj of this.printGroup.children) {
        if (obj.userData.partIndex === i) obj.position.set(px, py, pz);
      }
    });
  }

  /* ================= 部件树 ================= */

  /** 部件清单（部件树面板数据）：[{index,name,color,visible,volume}] */
  getPartsInfo() {
    return this._parts.map((p, i) => ({
      index: i, name: p.name, color: p.color, visible: p.visible, volume: p.shape.volume(),
    }));
  }

  _emitVisibility() {
    this._emit('visibilityChange', this.getPartsInfo());
  }

  /** 设置单个部件可见性（部件树眼睛开关） */
  setPartVisible(index, visible) {
    const p = this._parts[index];
    if (!p) return;
    p.visible = !!visible;
    this._applyViewMode();
    this._emitVisibility();
  }

  /** 部件树点击选择（additive=true 时切换加选） */
  selectPart(index, additive = false) {
    if (!this._parts[index]) return;
    if (!additive) this._selected.clear();
    if (additive && this._selected.has(index)) this._selected.delete(index);
    else this._selected.add(index);
    this._applySelection();
  }

  /* ================= 拾取（面 / 边 / 点） ================= */

  get pickMode() { return this._pickMode; }

  /** part | face | edge | vertex —— 切换时清除当前拾取 */
  setPickMode(mode) {
    if (!['part', 'face', 'edge', 'vertex'].includes(mode)) return;
    this._pickMode = mode;
    this._clearPick();
    this._emit('pickModeChange', mode);
  }

  _clearPick() {
    if (this._pick) {
      for (const obj of this._pick.objects) {
        this.pickGroup.remove(obj);
        obj.geometry?.dispose();
        obj.material?.dispose();
      }
      this._pick = null;
      this._emit('pick', null);
    }
  }

  _pickClick(e) {
    const hit = this._raycastParts(e);
    this._clearPick();
    if (!hit) return;
    const mode = this._pickMode;
    const partIndex = hit.object.userData.partIndex;
    const part = this._parts[partIndex];
    const pos = part.shape.positions;
    // 模型局部坐标（与 shape 顶点同系；爆炸位移不影响数据展示）
    const P = hit.object.worldToLocal(hit.point.clone()).toArray();
    const { a, b, c } = hit.face;
    const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const objects = [];
    const color = 0x16a34a;
    const mk = (obj) => { obj.renderOrder = 995; objects.push(obj); return obj; };
    const toWorld = (p) => hit.object.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));
    let data = null;

    if (mode === 'vertex') {
      // 最近顶点
      let best = A, bd = Infinity;
      for (const V of [A, B, C]) {
        const d = (V[0] - P[0]) ** 2 + (V[1] - P[1]) ** 2 + (V[2] - P[2]) ** 2;
        if (d < bd) { bd = d; best = V; }
      }
      const size = Math.max(0.8, new THREE.Box3().setFromObject(this.modelGroup).getBoundingSphere(new THREE.Sphere()).radius * 0.01);
      const marker = mk(new THREE.Mesh(
        new THREE.SphereGeometry(size, 16, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      ));
      marker.position.copy(toWorld(best));
      this.pickGroup.add(marker);
      data = { mode, partIndex, partName: part.name, point: best };
    } else if (mode === 'edge') {
      // 最近特征边链（拓扑重建的完整边：锐边/边界边串链）
      const topo = meshTopology(part.shape);
      let best = null, bd = Infinity;
      for (const ch of topo.featureChains) {
        const pts = ch.points;
        const nseg = ch.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < nseg; i++) {
          const U = pts[i], V = pts[(i + 1) % pts.length];
          const UV = [V[0] - U[0], V[1] - U[1], V[2] - U[2]];
          const ll = UV[0] ** 2 + UV[1] ** 2 + UV[2] ** 2 || 1;
          let t = ((P[0] - U[0]) * UV[0] + (P[1] - U[1]) * UV[1] + (P[2] - U[2]) * UV[2]) / ll;
          t = Math.max(0, Math.min(1, t));
          const Q = [U[0] + UV[0] * t, U[1] + UV[1] * t, U[2] + UV[2] * t];
          const d = (Q[0] - P[0]) ** 2 + (Q[1] - P[1]) ** 2 + (Q[2] - P[2]) ** 2;
          if (d < bd) { bd = d; best = ch; }
        }
      }
      if (!best) {
        data = { mode, partIndex, partName: part.name, none: true, message: '该部件没有特征边（纯曲面内部无棱线）' };
      } else {
        const wpts = best.points.map(toWorld);
        if (best.closed && wpts.length) wpts.push(wpts[0].clone());
        const line = mk(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(wpts),
          new THREE.LineBasicMaterial({ color, depthTest: false }),
        ));
        this.pickGroup.add(line);
        data = {
          mode, partIndex, partName: part.name,
          closed: best.closed, length: best.length,
          segments: best.closed ? best.points.length : best.points.length - 1,
          a: best.closed ? null : best.points[0],
          b: best.closed ? null : best.points[best.points.length - 1],
        };
      }
    } else if (mode === 'face') {
      // 完整面区域（拓扑重建：跨平滑边合并的整面，平面/曲面）
      const topo = meshTopology(part.shape);
      const rid = topo.triRegion[hit.faceIndex];
      const region = rid >= 0 ? topo.regions[rid] : null;
      if (!region) {
        data = { mode, partIndex, partName: part.name, none: true, message: '命中退化三角形，无有效面数据' };
      } else {
        const pos2 = part.shape.positions, idx2 = part.shape.indices;
        const opos = [];
        for (const t of region.tris) {
          for (let k = 0; k < 3; k++) {
            const v = idx2[t * 3 + k] * 3;
            const wp = toWorld([pos2[v], pos2[v + 1], pos2[v + 2]]);
            opos.push(wp.x, wp.y, wp.z);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(opos, 3));
        const overlay = mk(new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }),
        ));
        this.pickGroup.add(overlay);
        data = {
          mode, partIndex, partName: part.name,
          kind: region.planar ? '平面' : '曲面',
          area: region.area,
          normal: region.planar ? [region.nx, region.ny, region.nz] : null,
          triangles: region.tris.length,
          point: P,
        };
      }
    }
    this._pick = { mode, data, objects };
    this._emit('pick', data);
  }

  /* ================= 打印检测可视化（开放边 / 悬空面高亮） ================= */

  setShowOpenEdges(on = true) {
    this._showOpenEdges = !!on;
    this._applyPrintViz();
  }

  setShowOverhang(on = true) {
    this._showOverhang = !!on;
    this._applyPrintViz();
  }

  _applyPrintViz() {
    while (this.printGroup.children.length) {
      const obj = this.printGroup.children[0];
      this.printGroup.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    if (!this._parts.length) return;
    for (const [i, p] of this._parts.entries()) {
      const topo = meshTopology(p.shape);
      if (this._showOpenEdges) {
        const segs = topo.boundarySegments();
        if (segs.length) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
          const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false }));
          lines.renderOrder = 994;
          lines.position.copy(p.mesh.position);
          lines.userData.partIndex = i;
          this.printGroup.add(lines);
        }
      }
      if (this._showOverhang) {
        const zBed = p.shape.bounds().min[2] + 0.2;
        const tris = topo.overhangTris(45, zBed);
        if (tris.length) {
          const pos = p.shape.positions, idx = p.shape.indices;
          const arr = [];
          for (const t of tris) {
            for (let k = 0; k < 3; k++) {
              const v = idx[t * 3 + k] * 3;
              arr.push(pos[v], pos[v + 1], pos[v + 2]);
            }
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
          const overlay = new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }),
          );
          overlay.renderOrder = 993;
          overlay.position.copy(p.mesh.position);
          overlay.userData.partIndex = i;
          this.printGroup.add(overlay);
        }
      }
    }
  }

  /* ================= 切片分析 ================= */

  get slicing() { return this._slicing; }
  get sliceZ() { return this._sliceZ; }

  setSlicing(on = true) {
    this._slicing = !!on;
    if (on) {
      if (this._explode > 0) this.setExplode(0);
      const mb = this._modelBounds();
      if (mb) {
        this._sliceMin = mb.min[2];
        this._sliceMax = mb.max[2];
        this._sliceZ = Math.max(this._sliceMin, Math.min(this._sliceMax, (mb.min[2] + mb.max[2]) / 2));
      }
      this._updateSlice();
    } else {
      this.sliceGroup.visible = false;
      this._emit('sliceChange', null);
    }
  }

  setSliceZ(z) {
    this._sliceZ = Math.max(this._sliceMin, Math.min(this._sliceMax, Number(z) || 0));
    if (this._slicing) this._updateSlice();
  }

  _modelBounds() {
    if (!this._parts.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of this._parts) {
      const b = p.shape.bounds();
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
    }
    return { min, max };
  }

  _updateSlice() {
    const mb = this._modelBounds();
    if (!mb) { this.setSlicing(false); return; }
    this.sliceGroup.visible = true;
    const w = Math.max(mb.max[0] - mb.min[0], mb.max[1] - mb.min[1]) * 1.2 || 10;
    this.slicePlane.scale.set(w, w, 1);
    this.slicePlane.position.set((mb.min[0] + mb.max[0]) / 2, (mb.min[1] + mb.max[1]) / 2, this._sliceZ);
    const loops = [];
    let segments = 0;
    for (const p of this._parts) {
      const r = sliceMesh(p.shape, this._sliceZ);
      segments += r.segments;
      for (const l of r.loops) loops.push(l);
    }
    this._emit('sliceChange', { z: this._sliceZ, min: this._sliceMin, max: this._sliceMax, segments, loops });
  }

  /* ================= 测量工具 ================= */

  get measureMode() { return this._measureMode; }

  enableMeasurement(on = true) {
    this._measureMode = on;
    if (!on) this._clearMeasure();
    this._emit('measureModeChange', on);
  }

  _measureClick(e) {
    const hit = this._raycastParts(e);
    if (!hit) return;
    if (this._measure.points.length >= 2) this._clearMeasure();
    const pt = hit.point.clone();
    this._measure.points.push(pt);

    const size = Math.max(1, new THREE.Box3().setFromObject(this.modelGroup).getBoundingSphere(new THREE.Sphere()).radius * 0.012);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(size, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5533, depthTest: false }),
    );
    marker.position.copy(pt);
    marker.renderOrder = 999;
    this.measureGroup.add(marker);
    this._measure.objects.push(marker);

    if (this._measure.points.length === 2) {
      const [a, b] = this._measure.points;
      const dist = a.distanceTo(b);
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff5533, depthTest: false }));
      line.renderOrder = 998;
      this.measureGroup.add(line);
      this._measure.objects.push(line);
      this._emit('measure', { distance: dist, points: [a.toArray(), b.toArray()], text: fmtLen(dist) });
    }
  }

  _clearMeasure() {
    for (const obj of this._measure.objects) {
      this.measureGroup.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._measure.objects = [];
    this._measure.points = [];
    this._emit('measure', null);
  }

  /* ================= 参数化（@param 注释） ================= */

  /** 解析代码中的 @param 注释，返回 [{name,label,value,min,max,step}] */
  extractParams(code = this._code) {
    this._params = parseParams(code);
    return this._params;
  }

  getParams() { return this._params; }

  /** 修改某个参数的值并重新运行（基于最近一次执行的代码） */
  async setParam(name, value) {
    this._code = applyParamValue(this._code, name, value);
    return this.run(this._code);
  }

  /** 参数动画：在 [from, to] 区间内驱动某个参数 */
  animate({ param, from, to, duration = 2000, easing = 'linear' } = {}) {
    const easings = {
      linear: (t) => t,
      easeInOut: (t) => t * t * (3 - 2 * t),
    };
    const ease = easings[easing] || easings.linear;
    cancelAnimationFrame(this._animFrame);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / duration);
      const val = Math.round((from + (to - from) * ease(t)) * 100) / 100;
      this._code = applyParamValue(this._code, param, val);
      this.run(this._code).then(() => {
        if (t < 1) this._animFrame = requestAnimationFrame(step);
      });
    };
    step();
  }

  /* ================= 导出与下载 ================= */

  /**
   * 导出模型。格式：stl | stl-ascii | obj | glb | json | 3mf
   * @returns {Promise<Blob>}
   */
  async export(format = 'stl', opts = {}) {
    if (!this._parts.length) {
      throw new GeomError('没有可导出的模型', { code: 'NO_MODEL', recoverable: true, suggestion: '请先运行代码生成模型' });
    }
    const visible = this._parts.filter((p) => p.visible);
    const shapes = visible.map((p) => p.shape);
    let blob;
    switch (format) {
      case 'stl': blob = toSTLBinary(shapes); break;
      case 'stl-ascii': blob = toSTLAscii(shapes); break;
      case 'obj': blob = toOBJ(shapes); break;
      case 'json': blob = toModelJSON(shapes); break;
      case '3mf': blob = to3MF(visible.map((p) => ({ shape: p.shape, name: p.name, color: p.color }))); break;
      case 'gltf':
      case 'glb': blob = await this._exportGLB(); break;
      default:
        throw new GeomError(`不支持的导出格式: ${format}`, { code: 'BAD_FORMAT', recoverable: true });
    }
    this._emit('export', { blob, format });
    return blob;
  }

  _exportGLB() {
    return new Promise((resolve, reject) => {
      const group = new THREE.Group();
      for (const p of this._parts) {
        if (p.mesh.visible) group.add(p.mesh.clone());
      }
      new GLTFExporter().parse(
        group,
        (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
        (err) => reject(err),
        { binary: true },
      );
    });
  }

  /** 导出并触发浏览器下载，返回 { filename, blob }（错误向上抛出，由 UI 层提示） */
  async download(format = 'stl', filename = null) {
    const ext = { stl: 'stl', 'stl-ascii': 'stl', obj: 'obj', glb: 'glb', gltf: 'glb', json: 'json', '3mf': '3mf' }[format] || format;
    const blob = await this.export(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `3dmaker-model.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { filename: a.download, blob };
  }

  /** 序列化为 JSON 模型字符串 */
  toModelJSON() {
    return JSON.stringify({
      format: '3dmaker-model/1',
      parts: this._parts.map((p) => ({ name: p.name, ...p.shape.toJSON() })),
    });
  }

  /* ================= 其他 ================= */

  /** 清空场景，恢复默认视图 */
  reset() {
    this._setParts([]);
    this._clearMeasure();
    this._result = null;
    this.fitToView();
    this._emitStatus('ok', '就绪');
    this._emit('reset');
  }

  /** 安装插件：plugin.install(this) */
  use(plugin) {
    plugin?.install?.(this);
    return this;
  }

  /** 销毁实例，释放资源（不触碰任何 DOM，canvas 由宿主页面管理；worker 内核一并终止防泄漏） */
  dispose() {
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._animFrame);
    this._resizeObserver?.disconnect();
    this._clearMeasure();
    this._setParts([]);
    const kernel = this.options.kernel;
    if (kernel && kernel.worker) {
      try { kernel.dispose(); } catch (_) {}
      this.options.kernel = null;
    }
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this._onPointerDown);
      c.removeEventListener('pointerup', this._onPointerUp);
      c.removeEventListener('dblclick', this._onDblClick);
      c.removeEventListener('keydown', this._onKeyDown);
    }
    this.controls?.dispose();
    this.renderer?.dispose();
    this._initialized = false;
    this._listeners = {};
  }
}

/* ============================================================================
 * 导出（默认导出 Viewer；数据工具挂为静态属性，UI 层只需默认导入）
 * ========================================================================== */

Viewer.GeomError = GeomError;
Viewer.Shape = Shape;
Viewer.KERNEL_API = KERNEL_API;
Viewer.parseParams = parseParams;
Viewer.applyParamValue = applyParamValue;
Viewer.fmtInt = fmtInt;
Viewer.fmtVol = fmtVol;
Viewer.fmtArea = fmtArea;
Viewer.fmtLen = fmtLen;
Viewer.to3MF = to3MF;
Viewer.detectInterference = detectInterference;

export default Viewer;
export {
  GeomError, Shape, KERNEL_API,
  parseParams, applyParamValue,
  fmtInt, fmtVol, fmtArea, fmtLen, to3MF, detectInterference,
} from './kernel.js';
