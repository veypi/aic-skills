// ============================================================
// 超高保真科幻人形机器人 - 220+ 部件 (无布尔运算优化版)
// 所有部件均为独立图元，确保快速渲染
// ============================================================

// === 调色板 ===
const ARMOR = "#4a5568";
const ARMOR_D = "#2d3748";
const ARMOR_L = "#718096";
const CHROME = "#c0c8d0";
const DARK = "#1a202c";
const GLOW = "#00d4ff";
const GLOW_W = "#ff6b35";
const GLOW_R = "#ff2d55";
const JOINT = "#3d4451";
const RUBBER = "#22252a";
const GOLD = "#d4a843";
const GREEN = "#48bb78";
const WHITE = "#e8ecf0";

const parts = [];
function add(n, s, c) {
  parts.push({ name: n, shape: s, color: c });
}

// ============================================================
// 头部 (~32部件)
// ============================================================
const hZ = 185;
add("头骨", box(28, 26, 30).translate(0, 0, hZ), ARMOR);
add("头顶装甲", box(24, 22, 4).translate(0, 0, hZ + 16), ARMOR_D);
add("头顶散热片1", box(18, 1.5, 2).translate(0, 0, hZ + 14), DARK);
add("头顶散热片2", box(18, 1.5, 2).translate(0, 0, hZ + 11), DARK);
add("头顶散热片3", box(18, 1.5, 2).translate(0, 0, hZ + 8), DARK);
add("面罩框架", box(26, 4, 22).translate(0, -14, hZ + 2), ARMOR_D);
add("眼部护罩", box(24, 3, 10).translate(0, -14, hZ + 5), DARK);
add(
  "眼睛(左)",
  sphere(3.5, 16, 12)
    .scale(1.6, 0.8, 0.8)
    .translate(-7, -15, hZ + 5),
  GLOW,
);
add(
  "眼睛(右)",
  sphere(3.5, 16, 12)
    .scale(1.6, 0.8, 0.8)
    .translate(7, -15, hZ + 5),
  GLOW,
);
add(
  "眉甲(左)",
  box(10, 3, 3)
    .rotateX(-10)
    .translate(-7, -13.5, hZ + 9),
  ARMOR_D,
);
add(
  "眉甲(右)",
  box(10, 3, 3)
    .rotateX(-10)
    .translate(7, -13.5, hZ + 9),
  ARMOR_D,
);
add("下颚", box(20, 12, 10).translate(0, -10, hZ - 10), ARMOR_L);
add("嘴部格栅1", box(14, 1, 1.2).translate(0, -11, hZ - 8), DARK);
add("嘴部格栅2", box(14, 1, 1.2).translate(0, -11, hZ - 5.5), DARK);
add("嘴部格栅3", box(14, 1, 1.2).translate(0, -11, hZ - 3), DARK);
add("嘴部格栅4", box(14, 1, 1.2).translate(0, -11, hZ - 0.5), DARK);
add("侧脸装甲(左)", box(4, 18, 20).translate(-15, 0, hZ + 2), ARMOR);
add("侧脸装甲(右)", box(4, 18, 20).translate(15, 0, hZ + 2), ARMOR);
add(
  "耳部传感器(左)",
  cylinder(5, 6, 16)
    .rotateX(90)
    .translate(-17, 0, hZ + 4),
  ARMOR_D,
);
add(
  "耳部传感器(右)",
  cylinder(5, 6, 16)
    .rotateX(90)
    .translate(17, 0, hZ + 4),
  ARMOR_D,
);
add(
  "耳传感器盖(左)",
  cylinder(3, 2, 16)
    .rotateX(90)
    .translate(-18.5, 0, hZ + 4),
  GLOW,
);
add(
  "耳传感器盖(右)",
  cylinder(3, 2, 16)
    .rotateX(90)
    .translate(18.5, 0, hZ + 4),
  GLOW,
);
add("天线(左)", cylinder(1, 18, 8).translate(-12, -2, hZ + 24), CHROME);
add("天线(右)", cylinder(1, 18, 8).translate(12, -2, hZ + 24), CHROME);
add("天线尖端(左)", sphere(2, 12, 8).translate(-12, -2, hZ + 34), GLOW_R);
add("天线尖端(右)", sphere(2, 12, 8).translate(12, -2, hZ + 34), GLOW_R);
add("后脑散热板", box(20, 4, 16).translate(0, 14, hZ + 2), DARK);
add("后脑散热鳍1", box(16, 1.5, 12).translate(0, 13, hZ + 6), ARMOR_L);
add("后脑散热鳍2", box(16, 1.5, 12).translate(0, 13, hZ + 2), ARMOR_L);
add("后脑散热鳍3", box(16, 1.5, 12).translate(0, 13, hZ - 2), ARMOR_L);
add("后脑散热鳍4", box(16, 1.5, 12).translate(0, 13, hZ - 6), ARMOR_L);
add(
  "额头主传感器",
  cylinder(2.5, 3, 12)
    .rotateX(90)
    .translate(0, -14, hZ + 12),
  GLOW,
);
add("下巴指示灯", box(6, 1.5, 2).translate(0, -14, hZ - 12), GREEN);

