// 管道三通接头
// @param mainD 主管外径 (mm) {min: 10, max: 100, step: 2}
const mainD = 40;
// @param wallT 壁厚 (mm) {min: 1, max: 10, step: 0.5}
const wallT = 4;
// @param mainLen 主管长度 (mm) {min: 30, max: 200, step: 5}
const mainLen = 100;
// @param branchLen 支管长度 (mm) {min: 20, max: 120, step: 5}
const branchLen = 60;

const rO = mainD / 2;
const rI = rO - wallT;

// 主管（沿 X 轴）与支管（沿 Z 轴）
const main = pipe(rO, rI, mainLen).rotateY(90);
const branch = pipe(rO, rI, branchLen + rO).translate(0, 0, (branchLen + rO) / 2 - rO);

return main.fuse(branch);
