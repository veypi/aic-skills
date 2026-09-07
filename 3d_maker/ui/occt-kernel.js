/** occt-kernel.js — OpenCascade WASM adapter v2（opencascade.js@2.0.0-beta.533428a，CDN 加载 + Worker 编译 + IndexedDB 缓存 + 进度回调）
 *
 * 有机形态 API 镜像（阶段的 1，双内核语义一致 §13）：meshFromVerts/loft/sweep 经
 * BRepBuilderAPI_Sewing / BRepOffsetAPI_ThruSections / MakePipe(Shell) 重建 B-Rep；
 * subdivide/displace/smooth 是网格级操作，走「B-Rep→网格→builtin 变换→Sewing 重建」。
 *
 * v2 关键差异（与 1.1.1 对比，2026-09-06 实测踩坑修正）：
 *   - glue 为 ESM 工厂（opencascade.full.js，MODULARIZE），经跨源动态 import + new 工厂实例化；
 *   - 进度参数统一为 Message_ProgressRange（可无参构造；1.1.1 的 Handle_Message_ProgressIndicator 不可构造=绑定死区）；
 *   - 唯一构造+默认参数的类（Sewing/ThruSections 等）绑定为「主类全签名」，无 _1/_2 子类；
 *   - JS 侧类名/重载后缀与 1.1.1 一致（gp_Pnt_3/MakeCylinder_2/MakeFace_15 等，wasm 字符串表逐项核对）。
 *
 * 加载策略（整体运行在专用 Worker 中，见 occt-worker.js / occt-client.js——
 * 初始化（含 embind 注册 ~1.8s）与建模计算均不占主线程，页面全程零冻结）：
 *   - IndexedDB 两级缓存：支持 Module 序列化的浏览器（Firefox 等）存编译产物，二次访问免下载免编译；
 *     不支持的（Chrome）存 WASM 二进制，二次访问免下载；
 *   - 首次访问：WASM 二进制与 glue 均走 CDN（jsdmirror/jsdelivr/unpkg 多源回退，jsdelivr 有 20MB 单文件限制，wasm 49MB 时自动落回其它源）；
 *   - WASM 编译直接在 Worker 内 WebAssembly.compile（实测 49MB ~55ms）；
 *   - onProgress(pct, text) 汇报 0~100 进度与阶段说明（经 client 转发到页面进度条）；
 *   - 加载完成后 createOCCTKernel() 返回与内置内核 API 兼容的内核对象。
 */
const CDN_BASES = [
  // 多源回退：国内镜像优先 → 海外 → 兜底（verisim 同策略）；opencascade.js@2.0.0-beta 三源已验证可达
  "https://cdn.jsdmirror.com/npm/opencascade.js@2.0.0-beta.533428a/dist/",
  "https://cdn.jsdelivr.net/npm/opencascade.js@2.0.0-beta.533428a/dist/",
  "https://unpkg.com/opencascade.js@2.0.0-beta.533428a/dist/",
];

// 有机形态网格操作（builtin 侧纯网格实现，OCCT 侧复用其网格变换后再 Sewing 重建）
import { subdivide as _subdivideMesh, displace as _displaceMesh, smooth as _smoothMesh } from './kernel.js';
/** 本地缓存键（绑定内核版本，升级内核时改这里即可使旧缓存失效） */
const WASM_CACHE_KEY = "opencascade.js@2.0.0-beta.533428a";
let oc = null,
  _p = null;

import { _recTrace, _traceSuspend, _traceResume } from "./kernel.js";
let _occtUid = 0; // OCCTShape/OCCTSketch 追踪 uid（与内置 Shape 分表，同一 run 只用一种内核，不冲突）

/** IndexedDB 缓存：持久化已编译的 WebAssembly.Module，二次访问跳过下载与编译。
 *  WebAssembly.Module 支持结构化克隆（Chrome 74+ / Firefox 79+ / Safari 15+）；
 *  不支持的环境读写会静默失败，自动回退完整加载流程。 */
function _idbStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open("3dmaker-cache", 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains("wasm"))
        rq.result.createObjectStore("wasm");
    };
    rq.onsuccess = () => {
      const db = rq.result;
      try {
        const tx = db.transaction("wasm", mode);
        // 注意：put() 可能同步抛错（如 Chrome 拒绝序列化 WebAssembly.Module），必须捕获
        fn(tx.objectStore("wasm"));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("transaction aborted"));
        };
      } catch (e) {
        try {
          db.close();
        } catch (_) {}
        reject(e);
      }
    };
    rq.onerror = () => reject(rq.error);
  });
}
async function _cacheGet(key) {
  try {
    let out = null;
    await _idbStore("readonly", (st) => {
      const g = st.get(key);
      g.onsuccess = () => {
        out = g.result;
      };
    });
    return out || null;
  } catch (_) {
    return null;
  }
}
async function _cachePut(key, val) {
  try {
    await _idbStore("readwrite", (st) => st.put(val, key));
    return true;
  } catch (e) {
    // DataCloneError 是预期分支（Chrome 无法序列化 WebAssembly.Module），由调用方降级存二进制，不打警告
    if (!(e && e.name === "DataCloneError")) {
      console.warn("[OCCT] 写入本地缓存失败:", (e && e.message) || e);
    }
    return false;
  }
}