// ============================================================
// 颈部 (6部件)
// ============================================================
const nZ = 165;
add("颈部主轴", cylinder(8, 16, 16).translate(0, 0, nZ), JOINT);
add("颈部护甲前", box(18, 6, 14).translate(0, -10, nZ), ARMOR);
add("颈部护甲后", box(18, 6, 14).translate(0, 10, nZ), ARMOR);
add("颈部液压管(左)", cylinder(2, 14, 8).translate(-7, 4, nZ), CHROME);
add("颈部液压管(右)", cylinder(2, 14, 8).translate(7, 4, nZ), CHROME);
add("颈部关节环", torus(9, 2, 24, 12).translate(0, 0, nZ + 6), JOINT);

// ============================================================
// 躯干 (~42部件)
// ============================================================
const cZ = 130;
add("胸甲主体", box(52, 32, 50).translate(0, 0, cZ), ARMOR);
add("胸部上装甲", box(48, 28, 6).translate(0, 0, cZ + 26), ARMOR_D);
add(
  "核心反应堆外壳",
  cylinder(10, 8, 24)
    .rotateX(90)
    .translate(0, -17, cZ + 5),
  CHROME,
);
add(
  "核心反应堆发光体",
  cylinder(7, 4, 24)
    .rotateX(90)
    .translate(0, -18, cZ + 5),
  GLOW,
);
add(
  "核心反应堆环",
  torus(10, 1.5, 24, 12)
    .rotateX(90)
    .translate(0, -17, cZ + 5),
  GOLD,
);
add("胸甲分割线(左)", box(1, 26, 44).translate(-12, 0, cZ + 2), DARK);
add("胸甲分割线(右)", box(1, 26, 44).translate(12, 0, cZ + 2), DARK);
// 胸部通风格栅(左) 5片
add("左通风格栅1", box(12, 1.5, 3).translate(-18, -14, cZ + 15), DARK);
add("左通风格栅2", box(12, 1.5, 3).translate(-18, -14, cZ + 11), DARK);
add("左通风格栅3", box(12, 1.5, 3).translate(-18, -14, cZ + 7), DARK);
add("左通风格栅4", box(12, 1.5, 3).translate(-18, -14, cZ + 3), DARK);
add("左通风格栅5", box(12, 1.5, 3).translate(-18, -14, cZ - 1), DARK);
add("右通风格栅1", box(12, 1.5, 3).translate(18, -14, cZ + 15), DARK);
add("右通风格栅2", box(12, 1.5, 3).translate(18, -14, cZ + 11), DARK);
add("右通风格栅3", box(12, 1.5, 3).translate(18, -14, cZ + 7), DARK);
add("右通风格栅4", box(12, 1.5, 3).translate(18, -14, cZ + 3), DARK);
add("右通风格栅5", box(12, 1.5, 3).translate(18, -14, cZ - 1), DARK);
add(
  "锁骨装甲(左)",
  box(20, 14, 8)
    .rotateZ(-15)
    .translate(-22, 0, cZ + 24),
  ARMOR_L,
);
add(
  "锁骨装甲(右)",
  box(20, 14, 8)
    .rotateZ(15)
    .translate(22, 0, cZ + 24),
  ARMOR_L,
);
// 腹部
const aZ = 95;
add("腹部主体", box(40, 26, 30).translate(0, 0, aZ), ARMOR_D);
add("腹肌装甲板1", box(32, 20, 4).translate(0, 0, aZ + 10), ARMOR);
add("腹肌装甲板2", box(32, 20, 4).translate(0, 0, aZ), ARMOR);
add("腹肌装甲板3", box(32, 20, 4).translate(0, 0, aZ - 10), ARMOR);
add("腹部中线", box(2, 22, 26).translate(0, 0, aZ), DARK);
// 腰部
const wZ = 76;
add("腰部主体", box(44, 28, 12).translate(0, 0, wZ), JOINT);
add("腰部前装甲", box(36, 8, 10).translate(0, -12, wZ), ARMOR);
add("腰部侧装甲(左)", box(8, 24, 10).translate(-24, 0, wZ), ARMOR_D);
add("腰部侧装甲(右)", box(8, 24, 10).translate(24, 0, wZ), ARMOR_D);
// 背部
add("背部装甲", box(48, 6, 44).translate(0, 18, cZ + 2), ARMOR_D);
add("脊柱护甲1", box(10, 5, 6).translate(0, 19, cZ + 18), ARMOR_L);
add("脊柱护甲2", box(10, 5, 6).translate(0, 19, cZ + 8), ARMOR_L);
add("脊柱护甲3", box(10, 5, 6).translate(0, 19, cZ - 2), ARMOR_L);
add("脊柱护甲4", box(10, 5, 6).translate(0, 19, cZ - 12), ARMOR_L);
add("脊柱护甲5", box(10, 5, 6).translate(0, 19, cZ - 22), ARMOR_L);
add("背部散热口1", box(30, 2, 4).translate(0, 20, cZ + 12), DARK);
add("背部散热口2", box(30, 2, 4).translate(0, 20, cZ + 4), DARK);
add("背部散热口3", box(30, 2, 4).translate(0, 20, cZ - 4), DARK);

