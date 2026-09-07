// 保时捷 911 精致模型 v5 - 高级配色 + 圆角精细化
// 115 个命名部件：车身/座舱/前脸/车尾/尾翼/侧面/车轮总成
// 技法：凹多边形车身轮廓（圆弧采样轮拱）+ 剖面拉伸 + intersect 裁剪 + both() 镜像装配

const BODY    = '#2f4d75';    // 深金属蓝
const ROOFBLK = '#191b1e';    // 钢琴黑(车顶/后视镜/尾翼/柱)
const GLASS   = '#15202b';    // 深色玻璃
const TIRE    = '#15161a';
const SPOKE   = '#4a4e54';    // 枪灰辐条
const LIPL    = '#c2c7cc';    // 银轮辋边
const CHROME  = '#d8dde2';
const RED     = '#d61f2c';
const DARK    = '#1b1d21';    // 哑光黑空力件
const EXH     = '#6f757c';
const PLATE   = '#e8e8e8';
const DISC    = '#8f959b';
const GOLD    = '#c8a24a';
const AMBER   = '#e8a33d';

const wheelR = 34, wheelCZ = 34, archR = 40, rocker = 22;
const fwx = -145, rwk = 145, bodyW = 176;

const parts = [];
function add(n, s, c) { parts.push({ name: n, shape: s, color: c }); }
function both(n, fn, c) { for (const s of [-1, 1]) add(n + (s < 0 ? '(左)' : '(右)'), fn(s), c); }

// ===== 车身主体(圆角) =====
let p = [];
p.push([-225, rocker]); p.push([-228, 38]); p.push([-220, 52]); p.push([-200, 60]);
p.push([-170, 66]); p.push([-130, 70]); p.push([-95, 72]); p.push([-40, 73]);
p.push([40, 74]); p.push([95, 76]); p.push([140, 78]); p.push([185, 76]);
p.push([215, 68]); p.push([226, 52]); p.push([228, 36]); p.push([224, rocker]);
// 轮拱凹口：在轮廓多边形上采样一段圆弧（圆心在轮心，半径 archR）
const dxA = Math.sqrt(archR * archR - (wheelCZ - rocker) * (wheelCZ - rocker));
const a0 = Math.atan2(rocker - wheelCZ, dxA), a1 = Math.PI - a0;
function arch(cx) {
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    p.push([cx + archR * Math.cos(a), wheelCZ + archR * Math.sin(a)]);
  }
}
arch(rwk); arch(fwx);
let bodyShape = sketchPolygon(p).extrude(bodyW).rotateX(90);
add('车身主体', bodyShape, BODY);

// ===== 轮拱包边 =====
function fender(wx, s) {
  const ring = pipe(41, 35, 26, 56).rotateX(90).translate(wx, s * 90, wheelCZ);
  const clip = box(120, 60, 100).translate(wx, s * 90, 72);
  return ring.intersect(clip);
}
both('前轮拱包边', s => fender(fwx, s), BODY);
both('后轮拱包边', s => fender(rwk, s), BODY);

// ===== 引擎盖 =====
add('引擎盖', box(112, 150, 4).rotateY(-10).translate(-162, 0, 69), BODY);
add('后引擎盖', box(58, 132, 4).rotateY(8).translate(176, 0, 73), BODY);
both('引擎盖中缝', s => box(95, 1.5, 1.5).rotateY(-10).translate(-165, s * 26, 70), DARK);
add('车标', cylinder(6, 2, 28).translate(-185, 0, 61), GOLD);

// ===== 座舱(黑色悬浮车顶) =====
let c = [];
c.push([-112, 70]); c.push([-70, 128]); c.push([24, 138]);
c.push([68, 132]); c.push([116, 88]); c.push([116, 70]); c.push([-112, 70]);
add('座舱玻璃', sketchPolygon(c).extrude(140).rotateX(90), GLASS);
add('车顶', box(128, 108, 10).translate(-4, 0, 135), ROOFBLK);
add('天窗', box(58, 78, 2).translate(-8, 0, 141), GLASS);
both('A柱', s => box(7, 7, 74).rotateY(37).translate(-86, s * 71, 100), ROOFBLK);
both('B柱', s => box(6, 4, 52).translate(2, s * 71, 98), ROOFBLK);
both('车顶纵梁', s => box(124, 7, 7).translate(-2, s * 56, 138), ROOFBLK);
both('腰线饰条', s => box(210, 2, 2).translate(-2, s * 71.5, 75), CHROME);
add('挡风下沿(牛栏)', box(8, 132, 4).translate(-112, 0, 72), DARK);
both('后窗饰条', s => box(2, 4, 40).rotateY(35).translate(112, s * 40, 100), CHROME);

// ===== 前脸 =====
add('前保险杠', box(12, 172, 20).translate(-223, 0, 30), BODY);
add('前唇', box(14, 168, 4).translate(-225, 0, 18), DARK);
both('前唇鳍片', s => box(10, 2, 9).translate(-226, s * 70, 23), DARK);
add('中央进气口', box(6, 70, 12).translate(-228, 0, 24), DARK);
both('侧进气口(前)', s => box(6, 30, 10).translate(-227, s * 62, 26), DARK);
both('大灯透镜', s => sphere(11, 40, 28).scale(1, 0.7, 0.9).translate(-163, s * 72, 72), CHROME);
both('大灯灯圈', s => torus(11, 1.6, 40, 16).translate(-163, s * 72, 66), CHROME);
both('大灯内组', s => sphere(5, 24, 16).translate(-163, s * 72, 73), GLASS);
both('日行灯', s => box(3, 16, 3).translate(-224, s * 40, 40), CHROME);
add('前牌照', box(3, 34, 10).translate(-229, 0, 34), PLATE);
both('雨刮', s => box(34, 1.5, 1.5).rotateZ(s * 8).translate(-118, s * 20, 73), DARK);
both('前翼子板百叶', s => {
  let g = null;
  for (let k = 0; k < 3; k++) {
    const sl = box(18, 9, 1.5).translate(-135, s * 78, 66 + k * 4);
    g = g ? g.fuse(sl) : sl;
  }
  return g;
}, DARK);
both('侧转向灯', s => box(8, 2, 4).translate(-118, s * 89, 60), AMBER);

