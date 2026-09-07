/*
 * three.js — declarative 3D element renderer for the video/1 engine.
 *
 * Element: { type: "three", x, y, w, h, scene: { camera, lights, objects, group } }
 * renderThree(el, t) → dataURL (transparent PNG), synchronous & deterministic
 * per (element descriptor, t). One WebGL context is kept per element signature
 * and reused across frames; scene graph is rebuilt only when the descriptor
 * changes. Time-driven motion uses speeds in rad/sec (Remotion's per-frame
 * values × 30).
 *
 * Supported descriptor:
 *   scene.camera  { position:[x,y,z], fov }
 *   scene.lights  [{ type:'ambient'|'directional'|'point', intensity, position?, color? }]
 *   scene.group   { rotation:[rx,ry,rz] }                 // rad/s, whole-group spin
 *   scene.objects[]:
 *     { type:'torusKnot'|'icosahedron'|'sphere'|'box', args:[...],
 *       material:{ kind:'standard'|'basic', color, metalness, roughness,
 *                  wireframe, opacity, emissive?, emissiveIntensity? },
 *       rotation:[rx,ry,rz], scalePulse:{amp,speed}, position:[x,y,z], scale }
 *     { type:'orbiters', count, radius, speed, yWave:{freq,amp}, sizes:[s,s,s],
 *       colors:[c1,c2], emissiveIntensity }               // N orbiting spheres
 */

import * as THREE from "./vendor/three.module.js";

const cache = new Map(); // sig → { canvas, renderer, scene3, camera, group, anim, w, h }

function matOf(m = {}) {
  const common = {
    color: new THREE.Color(m.color || "#ffffff"),
    transparent: m.opacity != null && m.opacity < 1,
    opacity: m.opacity != null ? m.opacity : 1,
    wireframe: !!m.wireframe,
  };
  if (m.kind === "basic") return new THREE.MeshBasicMaterial(common);
  const mat = new THREE.MeshStandardMaterial({
    ...common,
    metalness: m.metalness != null ? m.metalness : 0.3,
    roughness: m.roughness != null ? m.roughness : 0.5,
  });
  if (m.emissive) {
    mat.emissive = new THREE.Color(m.emissive);
    mat.emissiveIntensity = m.emissiveIntensity != null ? m.emissiveIntensity : 1;
  }
  return mat;
}

function geoOf(o) {
  const a = o.args || [];
  if (o.type === "torusKnot") return new THREE.TorusKnotGeometry(...a);
  if (o.type === "icosahedron") return new THREE.IcosahedronGeometry(...a);
  if (o.type === "sphere") return new THREE.SphereGeometry(...a);
  if (o.type === "box") return new THREE.BoxGeometry(...a);
  // 自定义网格：src 引用资产 geo json（prepareGeo 预热）或内联 data
  if (o.type === "geo") {
    if (o.src && geoCache.has(o.src)) return geoCache.get(o.src);
    if (o.data) return buildGeoData(o.data);
    console.warn("[video three] geo 未就绪（src 未预热或缺 data）：", o.src);
    return new THREE.SphereGeometry(1, 8, 8);
  }
  // 参数曲面：eq = "(u,v)=>[x,y,z]"，默认 u/v ∈ [0, 2π]，segU/segV 采样密度
  if (o.type === "parametric") return buildParametric(o);
  return new THREE.SphereGeometry(1, 16, 16);
}

/* ---------------------------------- 自定义网格 geo / 参数曲面 parametric */

// src → BufferGeometry（prepareGeo 预热；引擎 prepare 时机保证导出/预览前就绪）
const geoCache = new Map();

/** geo json / 内联 data → BufferGeometry：{positions, uvs?, normals?, index?}（缺法线自动计算） */
function buildGeoData(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(d.positions || [], 3));
  if (d.uvs) g.setAttribute("uv", new THREE.Float32BufferAttribute(d.uvs, 2));
  if (d.normals) g.setAttribute("normal", new THREE.Float32BufferAttribute(d.normals, 3));
  if (d.index) g.setIndex(d.index);
  if (!d.normals) g.computeVertexNormals();
  return g;
}