/** 带进度汇报的 fetch（按字节流统计） */
async function _fetchWithProgress(url, onBytes) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const total = Number(resp.headers.get("Content-Length")) || 0;
  if (!resp.body || !resp.body.getReader) {
    const buf = await resp.arrayBuffer();
    onBytes?.(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes?.(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf.buffer;
}

async function _initOCCT(cdnBase, onProgress) {
  console.log('[OCCT] adapter v2 — opencascade.js@2.0.0-beta.533428a');
  if (oc) {
    onProgress?.(100, "高性能解析器就绪");
    return oc;
  }
  if (_p) return _p;
  const bases = cdnBase ? [cdnBase] : CDN_BASES; // 显式指定则单源，否则按 CDN_BASES 顺序回退
  const ratio = (loaded, total) =>
    total > 0 ? Math.min(1, loaded / total) : 0.5;
  _p = (async () => {
    // 0. 检查 IndexedDB 两级缓存：
    //    L1 编译产物（WebAssembly.Module）→ 跳过下载 + 编译（Firefox 等支持序列化的浏览器）
    //    L2 WASM 二进制（ArrayBuffer）      → 跳过下载，仅 Worker 内编译（Chrome：Module 不可入库）
    let compiledModule = null;
    let cachedBinary = null;
    if (typeof indexedDB !== "undefined") {
      onProgress?.(0, "正在检查本地缓存…");
      const cached = await _cacheGet(WASM_CACHE_KEY);
      if (cached && cached.version === WASM_CACHE_KEY) {
        if (cached.module instanceof WebAssembly.Module) {
          compiledModule = cached.module;
          console.log("[OCCT] 命中 L1 缓存（编译产物），跳过下载与编译");
        } else if (
          cached.binary instanceof ArrayBuffer &&
          cached.binary.byteLength
        ) {
          cachedBinary = cached.binary;
          console.log("[OCCT] 命中 L2 缓存（二进制），跳过下载");
        }
      }
    }

    // 1. 下载 WASM 二进制（L1 已缓存编译产物或 L2 已缓存二进制时跳过）；glue 为 ESM 工厂（opencascade.full.js），经跨源 import 获取
    const glueStart = compiledModule ? 90 : 0;
    onProgress?.(glueStart, "正在加载高性能解析器…");
    // 源选择；glue 与 wasm 解耦（locateFile 显式返回本地 Blob URL，不依赖 glue 自身路径解析）
    let wasmBuf = null, lastErr = null;
    if (!compiledModule && !cachedBinary) {
      for (const b of bases) {
        try {
          wasmBuf = await _fetchWithProgress(
            b + "opencascade.full.wasm",
            (loaded, total) => {
              onProgress?.(
                5 + Math.round(ratio(loaded, total) * 85),
                "正在加载高性能解析器…",
              );
            },
          );
          break;
        } catch (e) {
          lastErr = e;
          console.warn("[OCCT] CDN 源失败，切换下一个:", b, (e && e.message) || e);
        }
      }
      if (!wasmBuf) {
        throw lastErr || new Error("OCCT 所有 CDN 源均不可用");
      }
    }

    // 2. 未命中 L1 缓存：获取 WASM 二进制（L2 缓存 → CDN）并编译
    //    本模块整体运行在专用 Worker 中（occt-worker.js），编译不卡页面，无需再嵌套 Worker。
    let wasmUrl = null;
    if (!compiledModule) {
      if (cachedBinary) {
        wasmBuf = cachedBinary;
        onProgress?.(90, "已从本地缓存读取高性能解析器…");
      }
      // 3. 直接编译（实测 49MB ~55ms）；失败回退胶水自带的实例化流程。
      try {
        onProgress?.(92, "正在编译高性能解析器…");
        compiledModule = await WebAssembly.compile(wasmBuf.slice(0)); // 传副本，保留原 buffer 供回退
        // 写缓存（仅首次下载时）：优先存编译产物；浏览器拒绝序列化 Module（Chrome）时退存二进制
        if (!cachedBinary) {
          const okFull = await _cachePut(WASM_CACHE_KEY, {
            version: WASM_CACHE_KEY,
            module: compiledModule,
            binary: wasmBuf.slice(0),
          });
          if (!okFull)
            await _cachePut(WASM_CACHE_KEY, {
              version: WASM_CACHE_KEY,
              binary: wasmBuf.slice(0),
            });
          console.log(
            "[OCCT] 已写入本地缓存:",
            okFull
              ? "L1 编译产物 + L2 二进制"
              : "L2 二进制（浏览器不支持 Module 入库）",
          );
        }
      } catch (e) {
        console.warn(
          "[OCCT] 预编译失败，将使用胶水默认实例化流程:",
          (e && e.message) || e,
        );
      }
      // 转本地 Blob 地址（仅胶水默认回退实例化路径需要）
      wasmUrl = URL.createObjectURL(
        new Blob([wasmBuf], { type: "application/wasm" }),
      );
    }
    const instantiateWasm = compiledModule
      ? (imports, receive) => {
          // 先试同步快路径（Worker 内无主线程尺寸限制）；被拒则回退异步 WebAssembly.instantiate：
          // 立即返回 {} + 完成后调 receive，语义与胶水自带的默认异步实例化路径等价——
          // 胶水所有 wasm 函数封装均为惰性 thunk，
          // 首次调用才经 Module["asm"] 解析（receiveInstance 已先行赋值），不会有时序问题。
          try {
            const inst = new WebAssembly.Instance(compiledModule, imports);
            receive(inst, compiledModule);
            return inst.exports;
          } catch (e) {
            WebAssembly.instantiate(compiledModule, imports).then(
              (inst) => receive(inst, compiledModule),
              (e2) => console.error("[OCCT] WASM 实例化失败:", e2),
            );
            return {};
          }
        }
      : undefined;

    // 4. 加载 glue（v2 为 ESM 工厂 opencascade.full.js）：跨源动态 import；失败回退 fetch + Blob URL import
    let factory = null;
    for (const b of bases) {
      try {
        const mod = await import(b + "opencascade.full.js");
        factory = mod.default || mod;
        break;
      } catch (e) {
        console.warn("[OCCT] glue 加载失败，切换下一个:", b, (e && e.message) || e);
      }
    }
    if (!factory) {
      // 跨源 import 被阻断时回退：fetch glue 文本 → Blob 模块（同源语义，且保持 CORS 要求）
      try {
        const buf = await _fetchWithProgress(bases[0] + "opencascade.full.js", () => {});
        const mod = await import(URL.createObjectURL(new Blob([buf], { type: "application/javascript" })));
        factory = mod.default || mod;
      } catch (e) {
        throw e;
      }
    }
    if (typeof factory !== "function") {
      throw new Error("occt glue 不是工厂函数?");
    }

    // 5. 实例化（有编译产物时主线程不再编译 WASM，无卡顿）
    onProgress?.(98, "正在初始化高性能解析器…");
    const overrides = Object.assign(
      // locateFile 让 glue 内部按需加载的文件（.worker.js 等）指向未知源：未知文件直接拒，只放行 wasm
      { locateFile: (p) => (p.endsWith(".wasm") ? wasmUrl || "" : p) },
      wasmUrl ? { wasmBinaryFile: wasmUrl } : {},
      instantiateWasm ? { instantiateWasm } : {},
    );
    const ocInst = await new factory(overrides);
    oc = ocInst;
    onProgress?.(100, "高性能解析器就绪");
    return oc;
  })();
  _p.catch(() => {
    _p = null;
  }); // 失败后允许下次重试
  return _p;
}

class OCCTShape {
  constructor(s, meta) {
    this.id = ++_occtUid;
    this._oc = s;
    this._meta = meta || null;
    this._warn = null;
    this._mesh = null;
  }

  _ensure() {
    if (this._mesh) return;
    try {
      new oc.BRepMesh_IncrementalMesh_2(this._oc, 1.0, 0, 0.5, 0);
      const pos = [],
        idx = [];
      let off = 0;
      const exp = new oc.TopExp_Explorer_2(
        this._oc,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (exp.More()) {
        const f = oc.TopoDS.Face_1(exp.Current());
        const loc = new oc.TopLoc_Location_1();
        const triFn = _fn(oc.BRep_Tool, 'Triangulation_1', 'Triangulation');
        let tris = null;
        // v2 绑定 (Face, Location, Poly_MeshPurpose) 3 参；旧形态 2 参/4 参一并探测
        try { tris = triFn(f, loc, 0).get(); } catch (_) {}
        if (!tris) { try { tris = triFn(f, loc).get(); } catch (_) {} }
        if (!tris) { try { tris = triFn(f, loc, 1, 1).get(); } catch (_) {} }
        if (tris) {
          const T = loc.Transformation();
          for (let i = 1, n = tris.NbNodes(); i <= n; i++) {
            const p = tris.Node(i);
            if (!p) continue;
            const tp = p.Transformed(T);
            pos.push(tp.X(), tp.Y(), tp.Z());
          }
          for (let i = 1, n = tris.NbTriangles(); i <= n; i++) {
            const t = tris.Triangle(i);
            if (!t) continue;
            idx.push(
              t.Value(1) - 1 + off,
              t.Value(2) - 1 + off,
              t.Value(3) - 1 + off,
            );
          }
          off += tris.NbNodes();
        }
        exp.Next();
      }
      this._mesh = {
        positions: new Float32Array(pos),
        indices: new Uint32Array(idx),
      };
    } catch (e) {
      console.warn("[OCCT] mesh failed:", e.message);
      this._mesh = {
        positions: new Float32Array([]),
        indices: new Uint32Array([]),
      };
    }
  }

  get positions() {
    this._ensure();
    return this._mesh.positions;
  }
  get indices() {
    this._ensure();
    return this._mesh.indices;
  }
  get vertexCount() {
    this._ensure();
    return this._mesh.positions.length / 3;
  }
  get triangleCount() {
    this._ensure();
    return this._mesh.indices.length / 3;
  }

  edgeCount() {
    try {
      let n = 0;
      const e = new oc.TopExp_Explorer_2(
        this._oc,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (e.More()) {
        n++;
        e.Next();
      }
      return n;
    } catch (_) {
      return 0;
    }
  }
  volume() {
    try {
      const p = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_2(this._oc, p, 1e-4, false, false);
      return p.Mass();
    } catch (_) {
      return 0;
    }
  }
  area() {
    try {
      const p = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_2(this._oc, p, 1e-4, false);
      return p.Mass();
    } catch (_) {
      return 0;
    }
  }
  /** 包围盒：基于三角化网格顶点计算（与渲染几何一致，规避 Bnd_Box 绑定的不稳定性） */
  bounds() {
    const p = this.positions;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min, max };
  }

  _xform(trsf) {
    try {
      const b = new oc.BRepBuilderAPI_Transform_2(this._oc, trsf, true);
      this._oc = b.Shape();
      this._mesh = null;
    } catch (_) {}
    return this;
  }
  translate(x, y, z) {
    x = x || 0;
    y = y || 0;
    z = z || 0;
    const t = new oc.gp_Trsf_1();
    t.SetTranslation_1(new oc.gp_Vec_4(x, y, z));
    const r = this._xform(t);
    _recTrace("translate", [x, y, z], { targetId: this.id, resultId: this.id });
    return r;
  }
  scale(x, y, z) {
    if (y === undefined) y = z = x;
    if (x !== y || y !== z) {
      const g = new oc.gp_GTrsf_1();
      g.SetValue(1, 1, x);
      g.SetValue(2, 2, y);
      g.SetValue(3, 3, z);
      const b = new oc.BRepBuilderAPI_GTransform_2(this._oc, g, true);
      this._oc = b.Shape();
      this._mesh = null;
      _recTrace("scale", [x, y, z], { targetId: this.id, resultId: this.id });
      return this;
    }
    const t = new oc.gp_Trsf_1();
    t.SetScale(new oc.gp_Pnt_3(0, 0, 0), x);
    const r = this._xform(t);
    _recTrace("scale", [x, y, z], { targetId: this.id, resultId: this.id });
    return r;
  }
  rotate(axis, deg) {
    const rad = (deg * Math.PI) / 180;
    const ax = new oc.gp_Ax1_2(
      new oc.gp_Pnt_3(0, 0, 0),
      new oc.gp_Dir_4(axis[0], axis[1], axis[2]),
    );
    const t = new oc.gp_Trsf_1();
    t.SetRotation_1(ax, rad);
    const r = this._xform(t);
    _recTrace("rotate", [axis, deg], { targetId: this.id, resultId: this.id });
    return r;
  }
  rotateX(d) {
    return this.rotate([1, 0, 0], d);
  }
  rotateY(d) {
    return this.rotate([0, 1, 0], d);
  }
  rotateZ(d) {
    return this.rotate([0, 0, 1], d);
  }

  _bool(o, op) {
    if (!o) throw new Error("not a shape");
    // 非 OCCT 几何（如 relief 产生的网格 Shape）：先经 mesh→B-Rep 重建再布尔
    if (!o._oc) {
      if (!o.positions || !o.indices || !o.indices.length) throw new Error("not a shape");
      o = _occtFromMesh(o.positions, o.indices, null);
    }
    let algo;
    const base =
      op === "fuse" ? oc.BRepAlgoAPI_Fuse_3 :
      op === "cut" ? oc.BRepAlgoAPI_Cut_3 :
      op === "common" ? oc.BRepAlgoAPI_Common_3 : null;
    if (!base) throw new Error("unknown:" + op);
    try {
      algo = new base(this._oc, o._oc, _progressRange());
    } catch (e) {
      console.warn("[OCCT] 布尔 3 参构造失败，回退 2 参:", (e && e.message) || e);
      algo = _pickCtor([() => new base(this._oc, o._oc)]);
    }
    if (!algo.IsDone()) throw new Error(op + " failed");
    const raw = new OCCTShape(algo.Shape(), null);
    return raw._unifySameDomain();
  }

  /** 布尔结果清理：合并共面/同邻域碎面。OCCT 布尔会产出大量微小面片，
   *  不做 UnifySameDomain 会在长链布尔中累积腐坏（面数爆炸/丢体）。
   *  v2 构建未绑定 BRepBuilderAPI_UnifySameDomain（C++ 里它只是底层工具类的薄封装），
   *  直接用 ShapeUpgrade_UnifySameDomain（实测：并排 box fuse 10 面→6 面，几何体积不变）。
   *  清理失败时保留原始结果（不降级为报错）。 */
  _unifySameDomain() {
    try {
      let u;
      try {
        u = new oc.ShapeUpgrade_UnifySameDomain_2(this._oc, true, true, false);
      } catch (_) {
        u = new oc.ShapeUpgrade_UnifySameDomain_1();
        u.Initialize(this._oc, true, true, false);
      }
      u.SetSafeInputMode(true); // 对齐 BRepBuilderAPI 封装的安全输入默认
      u.Build();
      const s = u.Shape();
      if (s) return new OCCTShape(s, null);
    } catch (e) {
      console.warn('[OCCT] 布尔结果清理失败（保留原始结果）:', (e && e.message) || e);
    }
    return this;
  }
  fuse(o) {
    const r = this._bool(o, "fuse");
    _recTrace("fuse", [], { targetId: this.id, argIds: [o && o.id], resultId: r.id });
    return r;
  }
  cut(o) {
    const r = this._bool(o, "cut");
    _recTrace("cut", [], { targetId: this.id, argIds: [o && o.id], resultId: r.id });
    return r;
  }
  intersect(o) {
    const r = this._bool(o, "common");
    _recTrace("intersect", [], { targetId: this.id, argIds: [o && o.id], resultId: r.id });
    return r;
  }

  fillet(radius) {
    radius = radius || 1;
    try {
      const mf = _pickCtor([
        () => new oc.BRepFilletAPI_MakeFillet(this._oc, oc.ChFi3d_FilletShape.ChFi3d_Rational),
        () => new oc.BRepFilletAPI_MakeFillet(this._oc),
      ]);
      const exp = new oc.TopExp_Explorer_2(
        this._oc,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (exp.More()) {
        mf.Add_2(radius, oc.TopoDS.Edge_1(exp.Current()));
        exp.Next();
      }
      mf.Build();
      if (mf.IsDone()) {
        const out = new OCCTShape(mf.Shape(), this._meta);
        _recTrace("fillet", [radius], { targetId: this.id, resultId: out.id });
        return out;
      }
    } catch (e) {
      console.warn("[OCCT] fillet failed:", e.message);
    }
    const r = new OCCTShape(this._oc, this._meta);
    r._warning = "fillet: OCCT 圆角操作失败（已保留原形状）";
    _recTrace("fillet", [radius], { targetId: this.id, resultId: r.id });
    return r;
  }

  /** 镜像：plane = 'XY' | 'XZ' | 'YZ'（过原点坐标平面）。gp_Trsf.SetMirror + _positive 校正方向 */
  mirror(plane = 'XY') {
    const p = String(plane).toUpperCase();
    const n = p === 'XY' ? [0, 0, 1] : p === 'XZ' ? [0, 1, 0] : p === 'YZ' ? [1, 0, 0] : null;
    if (!n) throw new Error('mirror: plane 只能是 XY / XZ / YZ');
    const t = new oc.gp_Trsf_1();
    t.SetMirror_3(new oc.gp_Ax2_3(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(n[0], n[1], n[2])));
    this._oc = _positive(new oc.BRepBuilderAPI_Transform_2(this._oc, t, true).Shape());
    this._mesh = null;
    _recTrace("mirror", [plane], { targetId: this.id, resultId: this.id });
    return this;
  }

  /* ---------- 阵列 ----------
   * 优先 TopoDS_Compound（保留 B-Rep，无布尔开销）；绑定不可用时回退 fuse 链。
   * mats: null（=本体）或 gp_Trsf。
   */
  _patternConcat(mats) {
    try {
      const comp = new oc.TopoDS_Compound();
      const builder = new oc.BRep_Builder();
      for (const t of mats) {
        const s = t ? new oc.BRepBuilderAPI_Transform_2(this._oc, t, true).Shape() : this._oc;
        builder.Add(comp, s);
      }
      return new OCCTShape(comp, null);
    } catch (e) {
      console.warn('[OCCT] compound 阵列不可用，回退 fuse 链:', e.message);
    }
    let acc = new OCCTShape(this._oc, null);
    for (const t of mats) {
      if (!t) continue;
      acc = acc.fuse(new OCCTShape(new oc.BRepBuilderAPI_Transform_2(this._oc, t, true).Shape(), null));
    }
    return acc;
  }

  /** 线性阵列：n 个等距副本（含原体），步进向量 (dx, dy, dz) */
  linearPattern(n = 2, dx = 0, dy = 0, dz = 0) {
    n = Math.max(1, Math.floor(n));
    const mats = [];
    for (let k = 0; k < n; k++) {
      if (k === 0) { mats.push(null); continue; }
      const t = new oc.gp_Trsf_1();
      t.SetTranslation_1(new oc.gp_Vec_4(k * dx, k * dy, k * dz));
      mats.push(t);
    }
    const out = this._patternConcat(mats);
    _recTrace("linearPattern", [n, dx, dy, dz], { targetId: this.id, resultId: out.id });
    return out;
  }

  /** 圆周阵列：轴过原点；axis = 'Z'/'X'/'Y'/[x,y,z]；angle 默认 360 均布，非 360 时步进 angle/(n-1) */
  circularPattern(n = 3, axis = 'Z', angle = 360) {
    n = Math.max(1, Math.floor(n));
    if (typeof axis === 'string') {
      const a = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[axis.toUpperCase()];
      if (!a) throw new Error('circularPattern: axis 只能是 X / Y / Z 或 [x,y,z] 向量');
      axis = a;
    }
    const step = n <= 1 ? 0 : (Math.abs(angle) >= 360 ? angle / n : angle / (n - 1));
    const mats = [];
    for (let k = 0; k < n; k++) {
      if (k === 0) { mats.push(null); continue; }
      const t = new oc.gp_Trsf_1();
      t.SetRotation_1(
        new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(axis[0], axis[1], axis[2])),
        (k * step * Math.PI) / 180,
      );
      mats.push(t);
    }
    const out = this._patternConcat(mats);
    _recTrace("circularPattern", [n, axis, angle], { targetId: this.id, resultId: out.id });
    return out;
  }

  /** 序列化为网格 JSON（兼容 JSON 模型导出） */
  toJSON() {
    return {
      positions: Array.from(this.positions),
      indices: Array.from(this.indices),
    };
  }

  /* ---------- 有机形态 API（阶段 1）---------- */

  /** 中点细分：网格化 → builtin 细分 → Sewing 重建（输出 B-Rep 与 builtin 语义一致） */
  subdivide(levels = 1) {
    const s = _subdivideMesh(this, levels);
    const out = _occtFromMesh(s.positions, s.indices, { kind: 'subdivide', params: { levels } });
    _recTrace('subdivide', [levels], { targetId: this.id, resultId: out.id });
    return out;
  }

  /** 顶点法线位移（噪声可复现） */
  displace(amp = 1, opts = {}) {
    const s = _displaceMesh(this, amp, opts);
    const out = _occtFromMesh(s.positions, s.indices, { kind: 'displace', params: { amp, ...opts } });
    _recTrace('displace', [amp, opts], { targetId: this.id, resultId: out.id });
    return out;
  }

  /** 拉普拉斯平滑 */
  smooth(iterations = 1) {
    const s = _smoothMesh(this, iterations);
    const out = _occtFromMesh(s.positions, s.indices, { kind: 'smooth', params: { iterations } });
    _recTrace('smooth', [iterations], { targetId: this.id, resultId: out.id });
    return out;
  }
}

/* ============================================================================
 * 有机形态 API（阶段 1）——B-Rep 重建工具
 * embind 重载号随 opencascade.js 构建变化：构造列表探测（_pickCtor）、
 * 方法名自适应（_fn），运行时不匹配时报明确错误（错误该暴露）。
 * ========================================================================== */

function _pickCtor(cands) {
  let lastErr = null;
  for (const f of cands) {
    try { return f(); } catch (e) { lastErr = e; }
  }
  throw new Error('occt: no compatible constructor: ' + (lastErr && lastErr.message));
}

function _fn(obj, ...names) {
  for (const n of names) {
    if (typeof obj[n] === 'function') return obj[n].bind(obj);
  }
  throw new Error('occt: unsupported method ' + names.join('/'));
}

/** opencascade.js v2 的进度参数统一为 Message_ProgressRange（多重载 ctor → 子类化命名 _1/_2，主类无 ctor），复用单例实例 */
let _progress = null;
function _progressRange() {
  if (!_progress) {
    const cands = [
      () => new oc.Message_ProgressRange_1(),
      () => new oc.Message_ProgressRange(),
    ];
    let lastErr = null;
    for (const c of cands) {
      try {
        _progress = c();
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!_progress) {
      throw new Error('occt: Message_ProgressRange 不可实例化: ' + (lastErr && lastErr.message));
    }
  }
  return _progress;
}

/** 闭合 3D 轮廓 → 闭合 wire（loft 截面 / sweep profile） */
function _occtWireFromClosed3D(pts) {
  const pg = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const p of pts) pg.Add_1(new oc.gp_Pnt_3(p[0], p[1], p[2]));
  pg.Close();
  return pg.Wire();
}

/** 开放 3D 路径 → 开放 wire（sweep 路径） */
function _occtWireFromPath3D(pts, closed) {
  const pg = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const p of pts) pg.Add_1(new oc.gp_Pnt_3(p[0], p[1], p[2]));
  const make = closed ? () => { pg.Close(); return pg.Wire(); } : () => pg.Wire();
  return make();
}

/**
 * 三角网格 → B-Rep：每三角形建 Face（MakePolygon→MakeFace）→ Sewing 缝合 →
 * 尝试 MakeSolid（闭合网格）；开放网格保留 Shell（供装饰/后续布尔按能力使用）。
 */
function _occtFromMesh(pos, idx, meta) {
  const tris = idx.length / 3;
  if (!tris) throw new Error('occt: empty mesh');
  if (tris > 20000) throw new Error(`occt: mesh too large for B-Rep rebuild (${tris} > 20000 triangles)`);
  const sewing = _pickCtor([
    () => new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, true),
    () => new oc.BRepBuilderAPI_Sewing_1(1e-6),
    () => new oc.BRepBuilderAPI_Sewing_2(1e-6, false),
    () => new oc.BRepBuilderAPI_Sewing_3(1e-6, false, false),
  ]);
  const add = _fn(sewing, 'Add_1', 'Add');
  for (let t = 0; t < tris; t++) {
    const pg = new oc.BRepBuilderAPI_MakePolygon_1();
    for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k] * 3;
      pg.Add_1(new oc.gp_Pnt_3(pos[vi], pos[vi + 1], pos[vi + 2]));
    }
    pg.Close();
    const face = new oc.BRepBuilderAPI_MakeFace_15(pg.Wire(), false).Face();
    add(face);
  }
  _fn(sewing, 'Perform_1', 'Perform')(_progressRange());
  let sewed = _fn(sewing, 'SewedShape')();
  let made = null;
  try {
    const ms = _pickCtor([
      () => new oc.BRepBuilderAPI_MakeSolid_3(sewed),
      () => new oc.BRepBuilderAPI_MakeSolid_2(sewed),
      () => new oc.BRepBuilderAPI_MakeSolid_6(sewed),
      () => new oc.BRepBuilderAPI_MakeSolid_1(),
    ]);
    made = _fn(ms, 'Solid_1', 'Solid')();
  } catch (_) {
    // 开放网格/缝合失败：保留 SewedShape（shell 或 compound）
    made = null;
  }
  return new OCCTShape(_positive(made || sewed), meta || null);
}

