/**
 * ============================================================================
 * relief.js —— 贴面浮雕 API（网格级实现，与几何内核无关）
 * ============================================================================
 *
 * 对任意 Shape（builtin / OCCT：均暴露 positions/indices 三角网格）做射线
 * 投影，生成贴合模型表面的闭合浮雕片（外表面 + 底面 + 侧壁），可直接
 * fuse 进主体 —— 等价于 Blender 脚本中 "射线投影 + Solidify" 的做法。
 *
 * 公开 API 两个（注入建模沙盒，与 box/loft/fuse 同级）：
 *   surfaceHit(shape, a, b, dir) -> {point, normal, distance} | null
 *   relief(shape, outline, opts) -> Shape（闭合实体浮雕片）
 *
 * 投影平面约定：dir 取三大轴向之一；outline / a,b 为投影平面的两个坐标：
 *   dir=[0,±1,0]（Y 轴） -> 坐标为 [x, z]
 *   dir=[0,0,±1]（Z 轴） -> 坐标为 [x, y]
 *   dir=[±1,0,0]（X 轴） -> 坐标为 [y, z]
 *
 * 顶点偏置方向：浮雕沿 -dir（从表面朝外凸起），底面沿 +dir 嵌入体内。
 */
import { Shape } from './kernel.js';

const FAR = 1e6;

/* ---------- 射线-三角形求交（Möller–Trumbore） ---------- */

function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}

/** 射线与网格求最近命中：origin + t*dir（dir 自动归一化） */
function rayMesh(shape, origin, dir) {
  const p = shape.positions, idx = shape.indices;
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl;
  let best = null;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const t = rayTri(
      origin[0], origin[1], origin[2], dx, dy, dz,
      p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2],
    );
    if (t === null) continue;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // 法线面向入射
    if (!best || t < best.distance) {
      best = {
        point: [origin[0] + dx * t, origin[1] + dy * t, origin[2] + dz * t],
        normal: [nx / nl, ny / nl, nz / nl],
        distance: t,
      };
    }
  }
  return best;
}

/* ---------- 投影平面 / 轴向工具 ---------- */

function axisOf(dir) {
  const d = Math.abs(dir[0]) > Math.abs(dir[1]) && Math.abs(dir[0]) > Math.abs(dir[2])
    ? 0 : Math.abs(dir[1]) > Math.abs(dir[2]) ? 1 : 2;
  const others = [0, 1, 2].filter((a) => a !== d);
  return { axis: d, u: others[0], v: others[1] };
}

/* ---------- 公开 API ---------- */

/**
 * 表面命中查询：从 shape 外部沿 -dir 方向发射线，返回最近命中点与法线。
 * dir 语义 = 贴片朝外方向（命中点处表面法线应与 dir 同向/相近）；
 * 射线从 +dir 侧外部射向 -dir（即命中 dir 朝外的那个面）。
 * @param {Shape} shape 目标几何体（builtin / OCCT）
 * @param {number} a 投影平面第一坐标（dir=Y → x；dir=Z → x；dir=X → y）
 * @param {number} b 投影平面第二坐标（dir=Y → z；dir=Z → y；dir=X → z）
 * @param {Array} dir 贴片外法向（轴对齐向量，如 [0, 1, 0]）
 * @returns {{point:number[], normal:number[], distance:number}|null} 未命中返回 null
 */
function surfaceHit(shape, a, b, dir = [0, 1, 0]) {
  if (!shape || !shape.positions || !shape.indices || !shape.indices.length) {
    throw new Error('surfaceHit: 需要有效的几何体（Shape）');
  }
  const { axis } = axisOf(dir);
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ud = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  // 起点取包围盒中心沿 +dir 方向外推 FAR，射线沿 -dir 射入（命中 dir 朝外的面）
  const p = shape.positions;
  let center = 0;
  for (let i = axis; i < p.length; i += 3) center += p[i];
  center /= (p.length / 3);
  const origin = [0, 0, 0];
  origin[axis] = center + ud[axis] * FAR;
  const { u, v } = axisOf(dir);
  origin[u] = a;
  origin[v] = b;
  return rayMesh(shape, origin, [-ud[0], -ud[1], -ud[2]]);
}