/** 预热 geo 资产（engine.prepareThree 调用）：fetchText 由引擎经 assetMap 解析 dataURL。
 *  关键：成功加载后必须失效引用该 src 的场景签名缓存——预览首开时资产未就绪
 *  已烘担保底球进 sig 缓存，不失效就永远显示替补球。 */
export async function prepareGeo(srcs, fetchText) {
  const fresh = [];
  await Promise.all(
    (srcs || []).map(async (src) => {
      if (geoCache.has(src)) return;
      try {
        const d = JSON.parse(await fetchText(src));
        geoCache.set(src, buildGeoData(d));
        fresh.push(src);
      } catch (e) {
        console.warn("[video three] geo 加载失败：", src, e);
      }
    }),
  );
  // 失效引用新就绪 src 的场景缓存（sig 内含 scene JSON，必然含 src 字符串）
  if (fresh.length) {
    for (const [sig, ctx] of cache) {
      if (fresh.some((s) => sig.indexOf(s) >= 0)) {
        try { ctx.renderer.dispose(); } catch (e) {}
        cache.delete(sig);
      }
    }
  }
}

// 参数方程缓存（eq 字符串 → 编译后函数；new Function 软沙箱仅注入 Math）
const paramEqCache = new Map();
function paramFn(eq) {
  let fn = paramEqCache.get(eq);
  if (!fn) {
    fn = new Function("Math", '"use strict"; return (' + eq + ");")(Math);
    if (typeof fn !== "function") throw new Error("parametric eq 不是函数：" + eq);
    paramEqCache.set(eq, fn);
  }
  return fn;
}