/** loft：截面放样（BRepOffsetAPI_ThruSections） */
function _loftOCCT(sections, opts = {}) {
  const secs = (sections || []).filter((s) => s && s.length >= 3);
  if (secs.length < 2) throw new Error('loft: 至少需要 2 个截面');
  const ts = _pickCtor([
    () => new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6),
    () => new oc.BRepOffsetAPI_ThruSections_1(true, false, 1e-6),
    () => new oc.BRepOffsetAPI_ThruSections_2(true, false),
    () => new oc.BRepOffsetAPI_ThruSections_3(true),
    () => new oc.BRepOffsetAPI_ThruSections_1(false, false, 1e-6),
  ]);
  const addWire = _fn(ts, 'AddWire_1', 'AddWire');
  for (const s of secs) addWire(_occtWireFromClosed3D(s));
  // v2 中 CheckCompatibility/Build 带默认参数（Message_ProgressRange），embind 全签名绑定；探测参数形态
  const compat = _fn(ts, 'CheckCompatibility_1', 'CheckCompatibility');
  try { compat(false); } catch (_) { try { compat(); } catch (_) {} }
  const build = _fn(ts, 'Build_1', 'Build');
  try { build(_progressRange()); } catch (_) { try { build(); } catch (_) {} }
  const shape = _fn(ts, 'Shape')();
  return new OCCTShape(_positive(shape), { kind: 'loft', params: { sections: secs.length } });
}