// === 背包/推进器 (~12部件) ===
add("背包主体", box(30, 14, 36).translate(0, 26, cZ + 5), ARMOR_D);
add("背包顶盖", box(26, 12, 4).translate(0, 26, cZ + 24), ARMOR);
add("主推进器(左)", pipe(7, 5, 20, 20).translate(-9, 30, cZ - 3), CHROME);
add("主推进器(右)", pipe(7, 5, 20, 20).translate(9, 30, cZ - 3), CHROME);
add(
  "推进器喷口(左)",
  cone(8, 5, 6, 20)
    .rotateX(180)
    .translate(-9, 30, cZ - 14),
  ARMOR_D,
);
add(
  "推进器喷口(右)",
  cone(8, 5, 6, 20)
    .rotateX(180)
    .translate(9, 30, cZ - 14),
  ARMOR_D,
);
add("推进器发光(左)", cylinder(4, 2, 16).translate(-9, 30, cZ - 11), GLOW_W);
add("推进器发光(右)", cylinder(4, 2, 16).translate(9, 30, cZ - 11), GLOW_W);
add("侧推进器(左)", pipe(4, 3, 12, 16).translate(-16, 28, cZ - 1), CHROME);
add("侧推进器(右)", pipe(4, 3, 12, 16).translate(16, 28, cZ - 1), CHROME);
add("背包天线", cylinder(1, 24, 8).translate(0, 30, cZ + 27), CHROME);
add("背包天线尖端", sphere(2.5, 12, 8).translate(0, 30, cZ + 40), GLOW_R);