/** 参数曲面采样：默认 u/v ∈ [0, 2π]，segU=48/segV=24；computeVertexNormals 自动法线 */
function buildParametric(o) {
  const fn = paramFn(o.eq || "(u,v)=>[Math.cos(u),Math.sin(u),0]");
  const u0 = o.u0 != null ? o.u0 : 0,
    u1 = o.u1 != null ? o.u1 : Math.PI * 2,
    v0 = o.v0 != null ? o.v0 : 0,
    v1 = o.v1 != null ? o.v1 : Math.PI * 2;
  const nu = Math.max(1, o.segU | 0 || 48),
    nv = Math.max(1, o.segV | 0 || 24);
  const positions = [],
    uvs = [],
    index = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = u0 + (u1 - u0) * (i / nu),
        v = v0 + (v1 - v0) * (j / nv);
      const p = fn(u, v);
      positions.push(p[0], p[1], p[2]);
      uvs.push(i / nu, j / nv);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        b = a + 1,
        c = a + nu + 1,
        d = c + 1;
      index.push(a, b, d, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function buildScene(desc, w, h) {
  const scene3 = new THREE.Scene();
  const cam = (desc.camera && desc.camera.position) || [0, 0, 7.6];
  const camera = new THREE.PerspectiveCamera(
    (desc.camera && desc.camera.fov) || 45, w / h, 0.1, 100);
  camera.position.set(cam[0], cam[1], cam[2]);

  (desc.lights || []).forEach((l) => {
    let light = null;
    if (l.type === "ambient") light = new THREE.AmbientLight(0xffffff, l.intensity != null ? l.intensity : 0.5);
    else if (l.type === "directional") light = new THREE.DirectionalLight(0xffffff, l.intensity != null ? l.intensity : 1);
    else if (l.type === "point") light = new THREE.PointLight(l.color || 0xffffff, l.intensity != null ? l.intensity : 10);
    if (!light) return;
    if (l.position) light.position.set(l.position[0], l.position[1], l.position[2]);
    scene3.add(light);
  });

  const group = new THREE.Group();
  scene3.add(group);
  const anim = [];
  (desc.objects || []).forEach((o) => {
    if (o.type === "orbiters") {
      const count = o.count || 8;
      const radius = o.radius || 3;
      for (let i = 0; i < count; i++) {
        const sz = (o.sizes && o.sizes[i % o.sizes.length]) || 0.12;
        const col = (o.colors && o.colors[i % o.colors.length]) || "#ffffff";
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(sz, 20, 20),
          matOf({ kind: "standard", color: col, emissive: col,
                  emissiveIntensity: o.emissiveIntensity != null ? o.emissiveIntensity : 0.55,
                  metalness: 0.2, roughness: 0.4 }),
        );
        group.add(mesh);
        anim.push({ kind: "orbiter", mesh, i, count, radius,
                    speed: o.speed || 0.9, yWave: o.yWave || { freq: 1.7, amp: 0.9 } });
      }
      return;
    }
    const mesh = new THREE.Mesh(geoOf(o), matOf(o.material));
    // 自定义网格/参数曲面（克莱因瓶等不可定向曲面）双面渲染，避免背面剔除破面
    if (o.type === "geo" || o.type === "parametric") mesh.material.side = THREE.DoubleSide;
    if (o.position) mesh.position.set(o.position[0], o.position[1], o.position[2]);
    if (o.scale != null) mesh.scale.setScalar(o.scale);
    group.add(mesh);
    if (o.rotation) anim.push({ kind: "rotate", mesh, speed: o.rotation });
    if (o.scalePulse) anim.push({ kind: "pulse", mesh, amp: o.scalePulse.amp || 0.05, speed: o.scalePulse.speed || 1.5 });
  });
  return { scene3, camera, group, anim, groupSpin: (desc.group && desc.group.rotation) || null };
}

/** Render one 3D element at scene-local t (seconds) → 渲染后的共享 canvas
 *  （每个元素签名缓存一份 WebGL 上下文；预览直接挂 DOM，导出由 render.js 合成）。 */
export function getThreeCanvas(el, t) {
  const w = Math.max(8, Math.round(el.w)), h = Math.max(8, Math.round(el.h));
  const sig = el.id + "|" + w + "x" + h + "|" + JSON.stringify(el.scene || {});
  let ctx = cache.get(sig);
  if (!ctx) {
    if (cache.size > 8) { // 防止多文档切换时上下文泄漏
      const first = cache.keys().next().value;
      const old = cache.get(first);
      old.renderer.dispose();
      cache.delete(first);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, preserveDrawingBuffer: false,
    });
    renderer.setClearColor(0x000000, 0);
    const built = buildScene(el.scene || {}, w, h);
    ctx = { canvas, renderer, ...built };
    cache.set(sig, ctx);
  }
  // 时间驱动（确定性：同一 t 恒同结果）
  if (ctx.groupSpin) {
    ctx.group.rotation.set(
      ctx.groupSpin[0] * t, ctx.groupSpin[1] * t, ctx.groupSpin[2] * t);
  }
  for (const a of ctx.anim) {
    if (a.kind === "rotate") {
      a.mesh.rotation.set(a.speed[0] * t, a.speed[1] * t, a.speed[2] * t);
    } else if (a.kind === "pulse") {
      a.mesh.scale.setScalar(1 + Math.sin(t * a.speed) * a.amp);
    } else if (a.kind === "orbiter") {
      const ang = t * a.speed + (a.i / a.count) * Math.PI * 2;
      a.mesh.position.set(
        Math.cos(ang) * a.radius,
        Math.sin(ang * a.yWave.freq + a.i) * a.yWave.amp,
        Math.sin(ang) * a.radius,
      );
    }
  }
  ctx.renderer.render(ctx.scene3, ctx.camera);
  return ctx.canvas;
}

/** Render one 3D element at scene-local t → PNG dataURL（透明背景）。 */
export function renderThree(el, t) {
  return getThreeCanvas(el, t).toDataURL("image/png");
}

/** Dispose all cached GL contexts (page unload / doc switch hygiene). */
export function disposeThree() {
  cache.forEach((c) => c.renderer.dispose());
  cache.clear();
}
