// 参数化直齿轮（简化梯形齿形）
// @param teeth 齿数 {min: 8, max: 60, step: 1}
const teeth = 20;
// @param module 模数 (mm) {min: 1, max: 6, step: 0.5}
const module = 2;
// @param thickness 厚度 (mm) {min: 3, max: 30, step: 1}
const thickness = 10;
// @param boreR 中心孔半径 (mm) {min: 0, max: 15, step: 0.5}
const boreR = 5;

let gear = sketchPolygon(gearProfile(teeth, module)).extrude(thickness);
if (boreR > 0) {
  gear = gear.cut(cylinder(boreR, thickness + 2, 32));
}
// 键槽
gear = gear.cut(box(boreR * 0.5, boreR, thickness + 2).translate(boreR * 0.8, 0, 0));
return gear;