// ============================================================
// 手臂 (每侧 ~30部件，共60)
// ============================================================
function makeArm(s) {
  const t = s < 0 ? "左" : "右";
  const shX = s * 36,
    shZ = cZ + 18;
  // 肩甲
  add(t + "肩甲主体", box(22, 22, 16).translate(shX, 0, shZ), ARMOR);
  add(t + "肩甲上板", box(24, 24, 4).translate(shX, 0, shZ + 9), ARMOR_L);
  add(t + "肩甲侧板", box(4, 24, 14).translate(shX + s * 12, 0, shZ), ARMOR_D);
  add(t + "肩关节", sphere(8, 16, 12).translate(shX, 0, shZ - 10), JOINT);
  add(
    t + "肩部铆钉1",
    cylinder(1.5, 3, 8).translate(shX - 8, -8, shZ + 9),
    CHROME,
  );
  add(
    t + "肩部铆钉2",
    cylinder(1.5, 3, 8).translate(shX + 8, -8, shZ + 9),
    CHROME,
  );
  add(
    t + "肩部铆钉3",
    cylinder(1.5, 3, 8).translate(shX - 8, 8, shZ + 9),
    CHROME,
  );
  add(
    t + "肩部铆钉4",
    cylinder(1.5, 3, 8).translate(shX + 8, 8, shZ + 9),
    CHROME,
  );
  // 上臂
  const uaZ = shZ - 28;
  add(t + "上臂主体", box(14, 14, 28).translate(shX + s * 2, 0, uaZ), ARMOR);
  add(
    t + "上臂前装甲",
    box(12, 4, 22).translate(shX + s * 2, -8, uaZ),
    ARMOR_L,
  );
  add(
    t + "上臂液压管",
    cylinder(2, 24, 8).translate(shX + s * 2 + s * 5, 4, uaZ),
    CHROME,
  );
  add(
    t + "上臂指示灯",
    box(3, 1.5, 6).translate(shX + s * 2, -8, uaZ + 4),
    GLOW,
  );
  // 肘关节
  const elZ = uaZ - 18;
  add(
    t + "肘关节外壳",
    cylinder(7, 10, 16)
      .rotateY(90)
      .translate(shX + s * 2, 0, elZ),
    JOINT,
  );
  add(
    t + "肘关节盖",
    cylinder(5, 2, 16)
      .rotateY(90)
      .translate(shX + s * 2 + s * 6, 0, elZ),
    ARMOR_D,
  );
  add(
    t + "肘部护甲",
    box(10, 12, 8).translate(shX + s * 2, -6, elZ - 2),
    ARMOR,
  );
  // 前臂
  const faZ = elZ - 22;
  add(t + "前臂主体", box(13, 13, 30).translate(shX + s * 2, 0, faZ), ARMOR);
  add(
    t + "前臂上装甲",
    box(15, 15, 8).translate(shX + s * 2, 0, faZ + 8),
    ARMOR_D,
  );
  add(
    t + "前臂下装甲",
    box(15, 15, 8).translate(shX + s * 2, 0, faZ - 8),
    ARMOR_D,
  );
  add(
    t + "前臂能量条",
    box(2, 1.5, 20).translate(shX + s * 2, -7.5, faZ),
    GLOW,
  );
  add(
    t + "前臂管线A",
    cylinder(1.5, 26, 8).translate(shX + s * 2 + s * 4, 5, faZ),
    RUBBER,
  );
  add(
    t + "前臂管线B",
    cylinder(1.5, 26, 8).translate(shX + s * 2 + s * 4, -3, faZ),
    RUBBER,
  );
  // 腕关节
  const wrZ = faZ - 19;
  add(
    t + "腕关节",
    cylinder(6, 8, 16)
      .rotateY(90)
      .translate(shX + s * 2, 0, wrZ),
    JOINT,
  );
  add(
    t + "腕部护甲",
    box(12, 12, 5).translate(shX + s * 2, 0, wrZ + 2),
    ARMOR_L,
  );
  // 手掌
  const hpZ = wrZ - 10;
  add(t + "手掌", box(12, 4, 12).translate(shX + s * 2, 0, hpZ), ARMOR_D);
  add(t + "手背装甲", box(13, 2, 10).translate(shX + s * 2, -2.5, hpZ), ARMOR);
  // 手指 (4指 x 3节 = 12)
  const fNames = ["食指", "中指", "无名指", "小指"];
  const fX = [-4, -1.3, 1.3, 4];
  for (let f = 0; f < 4; f++) {
    const fx = shX + s * 2 + fX[f];
    const fz = hpZ - 9;
    add(
      t + fNames[f] + "第一节",
      box(2.2, 2.5, 5).translate(fx, 0, fz),
      ARMOR_L,
    );
    add(
      t + fNames[f] + "第二节",
      box(2, 2.2, 4.5).translate(fx, 0, fz - 5.5),
      ARMOR,
    );
    add(
      t + fNames[f] + "指尖",
      box(1.8, 2, 3.5).translate(fx, 0, fz - 10),
      ARMOR_D,
    );
  }
  // 拇指 (2节)
  const thX = shX + s * 2 - s * 6;
  add(
    t + "拇指第一节",
    box(2.5, 2.5, 5)
      .rotateY(s * 30)
      .translate(thX, 0, hpZ - 3),
    ARMOR_L,
  );
  add(
    t + "拇指指尖",
    box(2.2, 2.2, 4)
      .rotateY(s * 30)
      .translate(thX - s * 2, 0, hpZ - 7.5),
    ARMOR_D,
  );
}
makeArm(-1);
makeArm(1);