/** sweep：profile 沿 path 扫掠（MakePipeShell 优先，MakePipe 兜底） */
function _sweepOCCT(profile, path, opts = {}) {
  const prof = (profile || []).filter((p) => p && p.length >= 2);
  const pts = (path || []).filter((p) => p && p.length >= 3);
  if (prof.length < 3 || pts.length < 2) throw new Error('sweep: 需要 profile（≥3 点）与 path（≥2 点）');
  const profWire = _occtWireFromClosed3D(prof.map(([u, v]) => [u, v, 0]));
  const spine = _occtWireFromPath3D(pts, opts.closedPath);
  let shape = null;
  try {
    const ps = _pickCtor([
      () => new oc.BRepOffsetAPI_MakePipeShell(spine),
    ]);
    _fn(ps, 'Add_1', 'Add')(profWire);
    const build = _fn(ps, 'Build_1', 'Build');
    try { build(_progressRange()); } catch (_) { try { build(); } catch (_) {} }
    try { _fn(ps, 'MakeSolid')(); } catch (_) { /* 开放路径允许壳体 */ }
    shape = _fn(ps, 'Shape')();
  } catch (_) {
    const mp = _pickCtor([
      () => new oc.BRepOffsetAPI_MakePipe_1(spine, profWire),
      () => new oc.BRepOffsetAPI_MakePipe_2(spine, profWire),
    ]);
    shape = _fn(mp, 'Shape')();
  }
  return new OCCTShape(_positive(shape), { kind: 'sweep', params: { path: pts.length, closedPath: !!opts.closedPath } });
}

