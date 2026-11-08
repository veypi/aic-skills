// 带圆角的 L 型安装支架（推荐 OCCT 内核获得真实 3D 圆角）
// @param width 底座宽 (mm) {min: 20, max: 120, step: 5}
const width = 50;
// @param depth 底座深 (mm) {min: 15, max: 80, step: 5}
const depth = 30;
// @param baseH 底座厚 (mm) {min: 3, max: 15, step: 1}
const baseH = 6;
// @param riserH 立板高 (mm) {min: 10, max: 80, step: 5}
const riserH = 30;
// @param filletR 圆角半径 (mm) {min: 0, max: 8, step: 0.5}
const filletR = 2;

const base = box(width, depth, baseH);
const riser = box(baseH, depth, riserH).translate(-(width - baseH) / 2, 0, riserH / 2 + baseH / 2);

let bracket = base.fuse(riser);

// 底座安装孔 ×2
for (const x of [-width / 6, width / 6]) {
  bracket = bracket.cut(cylinder(3, baseH * 3).translate(x, 0, 0));
}
// 立板孔
bracket = bracket.cut(cylinder(4, baseH * 3).rotateY(90).translate(0, 0, baseH / 2 + riserH * 0.6));

return filletR > 0 ? bracket.fillet(filletR) : bracket;