// ============================================================
// 腿部 (每侧 ~28部件，共56)
// ============================================================
function makeLeg(s) {
  const t = s < 0 ? "左" : "右";
  const hipX = s * 16,
    hipZ = 68;
  // 髋关节
  add(t + "髋关节", sphere(9, 16, 12).translate(hipX, 0, hipZ), JOINT);
  add(
    t + "髋关节外壳",
    cylinder(10, 8, 16)
      .rotateY(90)
      .translate(hipX + s * 4, 0, hipZ),
    ARMOR_D,
  );
  add(
    t + "髋部装甲",
    box(16, 18, 12).translate(hipX + s * 6, 0, hipZ + 4),
    ARMOR,
  );
  // 大腿
  const thZ = hipZ - 24;
  add(t + "大腿主体", box(16, 16, 34).translate(hipX + s * 4, 0, thZ), ARMOR);
  add(
    t + "大腿前装甲",
    box(14, 4, 28).translate(hipX + s * 4, -9, thZ),
    ARMOR_L,
  );
  add(
    t + "大腿侧装甲",
    box(4, 14, 26).translate(hipX + s * 4 + s * 9, 0, thZ),
    ARMOR_D,
  );
  add(
    t + "大腿液压管A",
    cylinder(2.5, 30, 8).translate(hipX + s * 4 + s * 5, 5, thZ),
    CHROME,
  );
  add(
    t + "大腿液压管B",
    cylinder(2, 28, 8).translate(hipX + s * 4 + s * 5, -4, thZ),
    CHROME,
  );
  add(
    t + "大腿能量条",
    box(1.5, 1.5, 22).translate(hipX + s * 4, -9, thZ + 2),
    GLOW,
  );
  // 膝关节
  const knZ = thZ - 22;
  add(
    t + "膝关节外壳",
    cylinder(8, 12, 16)
      .rotateY(90)
      .translate(hipX + s * 4, 0, knZ),
    JOINT,
  );
  add(t + "膝关节前护", box(12, 6, 10).translate(hipX + s * 4, -8, knZ), ARMOR);
  add(
    t + "膝关节盖",
    cylinder(5, 3, 16)
      .rotateY(90)
      .translate(hipX + s * 4 + s * 7, 0, knZ),
    ARMOR_D,
  );
  add(
    t + "膝关节指示",
    cylinder(2, 1.5, 12)
      .rotateY(90)
      .translate(hipX + s * 4 + s * 7.5, 0, knZ),
    GLOW_W,
  );
  // 小腿
  const sZ = knZ - 24;
  add(t + "小腿主体", box(14, 14, 36).translate(hipX + s * 4, 0, sZ), ARMOR);
  add(
    t + "小腿前装甲",
    box(16, 5, 30).translate(hipX + s * 4, -8, sZ),
    ARMOR_L,
  );
  add(
    t + "小腿侧板",
    box(4, 12, 28).translate(hipX + s * 4 + s * 8, 0, sZ),
    ARMOR_D,
  );
  add(
    t + "小腿管线A",
    cylinder(2, 32, 8).translate(hipX + s * 4 + s * 3, 6, sZ),
    RUBBER,
  );
  add(
    t + "小腿管线B",
    cylinder(1.5, 30, 8).translate(hipX + s * 4 - s * 2, 6, sZ),
    RUBBER,
  );
  add(
    t + "小腿能量条",
    box(1.5, 1.5, 24).translate(hipX + s * 4, -8, sZ),
    GLOW,
  );
  // 踝关节
  const anZ = sZ - 22;
  add(
    t + "踝关节",
    cylinder(6, 10, 16)
      .rotateY(90)
      .translate(hipX + s * 4, 0, anZ),
    JOINT,
  );
  add(
    t + "踝关节护甲",
    box(10, 10, 6).translate(hipX + s * 4, 0, anZ + 2),
    ARMOR,
  );
  // 脚部
  const ftZ = anZ - 8;
  add(t + "脚掌主体", box(14, 22, 6).translate(hipX + s * 4, -4, ftZ), ARMOR_D);
  add(t + "脚底", box(14, 22, 2).translate(hipX + s * 4, -4, ftZ - 4), RUBBER);
  add(
    t + "脚面装甲",
    box(12, 14, 4).translate(hipX + s * 4, -8, ftZ + 3),
    ARMOR,
  );
  add(t + "前脚掌", box(14, 8, 5).translate(hipX + s * 4, -16, ftZ - 1), ARMOR);
  add(t + "脚跟", box(10, 6, 8).translate(hipX + s * 4, 6, ftZ - 1), ARMOR_D);
  add(
    t + "脚踝指示",
    box(3, 1.5, 2).translate(hipX + s * 4, -8, ftZ + 4),
    GLOW,
  );
}
makeLeg(-1);
makeLeg(1);