class OCCTSketch {
  constructor(points) {
    this.id = ++_occtUid;
    this.points = points;
    const pg = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [x, y] of points) pg.Add_1(new oc.gp_Pnt_3(x, y, 0));
    pg.Close();
    this._face = new oc.BRepBuilderAPI_MakeFace_15(pg.Wire(), false).Face();
  }
  extrude(h) {
    const prism = new oc.BRepPrimAPI_MakePrism_1(
      this._face,
      new oc.gp_Vec_4(0, 0, h),
      false,
      true,
    );
    // 与内置内核语义对齐：内置 extrudeProfile 沿 Z 居中拉伸（-h/2 ~ +h/2），
    // 而 MakePrism 从轮廓面向 +Z 拉伸 0~h，须补平移 -h/2，否则切换内核后模型整体错位。
    const t = new oc.gp_Trsf_1();
    t.SetTranslation_1(new oc.gp_Vec_4(0, 0, -h / 2));
    const moved = new oc.BRepBuilderAPI_Transform_2(
      prism.Shape(),
      t,
      true,
    ).Shape();
    const out = new OCCTShape(_positive(moved), {
      kind: "extrude",
      params: { profile: this.points, height: h },
    });
    _recTrace("extrude", [h], { targetId: this.id, resultId: out.id });
    return out;
  }
}

