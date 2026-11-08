// ============================================================================
// 两级圆柱齿轮减速器（立式）—— 3D Maker 复杂装配体演示
// 高速级 18→54 齿，低速级 20→60 齿，总减速比 9:1
// 全部尺寸由模数/齿厚/壁厚推导，箱体、轴系、齿轮自动重新布局
// ============================================================================

// @param m 齿轮模数 (mm) {min: 1.5, max: 3, step: 0.25}
const m = 2;
// @param t1 高速级齿厚 (mm) {min: 12, max: 24, step: 2}
const t1 = 16;
// @param t2 低速级齿厚 (mm) {min: 16, max: 30, step: 2}
const t2 = 20;
// @param wall 箱体壁厚 (mm) {min: 4, max: 10, step: 1}
const wall = 6;

// ---------- 传动链参数 ----------
const z1 = 18, z2 = 54;   // 高速级齿数（减速比 3）
const z3 = 20, z4 = 60;   // 低速级齿数（减速比 3）
const x1 = 0;                       // 输入轴 x
const x2 = x1 + m * (z1 + z2) / 2;  // 中间轴 x = 中心距 72
const x3 = x2 + m * (z3 + z4) / 2;  // 输出轴 x = 152
const zc1 = 12 + 20 + t1 / 2;       // 高速级齿轮中心高 z = 40
const zc2 = zc1 + t1 / 2 + 14 + t2 / 2; // 低速级齿轮中心高 z = 72

// ---------- 箱体轮廓尺寸（按最大齿轮外径推导） ----------
const rTip2 = m * (z2 / 2 + 1);
const rTip4 = m * (z4 / 2 + 1);
const xMin = Math.min(x1 - m * (z1 / 2 + 1), x2 - rTip2, x3 - rTip4) - 8;
const xMax = Math.max(x1 + m * (z1 / 2 + 1), x2 + rTip2, x3 + rTip4) + 8;
const halfW = rTip4 + 8;
const cx = (xMin + xMax) / 2, L = xMax - xMin, W = halfW * 2;
const baseH = 12;
const topZ = zc2 + t2 / 2 + 14;     // 箱壁顶面 z = 96

// ---------- 工具函数 ----------
/** 阶梯轴：segs = [[半径, z起, z止], ...] */
function steppedShaft(segs) {
  let s = null;
  for (const [r, a, b] of segs) {
    const c = cylinder(r, b - a, 24).translate(0, 0, (a + b) / 2);
    s = s ? s.fuse(c) : c;
  }
  return s;
}
/** 带键槽孔的直齿轮（孔径比轴径大 0.4 避免共面） */
function makeGear(teeth, thick, boreR) {
  let g = sketchPolygon(gearProfile(teeth, m)).extrude(thick);
  g = g.cut(cylinder(boreR, thick + 2, 24));
  g = g.cut(box(boreR * 0.45, boreR, thick + 2).translate(boreR * 0.75, 0, 0)); // 键槽
  return g;
}

// ---------- 箱体 ----------
let housing = box(L, W, baseH).translate(cx, 0, baseH / 2);
// 四壁（外壳抽壳，顶面开口）
let walls = box(L, W, topZ - baseH).translate(cx, 0, (topZ + baseH) / 2)
  .cut(box(L - 2 * wall, W - 2 * wall, topZ - baseH).translate(cx, 0, (topZ + baseH) / 2 + wall));
