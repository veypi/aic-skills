// 有机花瓶 v1 —— 阶段 1 有机形态演示（loft 放样 + displace 有机纹理 + subdivide）
// 双内核语义一致：builtin / OCCT 下均应产生相同几何（§13）
// @param seed 噪声种子 {min: 1, max: 20, step: 1}
const seed = 5;
// @param amp 凹凸幅度 (mm) {min: 0, max: 4, step: 0.2}
const amp = 1.2;

// 花瓶截面：半径随高度变化的闭合环（每环 24 点）
const ring = (z, r) => {
  const p = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    p.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return p;
};

// 从口到底部放样（下大上小 + 收腰），花瓶轮廓
let vase = loft([
  ring(0, 16),
  ring(8, 14),
  ring(14, 9),
  ring(22, 7),
  ring(30, 11),
  ring(36, 12),
]);

// 有机纹理：细分两轮后沿法线位移（可复现噪声）
vase = subdivide(vase, 2);
vase = displace(vase, amp, { freq: 0.35, seed });

return [
  { name: '花瓶', shape: vase, color: '#7a9cc6' },
];