/**
 * 贴面浮雕：沿 dir 方向将闭合轮廓投影到 shape 表面，生成凸起 rise、
 * 嵌入 embed 的闭合浮雕片（外表面 + 底面 + 侧壁），可 fuse 进主体。
 * 内部用**当前内核的 loft** 构造（保证双内核语义一致，见 §13）；
 * @param {Function} loftFn 当前内核的 loft 实现（沙盒注入时的 base.loft）
 * @param {Shape} shape 目标几何体
 * @param {Array<Array<number>>} outline 轮廓点 [[a, b], ...]（≥3 点，闭合，顺序任意）
 * @param {object} [opts] { dir=[0,1,0], rise=0.6, embed=0.5, seg=0.8 }
 * @returns {Shape} 浮雕片（闭合实体，水密）
 */
function makeRelief(loftFn, shape, outline, opts = {}) {
  if (!Array.isArray(outline) || outline.length < 3) {
    throw new Error('relief: outline 至少需要 3 个点 [[a, b], ...]');
  }
  const dir = opts.dir || [0, 1, 0];
  const rise = opts.rise === undefined ? 0.6 : Number(opts.rise);
  const embed = opts.embed === undefined ? 0.5 : Number(opts.embed);
  const seg = opts.seg === undefined ? 0.8 : Number(opts.seg);

  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ud = [dir[0] / dl, dir[1] / dl, dir[2] / dl];

  // 1) 轮廓细分（防直弦穿曲率大的面），生成闭合环
  let pts = [];
  const nOutline = outline.length;
  for (let i = 0; i < nOutline; i++) {
    const x1 = outline[i][0], y1 = outline[i][1];
    const x2 = outline[(i + 1) % nOutline][0], y2 = outline[(i + 1) % nOutline][1];
    const d = Math.hypot(x2 - x1, y2 - y1);
    let n = 1;
    if (seg > 0 && d > seg) n = Math.max(2, Math.round(d / seg));
    for (let k = 0; k < n; k++) {
      pts.push([x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n]);
    }
  }
  if (pts.length < 3) throw new Error('relief: 细分后轮廓过小');

  // 2) 逐点投影到表面：外表面沿 -dir 凸起，底面沿 +dir 嵌入
  //    兜底：三角化台阶缝隙可能让射线穿过网格（miss），以小步长同心搜索最近命中
  const outer = [], inner = [];
  for (const [a, b] of pts) {
    let hit = surfaceHit(shape, a, b, ud);
    if (!hit) {
      outer_: {
        for (const step of [0.2, 0.5, 1.0, 1.8]) {
          for (let dxx = -1; dxx <= 1 && !hit; dxx++) {
            for (let dzz = -1; dzz <= 1; dzz++) {
              if (!dxx && !dzz) continue;
              hit = surfaceHit(shape, a + dxx * step, b + dzz * step, ud);
              if (hit) break outer_;
            }
          }
        }
      }
    }
    if (!hit) throw new Error(`relief: 轮廓点 (${a}, ${b}) 未命中表面（可能超出模型范围）`);
    outer.push([
      hit.point[0] - ud[0] * rise,
      hit.point[1] - ud[1] * rise,
      hit.point[2] - ud[2] * rise,
    ]);
    inner.push([
      hit.point[0] + ud[0] * embed,
      hit.point[1] + ud[1] * embed,
      hit.point[2] + ud[2] * embed,
    ]);
  }

  // 3) 用 loft（截面放样）构造闭合浮雕片：外环 → 内环，自动桥接 + 双端盖（水密语义经内核验证）
  return loftFn([outer, inner]);
}

/**
 * 绑定当前内核 API 的浮雕 API 集合（relief 内部走内核 loft，双内核语义一致）。
 * @param {object} api 当前沙盒 API（KERNEL_API 或 OCCT API）
 */
export function bindReliefApi(api) {
  const loftFn = (api && typeof api.loft === 'function') ? api.loft : null;
  return {
    surfaceHit,
    relief: (shape, outline, opts) => {
      if (!loftFn) throw new Error('relief: 当前内核缺少 loft（无法构造浮雕片）');
      return makeRelief(loftFn, shape, outline, opts);
    },
  };
}

export { surfaceHit };