// ===== 车尾 =====
add('后保险杠', box(12, 168, 18).translate(223, 0, 32), BODY);
add('尾灯(贯穿)', box(5, 150, 7).translate(225, 0, 64), RED);
both('尾灯端', s => box(6, 10, 13).translate(224, s * 72, 64), RED);
both('后反射器', s => box(3, 16, 4).translate(228, s * 55, 30), RED);
add('高位刹车灯', box(4, 60, 2).translate(200, 0, 82), RED);
add('后扩散器', box(10, 150, 12).translate(224, 0, 20), DARK);
for (const yy of [-45, -22, 0, 22, 45]) add('扩散器鳍片', box(8, 3, 12).translate(226, yy, 20), DARK);
both('排气管', s => pipe(6, 4, 16, 24).rotateY(90).translate(228, s * 30, 26), EXH);
add('后格栅', box(48, 110, 3).translate(178, 0, 77), DARK);
for (const xx of [164, 174, 184, 194]) add('格栅横条', box(2, 104, 2).translate(xx, 0, 79), CHROME);
add('后牌照', box(3, 36, 12).translate(228, 0, 42), PLATE);
both('侧进气口(后)', s => box(34, 2, 18).translate(75, s * 88.6, 50), DARK);
both('油箱盖', s => cylinder(5, 2, 24).rotateX(90).translate(120, s * 89, 64), CHROME);

// ===== 尾翼/天线(黑色) =====
add('尾翼', box(24, 150, 5).rotateY(-10).translate(205, 0, 88), ROOFBLK);
both('尾翼支架', s => box(7, 9, 16).translate(205, s * 45, 80), ROOFBLK);
add('鲨鱼鳍天线', box(16, 4, 12).rotateY(20).translate(48, 0, 146), ROOFBLK);

// ===== 侧面 =====
both('侧裙', s => box(150, 3, 7).translate(-2, s * 89, rocker + 2), DARK);
both('车门缝', s => box(1.5, 1, 46).translate(-15, s * 88.7, 52), DARK);
both('前翼子板缝', s => box(1.5, 1, 40).translate(-108, s * 88.7, 50), DARK);
both('车身腰线', s => box(280, 1.5, 1.5).translate(-10, s * 88.6, 64), CHROME);
both('门把手', s => box(15, 2, 3).translate(-25, s * 89.5, 72), CHROME);
both('后视镜壳', s => box(11, 4, 8).translate(-95, s * 88, 92), ROOFBLK);
both('后视镜支架', s => box(5, 12, 4).translate(-95, s * 80, 87), DARK);
both('后视镜镜片', s => box(2, 3.5, 7).translate(-96, s * 90.5, 92), GLASS);

// ===== 车轮(双色: 枪灰辐条+银轮辋边+金轮毂盖) =====
function wheel(cx, cy) {
  const tire = pipe(34, 25, 30, 64).rotateX(90);
  const lip = pipe(26, 22, 24, 48).rotateX(90);
  let sp = null;
  for (let i = 0; i < 10; i++) { const s = box(34, 7, 6).rotateY(i * 36); sp = sp ? sp.fuse(s) : s; }
  const hub = cylinder(8, 22, 32).rotateX(90);
  let spoke = sp.fuse(hub);
  for (let i = 0; i < 5; i++) {
    const a = i * 72 * Math.PI / 180;
    const lug = cylinder(1.6, 7, 12).rotateX(90).translate(13 * Math.cos(a), 12, 13 * Math.sin(a));
    spoke = spoke.fuse(lug);
  }
  const disc = cylinder(21, 5, 40).rotateX(90).translate(0, -7, 0).fuse(cylinder(9, 9, 24).rotateX(90).translate(0, -7, 0));
  const caliper = box(15, 9, 11).translate(0, -3, -16);
  const cap = cylinder(4, 4, 20).rotateX(90).translate(0, 14, 0);
  return {
    tire: tire.translate(cx, cy, wheelCZ), spoke: spoke.translate(cx, cy, wheelCZ),
    lip: lip.translate(cx, cy, wheelCZ), disc: disc.translate(cx, cy, wheelCZ),
    caliper: caliper.translate(cx, cy, wheelCZ), cap: cap.translate(cx, cy, wheelCZ),
  };
}
for (const [cx, cy] of [[fwx, -82], [fwx, 82], [rwk, -82], [rwk, 82]]) {
  const w = wheel(cx, cy);
  const fb = cx < 0 ? '前' : '后', sd = cy < 0 ? '左' : '右';
  add(fb + sd + '轮胎', w.tire, TIRE);
  add(fb + sd + '辐条', w.spoke, SPOKE);
  add(fb + sd + '轮辋边', w.lip, LIPL);
  add(fb + sd + '刹车盘', w.disc, DISC);
  add(fb + sd + '卡钳', w.caliper, RED);
  add(fb + sd + '轮毂盖', w.cap, GOLD);
}

return parts;