// ============================================================
// 裙甲 (6部件)
// ============================================================
add("前裙甲", box(38, 6, 16).translate(0, -16, 72), ARMOR);
add("后裙甲", box(38, 6, 16).translate(0, 16, 72), ARMOR_D);
add("侧裙甲(左)", box(8, 26, 14).translate(-24, 0, 72), ARMOR);
add("侧裙甲(右)", box(8, 26, 14).translate(24, 0, 72), ARMOR);
add("前裙甲发光条", box(28, 1.5, 2).translate(0, -18, 76), GLOW);
add("腰带扣", box(10, 4, 6).translate(0, -14, 76), GOLD);

// ============================================================
// 额外细节 (~18部件)
// ============================================================
add(
  "胸部徽章",
  cylinder(5, 2, 6)
    .rotateX(90)
    .translate(0, -17, cZ + 20),
  GOLD,
);
add(
  "徽章内圈",
  cylinder(3, 3, 6)
    .rotateX(90)
    .translate(0, -17, cZ + 20.5),
  GLOW,
);
add("肩部标记(左)", box(8, 1, 4).translate(-36, -12, cZ + 22), GLOW_W);
add("肩部标记(右)", box(8, 1, 4).translate(36, -12, cZ + 22), GLOW_W);
add("腰带扣发光", box(6, 2, 3).translate(0, -15, 76), GLOW);
// 胸部侧通风
add("左侧通风1", box(2, 10, 2.5).translate(-27, 0, cZ + 10), DARK);
add("左侧通风2", box(2, 10, 2.5).translate(-27, 0, cZ + 4), DARK);
add("左侧通风3", box(2, 10, 2.5).translate(-27, 0, cZ - 2), DARK);
add("右侧通风1", box(2, 10, 2.5).translate(27, 0, cZ + 10), DARK);
add("右侧通风2", box(2, 10, 2.5).translate(27, 0, cZ + 4), DARK);
add("右侧通风3", box(2, 10, 2.5).translate(27, 0, cZ - 2), DARK);
// 颈部线缆
add(
  "颈部线缆(左)",
  cylinder(1.5, 20, 8).rotateZ(-15).translate(-10, 8, 158),
  RUBBER,
);
add(
  "颈部线缆(右)",
  cylinder(1.5, 20, 8).rotateZ(15).translate(10, 8, 158),
  RUBBER,
);
// 背部排气口
add("背部排气口(左)", box(6, 3, 10).translate(-18, 20, cZ - 12), DARK);
add("背部排气口(右)", box(6, 3, 10).translate(18, 20, cZ - 12), DARK);
// 前臂武器接口
add("前臂武器接口(左)", box(6, 6, 8).translate(-40, 8, 95), ARMOR_D);
add("前臂武器接口(右)", box(6, 6, 8).translate(40, 8, 95), ARMOR_D);
add(
  "接口发光(左)",
  cylinder(1.5, 4, 8).rotateY(90).translate(-40, 9.5, 95),
  GLOW_W,
);
add(
  "接口发光(右)",
  cylinder(1.5, 4, 8).rotateY(90).translate(40, 9.5, 95),
  GLOW_W,
);

return parts;
