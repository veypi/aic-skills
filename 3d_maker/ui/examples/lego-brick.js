// 乐高积木（真实尺寸兼容）
// @param studsX 长边凸点数 {min: 1, max: 8, step: 1}
const studsX = 4;
// @param studsZ 短边凸点数 {min: 1, max: 4, step: 1}
const studsZ = 2;
// @param height 砖块高度 (mm) {min: 3, max: 20, step: 0.2}
const height = 9.6;

const pitch = 8.0;      // 凸点间距
const studR = 2.4;      // 凸点半径
const studH = 1.8;      // 凸点高度
const wall = 1.2;       // 壁厚

const W = studsX * pitch - 0.2;
const D = studsZ * pitch - 0.2;

// 外壳抽壳
let brick = box(W, D, height).translate(0, 0, height / 2);
brick = brick.cut(box(W - wall * 2, D - wall * 2, height).translate(0, 0, height / 2 - 0.6));

// 凸点阵列
for (let i = 0; i < studsX; i++) {
  for (let j = 0; j < studsZ; j++) {
    const x = (i - (studsX - 1) / 2) * pitch;
    const y = (j - (studsZ - 1) / 2) * pitch;
    brick = brick.fuse(cylinder(studR, studH).translate(x, y, height + studH / 2));
  }
}
return brick;