/** 方向校正：B-Rep 实体体积为负时翻转面法线（保证体积为正、渲染法线朝外） */
function _positive(shape) {
  try {
    const p = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, p, 1e-4, false, false);
    if (p.Mass() < 0) {
      const r = shape.Reversed();
      return r || shape;
    }
  } catch (_) {}
  return shape;
}

export async function createOCCTKernel(cdnBase, onProgress) {
  await _initOCCT(cdnBase, onProgress);
  const api = {
    box(w, d, h) {
      if (d === undefined) d = w;
      if (h === undefined) h = d;
      const s = new oc.BRepPrimAPI_MakeBox_2(w, d, h).Shape();
      const t = new oc.gp_Trsf_1();
      t.SetTranslation_1(new oc.gp_Vec_4(-w / 2, -d / 2, -h / 2));
      return new OCCTShape(
        new oc.BRepBuilderAPI_Transform_2(s, t, true).Shape(),
        { kind: "box", params: { w, d, h } },
      );
    },
    cylinder(r, h, _s) {
      r = r || 5;
      h = h || 10;
      const s = new oc.BRepPrimAPI_MakeCylinder_2(r, h, 2 * Math.PI).Shape();
      const t = new oc.gp_Trsf_1();
      t.SetTranslation_1(new oc.gp_Vec_4(0, 0, -h / 2));
      return new OCCTShape(
        new oc.BRepBuilderAPI_Transform_2(s, t, true).Shape(),
        { kind: "cylinder", params: { r, h } },
      );
    },
    cone(rB, rT, h, _s) {
      rB = rB || 5;
      rT = rT || 0;
      h = h || 10;
      const s = new oc.BRepPrimAPI_MakeCone_2(rB, rT, h, 2 * Math.PI).Shape();
      const t = new oc.gp_Trsf_1();
      t.SetTranslation_1(new oc.gp_Vec_4(0, 0, -h / 2));
      return new OCCTShape(
        new oc.BRepBuilderAPI_Transform_2(s, t, true).Shape(),
        { kind: "cone", params: { rBottom: rB, rTop: rT, h } },
      );
    },
    sphere(r, _s, _r) {
      r = r || 5;
      return new OCCTShape(
        new oc.BRepPrimAPI_MakeSphere_2(r, 2 * Math.PI).Shape(),
        { kind: "sphere", params: { r } },
      );
    },
    torus(R, r, _s, _t) {
      R = R || 8;
      r = r || 2;
      return new OCCTShape(
        new oc.BRepPrimAPI_MakeTorus_4(
          R,
          r,
          0,
          2 * Math.PI,
          2 * Math.PI,
        ).Shape(),
        { kind: "torus", params: { R, r } },
      );
    },
    pipe(rO, rI, h, _s) {
      rO = rO || 6;
      rI = rI || 4;
      h = h || 10;
      const o = new oc.BRepPrimAPI_MakeCylinder_2(rO, h, 2 * Math.PI).Shape();
      const i = new oc.BRepPrimAPI_MakeCylinder_2(
        rI,
        h + 2,
        2 * Math.PI,
      ).Shape();
      const c = new oc.BRepAlgoAPI_Cut_3(o, i);
      const t = new oc.gp_Trsf_1();
      t.SetTranslation_1(new oc.gp_Vec_4(0, 0, -h / 2));
      return new OCCTShape(
        new oc.BRepBuilderAPI_Transform_2(c.Shape(), t, true).Shape(),
        { kind: "pipe", params: { rOuter: rO, rInner: rI, h } },
      );
    },
    sketchRect(w, h) {
      w = w || 10;
      h = h || 10;
      const hw = w / 2,
        hh = h / 2;
      return new OCCTSketch([
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]);
    },
    sketchCircle(r, seg) {
      r = r || 5;
      seg = seg || 48;
      const pts = [];
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        pts.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      return new OCCTSketch(pts);
    },
    sketchRoundedRect(w, h, r, seg) {
      w = w || 10;
      h = h || 10;
      r = r || 2;
      seg = seg || 5;
      const hw = w / 2,
        hd = h / 2,
        pts = [];
      for (const [cx, cy, s] of [
        [hw - r, hd - r, 0],
        [-hw + r, hd - r, Math.PI / 2],
        [-hw + r, -hd + r, Math.PI],
        [hw - r, -hd + r, Math.PI * 1.5],
      ])
        for (let i = 0; i <= seg; i++) {
          const t = s + (i / seg) * (Math.PI / 2);
          pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        }
      return new OCCTSketch(pts);
    },
    sketchPolygon(pts) {
      return new OCCTSketch(pts);
    },
    revolve(profile, _s) {
      const pg = new oc.BRepBuilderAPI_MakePolygon_1();
      for (const [r, z] of profile) pg.Add_1(new oc.gp_Pnt_3(r, 0, z));
      const face = new oc.BRepBuilderAPI_MakeFace_15(pg.Wire(), false).Face();
      const axis = new oc.gp_Ax1_2(
        new oc.gp_Pnt_3(0, 0, 0),
        new oc.gp_Dir_4(0, 0, 1),
      );
      return new OCCTShape(
        _positive(
          new oc.BRepPrimAPI_MakeRevol_1(face, axis, 2 * Math.PI, false).Shape(),
        ),
        { kind: "revolve", params: { profile } },
      );
    },
    lathe: null,
    /* ---------- 有机形态 API（阶段 1，双内核语义一致 §13）---------- */

    // 网格顶点/面 → B-Rep（Sewing 重建；闭合网格自动 MakeSolid）
    meshFromVerts(verts, faces) {
      const flat = Array.isArray(verts[0]) ? verts.flat() : Array.from(verts);
      const idx = [];
      const nv = Math.floor(flat.length / 3);
      for (const tri of faces || []) {
        if (tri.length < 3) continue;
        const a = tri[0], b = tri[1], c = tri[2];
        if (a < 0 || b < 0 || c < 0 || a >= nv || b >= nv || c >= nv) continue;
        idx.push(a, b, c);
      }
      return _occtFromMesh(flat, idx, { kind: 'meshFromVerts' });
    },
    loft(sections, opts = {}) {
      return _loftOCCT(sections, opts);
    },
    sweep(profile, path, opts = {}) {
      return _sweepOCCT(profile, path, opts);
    },
    subdivide(shape, levels = 1) {
      return shape.subdivide(levels);
    },
    displace(shape, amp = 1, opts = {}) {
      return shape.displace(amp, opts);
    },
    smooth(shape, iterations = 1) {
      return shape.smooth(iterations);
    },
    hole(r, h, opts = {}) {
      _traceSuspend(); // 内部图元/布尔不单独记录
      try {
        r = r || 3;
        h = h || 10;
        const { cboreR = 0, cboreH = 0, csinkAngle = 0, csinkDepth = 0 } = opts || {};
        let tool = api.cylinder(r, h);
        if (cboreR > r && cboreH > 0) {
          tool = tool.fuse(api.cylinder(cboreR, cboreH).translate(0, 0, h / 2 - cboreH / 2));
        } else if (csinkAngle > 0 && csinkDepth > 0) {
          const rTop = r + csinkDepth / Math.tan(((csinkAngle / 2) * Math.PI) / 180);
          tool = tool.fuse(api.cone(r, rTop, csinkDepth).translate(0, 0, h / 2 - csinkDepth / 2));
        }
        return tool;
      } finally {
        _traceResume();
      }
    },
    gearProfile(teeth, mod) {
      teeth = teeth || 20;
      mod = mod || 2;
      const rP = (mod * teeth) / 2,
        rT = rP + mod,
        rR = Math.max(rP - 1.25 * mod, mod),
        ta = (Math.PI * 2) / teeth,
        pts = [];
      for (let t = 0; t < teeth; t++) {
        const a = t * ta;
        pts.push(
          [rR * Math.cos(a), rR * Math.sin(a)],
          [rR * Math.cos(a + 0.25 * ta), rR * Math.sin(a + 0.25 * ta)],
          [rT * Math.cos(a + 0.4 * ta), rT * Math.sin(a + 0.4 * ta)],
          [rT * Math.cos(a + 0.6 * ta), rT * Math.sin(a + 0.6 * ta)],
          [rR * Math.cos(a + 0.75 * ta), rR * Math.sin(a + 0.75 * ta)],
        );
      }
      return pts;
    },
    Sketch: OCCTSketch,
    Shape: OCCTShape,
    deg2rad: (d) => (d * Math.PI) / 180,
  };
  api.lathe = api.revolve;
  return api;
}
export { OCCTShape, OCCTSketch, _initOCCT };
export default { createOCCTKernel, OCCTShape, OCCTSketch };