housing = housing.fuse(walls);
// 顶沿法兰
housing = housing.fuse(
  box(L + 12, W + 12, 6).translate(cx, 0, topZ + 3)
    .cut(box(L - 2 * wall, W - 2 * wall, 10).translate(cx, 0, topZ + 3))
);
// 地脚 ×4 + M8 螺栓孔
for (const [fx, fy] of [[xMin - 10, 40], [xMin - 10, -40], [xMax + 10, 40], [xMax + 10, -40]]) {
  housing = housing.fuse(box(28, 26, baseH).translate(fx, fy, baseH / 2));
  housing = housing.cut(cylinder(4.5, baseH + 4, 20).translate(fx, fy, baseH / 2));
}
// 三处轴承沉孔（深 8）+ 通孔
for (const [bx, rb, rs] of [[x1, 11, 5.5], [x2, 13, 6.5], [x3, 15, 8.5]]) {
  housing = housing.cut(cylinder(rb, 8, 28).translate(bx, 0, 4));
  housing = housing.cut(cylinder(rs, baseH + 4, 24).translate(bx, 0, baseH / 2));
}
// 放油螺塞座（前壁底部）
housing = housing.fuse(cylinder(9, 8, 24).rotateX(90).translate(cx, halfW + 4, 20));
housing = housing.cut(cylinder(5, 20, 20).rotateX(90).translate(cx, halfW, 20));
// 外壁加强筋 ×4（前后壁各两条）
for (const [rx, front] of [[cx - 60, true], [cx + 60, true], [cx - 60, false], [cx + 60, false]]) {
  let rib = sketchPolygon([[0, 0], [24, 0], [0, 36]]).extrude(6);
  // 注意：extrude 为中心对齐（厚度 z ∈ ±3），位移需按半厚修正
  if (front) rib = rib.rotateX(90).translate(rx, halfW + 3, baseH);        // 前壁 y+
  else rib = rib.rotateX(-90).translate(rx, -halfW - 3, baseH + 36);       // 后壁 y-（镜像）
  housing = housing.fuse(rib);
}

// ---------- 轴系（阶梯轴，含齿轮定位肩） ----------
const shaft1 = steppedShaft([
  [4, 10, 20], [5, 20, topZ + 14], [7.5, zc1 - t1 / 2 - 4, zc1 - t1 / 2], [4, topZ + 14, topZ + 24],
]).translate(x1, 0, 0);
const shaft2 = steppedShaft([
  [5, 10, 20], [6, 20, topZ - 2], [9, zc1 - t1 / 2 - 4, zc1 - t1 / 2], [8, zc2 - t2 / 2 - 4, zc2 - t2 / 2],
]).translate(x2, 0, 0);
const shaft3 = steppedShaft([
  [6, 10, 20], [8, 20, topZ + 14], [11, zc2 - t2 / 2 - 4, zc2 - t2 / 2], [6, topZ + 14, topZ + 24],
]).translate(x3, 0, 0);

// ---------- 齿轮（大齿轮旋转半齿距，保证啮合相位） ----------
const pinion1 = makeGear(z1, t1, 5.4).translate(x1, 0, zc1);
const gear2 = makeGear(z2, t1, 6.4).rotateZ(180 / z2).translate(x2, 0, zc1);
const pinion3 = makeGear(z3, t2, 6.4).translate(x2, 0, zc2);
const gear4 = makeGear(z4, t2, 8.4).rotateZ(180 / z4).translate(x3, 0, zc2);

// ---------- 吊环 ×2（焊在顶沿法兰前后边框上，对角布置） ----------
// 顶沿内缘 y=±64、外缘 y=±76，边框中心线 y=±(halfW)
const eyes = torus(8, 2.5, 24, 12).rotateX(90).translate(cx - 55, halfW, topZ + 13)
  .fuse(torus(8, 2.5, 24, 12).rotateX(90).translate(cx + 55, -halfW, topZ + 13));

// ---------- 装配输出（9 个部件） ----------
return [
  { name: '箱体', shape: housing, color: '#8a94a6' },
  { name: '输入轴', shape: shaft1, color: '#c0c8d4' },
  { name: '中间轴', shape: shaft2, color: '#c0c8d4' },
  { name: '输出轴', shape: shaft3, color: '#c0c8d4' },
  { name: '高速小齿轮 z' + z1, shape: pinion1, color: '#d4a017' },
  { name: '高速大齿轮 z' + z2, shape: gear2, color: '#5b8fc9' },
  { name: '低速小齿轮 z' + z3, shape: pinion3, color: '#d4a017' },
  { name: '低速大齿轮 z' + z4, shape: gear4, color: '#5b8fc9' },
  { name: '吊环 ×2', shape: eyes, color: '#6b7280' },
];
