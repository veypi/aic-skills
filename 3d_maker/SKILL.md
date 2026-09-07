---
name: 3d_maker
nickname: 3D Maker
description: 浏览器内专业 3D 模型设计：参数化 CAD 建模、多部件装配、打印就绪检测与 STL/OBJ/GLB/3MF 导出（内置 JS 内核 / OCCT 高性能内核）
keywords: [3d, cad, 建模, 打印, stl, obj, glb, 3mf, occt, 布尔, 圆角, 车削, 齿轮, 装配]
icon: fa-solid fa-cubes
ui:
  - path: index.html
    desc: 3D Maker 建模工作台（画布 + 工具栏 + 属性/分析/详情面板 + 模型文件）
---

# 3D 模型设计代码编写指南

> 适用于 3D Maker 的建模代码（用户代码 / AI 生成代码）。
> 代码在页面中沙盒执行，文末必须 `return` 几何体。

## 0. 代码如何送达页面执行（page exec 接口）

**你的可见性边界（重要）**：你的信息来源只有两部分——① 本文档（SKILL.md）注入的知识；② 页面注册的指令（见下）。
模型代码文件统一存放在**本地文件根 `/3d/`**：你用 `fs` 工具（1host=page）直接读写，页面经 `$mod.$fs` 访问同一份文件（页面本地 OPFS），两边完全同步。
页面注册的指令有 `run_code` / `run_file` / `status` 三个。

建模代码通过 `exec` 工具（`1host=page`）推送到 3D Maker 页面执行。先 `page open` 打开页面（`open --url {url_prefix}/index`，记录返回的 win_id），之后按 `{win_id}.{指令}` 调用：

### 0.1 run_code —— 直接执行代码字符串

适合短代码、即时修改：

```
exec {"1host":"page", "action":"{win_id}.run_code", "argv":["--code", "return box(20, 15, 10);"]}
```

### 0.2 run_file —— 执行本地 /3d/ 代码文件

适合完整模型文件：先用 `fs write` 把代码写入 `/3d/`，再让页面加载执行：

```
# 1. 写代码文件（1host=page，页面本地存储 /3d/）
fs {"1host":"page", "action":"write", "path":"/3d/bracket.js", "content":"..."}

# 2. 通知页面加载执行
 exec {"1host":"page", "action":"{win_id}.run_file", "argv":["--path", "/3d/bracket.js"]}
```

`--path` 接受**本地路径**（页面经 `$mod.$fs` 读取）：

| path 示例 | 对应位置 | 用途 |
| --- | --- | --- |
| `/3d/xxx.js` | 本地 /3d/（推荐，默认位置） | 模型代码 |
| `xxx.js` | 同上（自动补 /3d/ 前缀） | 简写 |

run_file 特有错误码（在返回 JSON 的 `code` 字段）：`INVALID_PATH`（路径非法/含 `..`）、`FILE_NOT_FOUND`（文件不存在）、`RUN_FILE_ERROR`。

### 0.3 指令表

页面注册指令（经 `exec 1host=page {win_id}.{cmd}` 调用，argv 为字符串数组 `["--key","val"]`）：

| 指令 | 说明 | 参数 | 返回要点 |
| --- | --- | --- | --- |
| `run_code` | 执行一段建模代码字符串 | `--code <源码>`（或 argv[0]） | `{success, stats, parts, warnings, executionTime}`；失败 `{success:false, code, message}` |
| `run_file` | 执行本地 /3d/ 建模代码文件 | `--path <路径>`（如 `/3d/x.js`） | 同 run_code；特有 code：`INVALID_PATH`/`RUN_FILE_ERROR` |
| `status` | 查询页面状态 | 无 | `{ok, ready, busy, kernel, kernelLoading, stats, fileCount}` |
| `shot` | 截取当前 3D 视图保存为本地图片 | `--path <路径>`（默认 `/3d/shot.png`） | `{ok, path, width, height, bytes}`；**只落盘不返回图片**，看图需再 `fs.read` 读回 |
| `parts_audit` | 逐部件打印问题清单（水密/非流形/悬空/薄壁/干涉） | `--min-wall <最小壁厚 mm>`（默认 1.2） | `{summary, parts:[…]}`；不修改模型，只做分析 |
| `set_kernel` | 切换几何内核（builtin=内置 JS / occt=高性能） | `--kernel builtin|occt` | `{success, kernel, message?}`；**尽力切换**：当前模型超 OCCT 重建限额（>2 万三角面/开放网格）时自动回退内置渲染并返回 `kernelFallback` 提示，重跑小模型后 OCCT 自动生效 |
| `set_theme` | 切换观感主题（dark=深影棚背景，展示模型观感更佳） | `--theme dark|light|auto` | `{success, theme}` |

- `kernel` = `builtin`（内置 JS 内核）或 `occt`（高性能内核）；`kernelLoading:true` 表示 OCCT 正在后台加载，可继续用内置内核
- `stats` 非空表示当前场景已加载（含 printability/interference 摘要）

### 0.4 事件契约

- 页面未打开时指令无响应：先 `page open`（`open --url {url_prefix}/index`，记下返回的 win_id），`page exec action=commands` 确认指令列表后再调用。
- argv 风格 `--key val`（或位置参数）；指令**不要并行调用**，一轮一个（建模是 CPU 密集计算）。
- 页面打开时默认加载最近一次成功运行的模型（本地缓存），无缓存则加载乐高积木案例。
- 结果以 `content` 中的 JSON 为准（`success: false` 时看 `code`/`message`），不要凭猜测复述统计。
- **看图闭环（阶段 0）**：`shot` 只把截图落到本地 `/3d/`（content 返回 path），**不直接返回图片**——平台图片投递收敛只认 `fs.read`（§2.2：只有 fs.read 能把图片带进消息），所以看图必须两步：`{win_id}.shot` → `fs.read`（1host=page, path=`/3d/shot.png`）。图片经标准链落盘进消息（msg.Files），模型侧直接识图，无需用户截图中转。

### 0.5 如何选择：小模型用 run_code，大模型用 run_file

- **小模型 / 简单验证**（几个图元、一两次布尔）：直接用 `run_code`，一步到位
- **大模型 / 复杂设计**（多部件、参数化、反复调整）：**先用 `fs write` 把代码编辑成文本文件，再通过 `run_file` 执行渲染看结果**。之后每次修改都用 `fs edit` 改文件、再 `run_file` 重跑，形成「编辑 → 渲染 → 看结果 → 再编辑」的迭代闭环；代码保存到本地 /3d/，可复用、可追溯

## 1. 快速开始

```js
// 最小示例：一个 20×15×10 的方块
return box(20, 15, 10);

// 开孔板：布尔差集
const plate = box(40, 25, 8);
const cutter = cylinder(5, 20);   // 高度故意超出板厚，保证切透（勿用 hole 命名——hole 是内置孔刀具 API，会撞名）
return plate.cut(cutter);

// 多部件（带名称和颜色）
return [
  { name: '底板', shape: box(40, 30, 4),                    color: '#8899aa' },
  { name: '立柱', shape: cylinder(5, 20).translate(0, 0, 12), color: '#cc8800' },
  { name: '玻璃罩', shape: box(40, 30, 12).translate(0, 0, 10), color: 'rgba(21,32,43,0.4)' }, // 半透明
];
```

**颜色透明度**：部件 `color` 支持带透明度的写法——`rgba(r,g,b,a)`（如 `rgba(21,32,43,0.4)`）或 8 位 hex `#rrggbbaa`（如 `#ff000080`）；a 为 0~1 透明度，半透明部件在实体/透明/X光等视图模式下均生效（玻璃、灯罩等用）。

**规则**：

- 末尾 `return` 一个几何体，或几何体数组（可带 `name` / `color`）
- 单位：**毫米 mm**；坐标系：**Z 轴向上**，所有图元默认**中心在原点**
- 代码以严格模式执行，可直接使用全部内核 API（无需 import）
- 几何体方法均可**链式调用**（`box(10).translate(5,0,0).rotateZ(45)`）

## 2. 图元（Primitives）

| API | 参数 | 说明 |
| --- | --- | --- |
| `box(w, d, h)` | 宽/深/高；省略时 d=w, h=d | 立方体，中心在原点 |
| `cylinder(r, h, segments=48)` | 半径/高/圆周分段 | 圆柱，轴向 Z，中心在原点 |
| `cone(rBottom, rTop, h, segments=48)` | 底半径/顶半径/高 | 圆台（rTop=0 为圆锥） |
| `sphere(r, segments=48, rings=24)` | 半径/经度分段/纬度分段 | 球体，中心在原点 |
| `torus(R, r, segments=48, tubeSeg=24)` | 主半径/截面半径 | 圆环，绕 Z 轴 |
| `pipe(rOuter, rInner, h, segments=48)` | 外径/内径/高 | 空心圆管 |

> `segments` 只影响内置内核的网格密度；OCCT 内核忽略该参数（B-Rep 精确曲面，自动三角化）。

## 3. 草图 + 拉伸

```js
sketchRect(30, 20).extrude(10);                    // 矩形（中心原点）
sketchCircle(10).extrude(8);                       // 圆（多边形近似）
sketchRoundedRect(40, 20, 5).extrude(10);          // 圆角矩形（w, h, 圆角r）
sketchPolygon([[0,0],[20,0],[10,15]]).extrude(10); // 任意多边形
```

- 草图在 XY 平面，`.extrude(h)` 沿 Z 拉伸（−h/2 ~ +h/2，中心在原点）
- 多边形点序**顺逆时针均可**（内核自动校正方向）
- 需要真圆截面时请改用 `cylinder()`（OCCT 内核下 sketchCircle 是 48 边形）

## 4. 旋转成型（车削）

```js
// 轮廓格式：[[半径r, 高度z], ...]，绕 Z 轴旋转一周
revolve([[0,-15],[12,-10],[15,0],[12,10],[0,15]]);   // 纺锤体
lathe([[0,-15],[12,-10],[15,0],[12,10],[0,15]]);      // lathe 是 revolve 的别名
```

**重要**：轮廓必须能形成**封闭实体**，否则体积无意义：

- 首尾点落在旋转轴上（`r = 0`）——如上面的纺锤体
- 或轮廓自身成闭环——如圆环截面 `torus()` 内部实现

## 5. 变换（链式）

| 方法 | 说明 |
| --- | --- |
| `.translate(x, y, z)` | 平移 |
| `.rotateX(deg)` / `.rotateY(deg)` / `.rotateZ(deg)` | 绕坐标轴旋转（角度制） |
| `.rotate([ax, ay, az], deg)` | 绕任意轴旋转 |
| `.scale(s)` / `.scale(x, y, z)` | 均匀 / 非均匀缩放 |
| `.mirror('XY' / 'XZ' / 'YZ')` | 关于过原点坐标平面的镜像（注意：应先倒圆角再镜像） |

```js
// 螺栓头：六边形柱，旋转 30°，放到 z=20
sketchPolygon(hexPoints).extrude(8).rotateZ(30).translate(0, 0, 20);
```

## 6. 布尔运算（CSG）

| 方法 | 说明 | 记忆 |
| --- | --- | --- |
| `a.fuse(b)` | 并集 a∪b | 焊接 |
| `a.cut(b)` | 差集 a−b | 开孔/切削 |
| `a.intersect(b)` | 交集 a∩b | 取公共部分 |

```js
// 三通管接头
const main = pipe(20, 16, 100);
const branch = pipe(20, 16, 60).rotateY(90).translate(0, 0, 0);
return main.fuse(branch);
```

**技巧**：切削工具（刀具）应比被切区域略大，避免共面产生碎面。

### 6.5 阵列（线性 / 圆周）

阵列 = 网格级副本合并（非布尔，副本应互不重叠；有重叠请对结果再 fuse）。不修改原形状，返回合并后的新几何体：

```js
// 线性阵列：n 个等距副本（含原体），步进向量 (dx, dy, dz)
cylinder(4, 10).linearPattern(4, 20, 0, 0);

// 圆周阵列：绕轴 n 个副本（含原体），轴过原点；axis = 'Z'（默认）/ 'X' / 'Y' / [x,y,z]
// 默认 360 均布（步进 360/n）；指定角度时按 angle/(n-1) 均布（首尾都在）
cylinder(4, 10).translate(30, 0, 0).circularPattern(6, 'Z');
box(10, 4, 4).translate(25, 0, 0).circularPattern(3, 'Z', 90);   // 90° 范围内 3 个
```

### 6.6 孔刀具（hole）

`hole(r, h, opts)` 生成孔刀具（配合 `cut` 使用，轴向 Z、中心原点）：

```js
// 过孔
plate.cut(hole(4, 12).translate(10, 5, 0));
// 沉头孔（cboreR 大径 / cboreH 深度，在 +Z 端）
plate.cut(hole(3, 12, { cboreR: 6, cboreH: 3 }).translate(10, 5, 0));
// 锥孔（csinkAngle 锥角° / csinkDepth 深度，在 +Z 端）
plate.cut(hole(3, 12, { csinkAngle: 90, csinkDepth: 3 }).translate(10, 5, 0));
```

### 6.7 有机形态 API（阶段 1：loft / sweep / meshFromVerts / subdivide / displace / smooth）

网格级 API，为树/花瓶曲面/有机装饰补表达力（纯加法，不改变既有能力）：

| API | 参数 | 说明 |
| --- | --- | --- |
| `loft(sections, opts)` | 截面列表（每截面闭合轮廓点数组）+ `{segments?: 96, closed?: true}` | 沿截面顺序放样实体；截面积点数自动重采样对齐（首截面为准）；环绕向自动校正 |
| `sweep(profile, path, opts)` | 2D 轮廓 `[[u,v],…]` + 3D 路径 `[[x,y,z],…]` + `{closedPath?, cap?}` | 轮廓沿路径扫掠（平行传输帧防扭转）；弯曲管/栏杆/有机曲线 |
| `meshFromVerts(verts, faces)` | 顶点（嵌套或扁平）+ 面 `[[a,b,c],…]` | 手工网格 → 实体（闭合时 watertight；开放网格为装饰面） |
| `subdivide(shape, levels)` | 1~3 | 中点细分：形状不变、面数 ×4——提高密度供 displace 出细节 |
| `displace(shape, amp, opts)` | `{freq?: 0.5, seed?: 1}` | 顶点沿法线位移（可复现多频噪声）——有机凹凸/纹理 |
| `smooth(shape, iterations)` | 1~5 | 拉普拉斯平滑（步长 0.25，防过度收缩）——柔化尖角/噪声 |

**双内核语义**（§13）：六个 API 在 builtin / OCCT 下产生相同几何。OCCT 侧经 B-Rep 重建——`loft` 用 `BRepOffsetAPI_ThruSections`、`sweep` 用 `BRepOffsetAPI_MakePipeShell`（圆截面类也用 `MakePipe` 兜底）、`meshFromVerts`/`subdivide`/`displace`/`smooth` 走 `BRepBuilderAPI_Sewing` 缝合重建；重建限 2 万三角面以下（超限报错，请用内置内核做大规模网格操作）。

**有机建模套路**：骨架（loft/sweep）→ `subdivide` 提密度 → `displace` 表面纹理 →（可选）`smooth` 柔化。注意 displace 后打印检测仍可用（输出已顶点焊接，watertight 语义保持），但薄壁件请用 `parts_audit` 复核壁厚。

```js
// 花瓶：截面放样 + 有机纹理
const ring = (z, r) => { const p = [];
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; p.push([r * Math.cos(a), r * Math.sin(a), z]); } return p; };
let vase = loft([ring(0, 16), ring(8, 14), ring(14, 9), ring(22, 7), ring(30, 11), ring(36, 12)]);
vase = subdivide(vase, 2);
vase = displace(vase, 1.2, { freq: 0.35, seed: 5 });
return vase;

// 弯曲管：圆截面沿圆弧扫掠
const path = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI / 2; path.push([20 * Math.cos(a), 20 * Math.sin(a), 0]); }
const prof = []; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; prof.push([3 * Math.cos(a), 3 * Math.sin(a)]); }
return sweep(prof, path);
```

工具栏「📦 案例… → 有机花瓶（loft+displace）」可一键载入完整案例。

### 6.8 贴面浮雕 API（relief / surfaceHit）

把平面轮廓**投影到模型表面**生成贴合曲面的浮雕片（外表面凸起 + 底面嵌入 + 侧壁闭合，水密实体），
可直接 fuse 进主体 —— 适合胸甲线条、眼睛、纹饰等贴面细节（躯干/腿部是 loft 曲面，盒状贴片会浮空，用本 API 贴合）：

```js
// 胸部 V 形纹（dir=+Y 从正面射向模型，轮廓在 XZ 平面 [x, z]）
const vPatch = relief(torso, [[-8, 130], [0, 122], [8, 130]], { dir: [0, 1, 0], rise: 0.7, embed: 0.6 });
return torso.fuse(vPatch);
```

| API | 参数 | 说明 |
| --- | --- | --- |
| `relief(shape, outline, opts)` | 轮廓 `[[a, b], ...]`（≥3 点闭合）+ `{ dir?, rise?, embed?, seg? }` | 生成贴合 shape 表面的浮雕片 Shape（水密实体）；轮廓点未命中表面时抛错（含坐标） |
| `surfaceHit(shape, a, b, dir)` | 同上坐标 | 返回 `{point, normal, distance}` 或 `null`（未命中） |

- **投影平面约定**（dir 取三大轴向）：`dir=[0,±1,0]` → 坐标 `[x, z]`；`dir=[0,0,±1]` → `[x, y]`；`dir=[±1,0,0]` → `[y, z]`
- **opts**：`dir` 射线方向（默认 `[0,1,0]`）；`rise` 凸起量（默认 0.6）；`embed` 嵌入量（默认 0.5，底面埋入体表防悬空）；`seg` 轮廓细分弦长 mm（默认 0.8，越小越贴合曲面；直弦在大曲率处会穿面）
- 双内核同语义（网格级实现，与内核无关）；OCCT 下浮雕片经 B-Rep 重建后 fuse（受 2 万三角面重建限额，浮雕片面数低不受限）
- 眼睛等小细节可做「深色衬底 + 亮色镜片」两层浮雕；**miss 即抛错**（轮廓超出模型范围会显式报错）

## 7. 圆角（Fillet）

```js
box(30, 20, 10).fillet(3);   // 所有棱边倒 R3 圆角
```

| 内核 | 支持范围 | 说明 |
| --- | --- | --- |
| OCCT（推荐） | **任意实体全部棱边** | 真实 3D 圆角（B-Rep） |
| 内置 JS | 仅 `box` 和**未布尔**的 `extrude` | 2.5D 圆角（只倒轮廓竖直棱边）；其他类型返回警告并保留原形状 |

> ⚠️ 内置内核对 extrude 的圆角存在过量切削缺陷（v1.2 已知问题），需要圆角请使用 OCCT 内核。

## 8. 齿轮轮廓

```js
// gearProfile(齿数, 模数) → 简化梯形齿轮廓点数组
const pts = gearProfile(20, 2);
let gear = sketchPolygon(pts).extrude(10);
gear = gear.cut(cylinder(5, 12));                    // 中心孔
gear = gear.cut(box(2.5, 5, 14).translate(4, 0, 0)); // 键槽
return gear;
```

## 9. 参数化面板（@param 注释）

在常量声明前加 `@param` 注释，页面会自动生成可调参数面板：

```js
// @param size 边长 (mm) {min: 10, max: 200, step: 5}
const size = 60;
// @param filletR 圆角半径 (mm) {min: 0, max: 30, step: 1}
const filletR = 8;

const shape = box(size, size, size);
return filletR > 0 ? shape.fillet(filletR) : shape;
```

语法：`// @param 变量名 显示名 (单位) {min, max, step}`

## 10. 返回值与错误处理

### 模型导出

用户可在页面工具栏「⬇ 下载」导出模型，格式：STL（二进制/文本）、OBJ、GLB、**3MF**（3D 打印格式，保留部件名称与颜色，含 rgba 透明色）、JSON（模型）。

### 成功

`run()` 返回 `{ success, stats, parts, warnings, executionTime }`，
其中 `stats` 含体积/表面积/包围盒/顶点/三角面/部件数，`parts` 为逐部件摘要（不含坐标数据）。

### 部件干涉检测（位置冲突）

多部件模型自动做位置冲突检测，返回顶层 `interference` 字段：

```json
"interference": {
  "count": 2,
  "approximate": false,
  "pairs": [
    { "a": 0, "b": 1, "aName": "底板", "bName": "立柱" },
    { "a": 2, "b": 3, "aName": "外壳", "bName": "内芯" }
  ]
}
```

- `count > 0` 即存在位置冲突（部件互相穿入/重叠/完全嵌套），`pairs` 列出冲突部件对（索引 + 名称）
- 表面贴合、边界接触**不算**冲突；`stats.interferenceCount` 为冲突总数（快捷判断）
- 检测算法：AABB 粗筛 + 空间哈希三角形相交 + 重心采样射线（覆盖完全嵌套）；超预算时 `approximate: true`
- **设计装配体时若返回冲突，应调整部件位置/尺寸，避免打印件互相穿插**

### 打印就绪检测（stats.printability）

每次运行自动做网格拓扑分析（三角面 > 50 万时跳过，返回 `skipped: true`），结果直接供你判断可打印性并迭代修模：

```json
"printability": {
  "watertight": false,          // 水密=可打印（开放边=0 且无非流形边）
  "openEdges": 24,              // 开放边数（网格裂缝）
  "openLoops": 8,               // 裂缝环数
  "nonManifoldEdges": 0,        // 非流形边（>2 个面共用一条边）
  "overhangDeg": 45,
  "overhangArea": 12.3,         // 悬空面面积（法线与 -Z 夹角 < 45°；接触热床的面已排除）
  "overhangRatio": 0.004,       // 悬空面占总面积比
  "regions": 10,                // 完整面数（拓扑重建的平面/曲面区域）
  "planarFaces": 10,            // 其中平面数
  "featureEdges": 24            // 特征边数（锐边/边界边）
}
```

- **watertight=false 即当前网格不能直接打印**：开放边是网格裂缝，STL 导出后切片软件会报错或错层。
- 内置 BSP 内核对「旋转薄刀切割薄板」「薄壁残留」场景可能产生裂缝网格——**打印用途务必确认当前是 OCCT 内核**（页面默认自动启用，见 §11）。
- 悬空面超过 45° 需要支撑；设计时尽量避免，或调整摆放方向。

### 逐部件审计（parts_audit）

`parts_audit` 在**当前已加载场景**上做逐部件检查（不修改模型），返回 `{summary, parts:[…]}`，是 AI 修模的定位工具——`parts` 数组每项：

```json
{
  "index": 0, "name": "底板",
  "watertight": true, "openEdges": 0, "openLoops": 0, "nonManifoldEdges": 0,
  "overhangDeg": 45, "overhangArea": 12.3, "overhangRatio": 0.004,
  "minWall": 2.1, "minWallSamples": 160,
  "volume": 100, "area": 50,
  "conflicts": ["立柱"],
  "issues": [{ "level": "warning", "type": "interference", "detail": "…" }]
}
```

- **分级**：`critical` = 非水密 / 非流形 / 薄壁（minWall < 阈值，默认 1.2mm，`--min-wall` 可调）；`warning` = 悬空（面积 > 50mm² 且占比 > 1%）/ 干涉；`summary.ready = critical 数为 0`
- **minWall 是网格级近似**（表面重心沿 -法线向实体内部发射线取最近命中）：薄壁/薄板件准确（误差 < 0.2mm），带内腔/孔洞的件可能偏低（命中孔壁）——只用于定位薄壁嫌疑，精确值以 OCCT 体积/几何语义为准
- 部件多于 1 个时自动做干涉检测（`conflicts` 列出与其位置冲突的部件名，表面贴合不算）
- 用法：`run_file` 重跑后调 `parts_audit` 看问题清单 → 按 `issues` 逐条修（补刀/加厚/移开部件）→ 重跑 → 再审计，形成闭环

### 3D 打印设计规范

1. **水密优先**：返回结果 watertight 必须为 true；为 false 时先检查刀具是否完全穿透、有无薄壁残留；仍失败请提醒用户确认 OCCT 内核已启用（工具栏 ⚡ OCCT）。
2. **壁厚 ≥ 1.2mm**（FDM 常规下限），细长杆直径 ≥ 2mm；避免 <0.8mm 的薄壁残留——刀具盲端不要停在板内，应完全穿透。
3. **悬空角 ≤ 45°**：超过的斜面考虑加支撑结构、拆分件或调整方向。
4. **装配间隙 0.2~0.4mm**（FDM 常规）；配合孔建议设计小 0.2mm 打印后扩孔。
5. **导出**：用户用工具栏「⬇ 下载」导 STL/3MF 即可直接切片打印。

### 常见错误码

| code | 原因 | 建议 |
| --- | --- | --- |
| `NO_RETURN` | 代码没有 return | 末尾加 `return <几何体>` |
| `INVALID_RETURN` | 返回了非几何体 | return box(...) 或其数组 |
| `EMPTY_RETURN` | 返回空数组 | 至少一个部件 |
| `TIMEOUT` | 计算超时 | 降低分段数 / 简化布尔 |
| `ABORTED` | 用户中断 | 重新运行 |

## 11. 性能与内核选择建议

1. **分段数够用就好**：cylinder/sphere 的 segments 每翻倍，三角面约翻 2~4 倍；
   超过 `maxTriangles`（默认 100 万）会产生警告。
2. **布尔宁少勿多**：内置内核 BSP 布尔随面数平方增长；连续多次 fuse 建议先合并小件。
3. **OCCT 内核（默认）**：体积精确、三角面少约 96%、支持任意圆角、布尔结果水密可打印。
   页面打开即后台自动加载 OCCT 并设为默认内核（就绪前用内置内核兜底渲染，就绪后自动重跑当前模型）；
   首次加载需下载 ~49MB WASM（顶部进度条显示），之后命中浏览器本地缓存秒级完成；用户可点工具栏「🧮 内置 / ⚡ OCCT」手动来回切。
   内核整体运行在独立 Web Worker：初始化（embind 注册约 2s）/编译/建模计算/分析全部不占主线程，
   页面零冻结；运行中断 = 终止 worker 并后台重建（约 2s），期间页面照常操作。
4. **网格体积与精确体积**：内置内核基于三角网格求体积（球 −1.6%、圆环 −3.2% 属正常逼近）；
   需要精确体积/表面积时用 OCCT 内核。
5. **部件 DOM 上限（重要）**：页面「部件树」最多渲染 200 行（可搜索）、「设计步骤」默认折叠且只显示前 200 组——
   **不要生成几百上千个独立部件**（数字量级直接拖死 DOM）。大量同类元素（叶片/零件/装饰）必须合并成少数 mesh：
   用 `meshFromVerts` 自己生成顶点/面（每色一桶一部件），或 generate 后不逐件 addPart。
6. **展示观感**：模型生成后调 `set_theme --theme dark`（深影棚背景）截图更出片；主光已是暖金色调，
   金色/橙色系模型在 dark 主题下对比最强。

## 12. 完整示例

> 以下示例的**代码已完整内联在本文档**——需要时直接复制代码用 `run_code` 执行。
> 页面工具栏「📦 案例…」下拉也提供这些案例（页面从 skill 包内 `ui/examples/` 直接下载代码执行）。
> ⚠️ **你无法预知 skill 包内文件的内容**，因此不要依赖 `run_file` 加载案例文件；需要案例模型时用 `run_code` 内联本文档中的代码。

### 乐高积木 2×4

```js
// @param studsX 长边凸点数 {min: 1, max: 8, step: 1}
const studsX = 4;
// @param studsZ 短边凸点数 {min: 1, max: 4, step: 1}
const studsZ = 2;

const pitch = 8.0, studR = 2.4, studH = 1.8, wall = 1.2, height = 9.6;
const W = studsX * pitch - 0.2, D = studsZ * pitch - 0.2;

let brick = box(W, D, height).translate(0, 0, height / 2);
brick = brick.cut(box(W - wall * 2, D - wall * 2, height).translate(0, 0, height / 2 - 0.6));
for (let i = 0; i < studsX; i++)
  for (let j = 0; j < studsZ; j++)
    brick = brick.fuse(
      cylinder(studR, studH).translate(
        (i - (studsX - 1) / 2) * pitch,
        (j - (studsZ - 1) / 2) * pitch,
        height + studH / 2));
return brick;
```

### 带圆角的安装支架

```js
// L 型支架（推荐 OCCT 内核以获得真实圆角）
const base  = box(50, 30, 6);
const riser = box(6, 30, 30).translate(-22, 0, 18);
let bracket = base.fuse(riser);
bracket = bracket.cut(cylinder(3, 20).translate(-10, 0, 0)); // 安装孔
bracket = bracket.cut(cylinder(3, 20).translate(10, 0, 0));
return bracket.fillet(2);
```

### 车削花瓶

```js
// 轮廓首尾在轴上（r=0），保证封闭
return revolve([
  [0, -40], [18, -38], [22, -20], [12, 0],
  [16, 15], [20, 30], [14, 38], [0, 40],
]);
```

### 复杂装配体参考：两级齿轮减速器

内置案例「两级齿轮减速器」（页面工具栏 📦 案例… → 两级齿轮减速器）展示了当前能力的上限，要点：

- **真实工程关系**：齿轮中心距 = m(z1+z2)/2，齿顶/齿根啮合间隙 0.5mm
- **全参数化布局**：箱体、轴系、地脚全部由模数/齿厚推导，改 @param 自动重排
- **多部件输出**：9 个带 name/color 的部件，便于面板选择与导出
- **细节结构**：阶梯轴（多段 fuse）、抽壳箱体、轴承沉孔、加强筋、吊环
- 约 25 次布尔运算，191k 三角面，内置内核 820ms 完成

## 13. 内核语义与兼容性（重要）

页面有两个几何内核（内置 JS 内核与 OCCT WASM 内核），用户可随时手动切换，**同一段代码必须在两个内核下产生相同几何**。两内核语义已完全对齐：

| 语义 | 统一约定 |
| --- | --- |
| 所有图元 | 中心在原点 |
| `extrude(h)` | 沿 Z 居中拉伸（−h/2 ~ +h/2） |
| `rotateX/Y/Z(deg)` | 右手定则：从轴正向看原点，正角度为逆时针 |
| `scale(x,y,z)` | 以原点为基准缩放 |
| `revolve` | 绕 Z 轴 |

**因此写代码时不要做任何内核特定的适配**（比如手动补居中平移）——如果某个内核下模型错位，那是内核的 bug，不是代码问题。

内核差异注意事项：

- `segments` 参数只影响内置内核网格密度，OCCT 忽略（B-Rep 精确曲面）
- **内置内核 BSP 布尔在「旋转薄刀切割薄板」「薄壁残留」场景可能产生裂缝网格（watertight=false）**——打印用途务必用 OCCT 内核；打印就绪检测会暴露此类裂缝
- **OCCT 对带凹口的复杂实体倒圆角可能失败**（如带轮拱凹口的车身 `body.fillet()`）——此类形状不要整体 fillet；需要圆角效果时拆成简单部件分别倒角，或接受直边
- **OCCT 对开放网格（meshFromVerts/大 mesh）的 B-Rep 重建限 2 万三角面**——超限时内核报
  `mesh too large for B-Rep rebuild`；页面已做**尽力切换**：切 OCCT 超限模型自动回退内置渲染（结果带
  `kernelFallback` + warnings 提示），重跑小模型后 OCCT 自动生效，模型不会丢。
- 内置内核体积基于网格近似（球 −1.6%、圆环 −3.2% 属正常）；精确体积/表面积用 OCCT
- 内置内核 fillet 仅支持 box 与未布尔的 extrude（且 extrude 圆角有过量切削缺陷）

## 14. 高级装配技法库

以下模式从保时捷 911 等复杂模型中提炼，设计大型模型时优先套用：

### 14.1 部件数组 + 镜像装配助手

```js
const parts = [];
function add(n, s, c) { parts.push({ name: n, shape: s, color: c }); }
// 左右对称件只写一次逻辑，自动镜像成两个命名部件（用户可在面板单独隔离/隐藏）
function both(n, fn, c) { for (const s of [-1, 1]) add(n + (s < 0 ? '(左)' : '(右)'), fn(s), c); }

both('后视镜壳', s => box(11, 4, 8).translate(-95, s * 88, 92), '#191b1e');
return parts;
```

### 14.2 轮廓拉伸车身（侧面剪影法）

车辆/船体等“拉伸体”的通用做法：在 XY 平面画**侧视轮廓**（x = 纵向长度，y = 高度），沿 Z 拉出宽度，再 `rotateX(90)` 立正：

```js
let p = [[-225, 22], [-228, 38], /* …侧面剪影点… */ [224, 22]];
const body = sketchPolygon(p).extrude(176).rotateX(90);
```

> 注意 rotateX(90) 后原轮廓的 y（高度）变为 Z，拉伸宽度变为 Y。布局坐标要在旋转后的空间里想。

### 14.3 凹多边形：圆弧采样挖轮拱

`sketchPolygon` 支持**凹多边形**。轮拱凹口 = 在轮廓线上插入一段圆弧采样点（圆心在轮心）：

```js
const archR = 40, wheelCZ = 34, rocker = 22;
const dx = Math.sqrt(archR * archR - (wheelCZ - rocker) * (wheelCZ - rocker));
const a0 = Math.atan2(rocker - wheelCZ, dx), a1 = Math.PI - a0;
for (let i = 0; i <= 16; i++) {                 // 16 段采样，圆心 (cx, wheelCZ)
  const a = a0 + (a1 - a0) * i / 16;
  p.push([cx + archR * Math.cos(a), wheelCZ + archR * Math.sin(a)]);
}
```

### 14.4 intersect 裁剪取半（轮拱包边）

要“半个环形”（如只露出上半部的轮拱包边）：做完整环形，与一个 clip 盒子求交：

```js
const ring = pipe(41, 35, 26, 56).rotateX(90).translate(wx, s * 90, 34);
const clip = box(120, 60, 100).translate(wx, s * 90, 72);  // 盒子盖住上半部
const archLip = ring.intersect(clip);
```

### 14.5 椭球体（非均匀缩放）

```js
sphere(11, 40, 28).scale(1, 0.7, 0.9)   // 扁椭球大灯透镜
```

### 14.6 车轮总成（函数化复用）

轮胎 `pipe` + 轮辋边 `pipe` + 辐条（N 根 box 绕 Y 阵列 fuse）+ 螺栓（5 颗 cylinder 圆周阵列）+ 刹车盘 + 卡钳 + 轮毂盖，封成 `wheel(cx, cy)` 返回子部件字典，四轮复用，每个子部件单独 add（不同材质颜色）。

### 14.7 其他实用模式

- **实体玻璃与遮挡**：座舱玻璃是实心块，放在内部的件会被遮住——A 柱/纵梁等要贴在玻璃表面或外侧
- **格栅/百叶**：多片薄 box 等距排布，或先 fuse 成一个部件再挂面板
- **缝线细节**：1.5mm 宽的深色薄 box 贴在表面（车门缝、引擎盖中缝）
- **配色系统**：顶部定义调色板常量（车身/黑件/玻璃/镀铬/警示色），`add(name, shape, color)` 统一挂色

## 15. 高级完整样例：保时捷 911（115 部件）

> 完整源码由页面提供（工具栏「📦 案例… → 保时捷 911」，页面从 skill 包内 `ui/examples/` 直接下载执行）。
> ⚠️ 该文件对你**不可预知**——你的知识来源是下方内联代码 + §14 技法库，
> 生成同类模型时直接内联代码用 `run_code`，不要依赖 `run_file` 加载案例文件。
> 页面工具栏「📦 案例… → 保时捷 911」亦可一键载入。

```js
// 保时捷 911 精致模型 v5 - 高级配色 + 圆角精细化
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

// ===== 车身主体：侧视轮廓（含轮拱凹口圆弧采样）→ 拉伸车宽 → rotateX(90) 立正 =====
let p = [];
p.push([-225, rocker]); p.push([-228, 38]); p.push([-220, 52]); p.push([-200, 60]);
p.push([-170, 66]); p.push([-130, 70]); p.push([-95, 72]); p.push([-40, 73]);
p.push([40, 74]); p.push([95, 76]); p.push([140, 78]); p.push([185, 76]);
p.push([215, 68]); p.push([226, 52]); p.push([228, 36]); p.push([224, rocker]);
const dxA = Math.sqrt(archR * archR - (wheelCZ - rocker) * (wheelCZ - rocker));
const a0 = Math.atan2(rocker - wheelCZ, dxA), a1 = Math.PI - a0;
function arch(cx) {
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    p.push([cx + archR * Math.cos(a), wheelCZ + archR * Math.sin(a)]);
  }
}
arch(rwk); arch(fwx);                    // 后轮拱 → 前轮拱（沿轮廓走向依次嵌入）
add('车身主体', sketchPolygon(p).extrude(bodyW).rotateX(90), BODY);

// ===== 轮拱包边：完整环形 intersect 上半部 clip 盒 =====
function fender(wx, s) {
  const ring = pipe(41, 35, 26, 56).rotateX(90).translate(wx, s * 90, wheelCZ);
  const clip = box(120, 60, 100).translate(wx, s * 90, 72);
  return ring.intersect(clip);
}
both('前轮拱包边', s => fender(fwx, s), BODY);
both('后轮拱包边', s => fender(rwk, s), BODY);

// ===== 座舱：实心深色玻璃块 + 悬浮黑车顶 =====
let c = [[-112, 70], [-70, 128], [24, 138], [68, 132], [116, 88], [116, 70], [-112, 70]];
add('座舱玻璃', sketchPolygon(c).extrude(140).rotateX(90), GLASS);
add('车顶', box(128, 108, 10).translate(-4, 0, 135), ROOFBLK);
both('A柱', s => box(7, 7, 74).rotateY(37).translate(-86, s * 71, 100), ROOFBLK);

// ===== 车轮总成：轮胎/轮辋边/10 辐条+5 螺栓/刹车盘/卡钳/轮毂盖 =====
function wheel(cx, cy) {
  const tire = pipe(34, 25, 30, 64).rotateX(90);
  const lip = pipe(26, 22, 24, 48).rotateX(90);
  let sp = null;
  for (let i = 0; i < 10; i++) { const s = box(34, 7, 6).rotateY(i * 36); sp = sp ? sp.fuse(s) : s; }
  let spoke = sp.fuse(cylinder(8, 22, 32).rotateX(90));
  for (let i = 0; i < 5; i++) {
    const a = i * 72 * Math.PI / 180;
    spoke = spoke.fuse(cylinder(1.6, 7, 12).rotateX(90)
      .translate(13 * Math.cos(a), 12, 13 * Math.sin(a)));
  }
  const disc = cylinder(21, 5, 40).rotateX(90).translate(0, -7, 0)
    .fuse(cylinder(9, 9, 24).rotateX(90).translate(0, -7, 0));
  return {
    tire: tire.translate(cx, cy, wheelCZ), spoke: spoke.translate(cx, cy, wheelCZ),
    lip: lip.translate(cx, cy, wheelCZ), disc: disc.translate(cx, cy, wheelCZ),
    caliper: box(15, 9, 11).translate(0, -3, -16).translate(cx, cy, wheelCZ),
    cap: cylinder(4, 4, 20).rotateX(90).translate(0, 14, 0).translate(cx, cy, wheelCZ),
  };
}
for (const [cx, cy] of [[fwx, -82], [fwx, 82], [rwk, -82], [rwk, 82]]) {
  const w = wheel(cx, cy);
  const fb = cx < 0 ? '前' : '后', sd = cy < 0 ? '左' : '右';
  add(fb + sd + '轮胎', w.tire, TIRE);  add(fb + sd + '辐条', w.spoke, SPOKE);
  add(fb + sd + '轮辋边', w.lip, LIPL); add(fb + sd + '刹车盘', w.disc, DISC);
  add(fb + sd + '卡钳', w.caliper, RED); add(fb + sd + '轮毂盖', w.cap, GOLD);
}

// …其余约 90 个部件（引擎盖/前后脸/灯具/尾翼/侧裙/格栅/排气…）见完整文件…
return parts;
```

**该样例展示的能力点**：凹多边形车身轮廓、圆弧采样轮拱、intersect 裁剪、椭球大灯（scale）、10 辐条+5 螺栓阵列车轮、14 色调色板、115 个中文命名部件（含左右标注）。OCCT 内核下约 525ms / 7 万三角面完成全部布尔与网格化。

## 16. 大模型协作工作流

1. **直接用截图看图迭代**：`shot` 截取当前视图 → `fs.read`（1host=page）读回即图，平台自动落盘进消息可直接识图。每轮只做小改动（`fs edit` 改几处 → `run_file` 重跑 → `shot` + `fs.read` 自检），不再依赖用户截图中转；关键视觉确认（颜色/比例等主观项）仍可请用户过目。
1.5. **修模先定位再动手**：`parts_audit` 给出逐部件问题清单（水密/非流形/悬空/薄壁/干涉）——先看 `issues` 定位坏件/薄壁位置，再有针对性地改代码，不要全模型重写。
2. **打印质量你可直接判断**：`stats.printability` 的 watertight/openEdges/悬空面是你的打印反馈——交付打印模型前确认 `watertight: true`，否则按 §10 打印设计规范调整或提醒用户启用 OCCT 内核。
3. **复杂模型必须走文件流**：`fs write /3d/xxx.js`（1host=page）→ `run_file --path /3d/xxx.js` 执行；迭代用 `fs edit` 增量修改。代码存本地 /3d/ 可复用、可追溯，用户也能从页面「📂 文件」面板自行重载。
4. **部件命名规范**：中文名 + 左右标注（如 `前左轮胎`、`后视镜壳(右)`），用户在属性面板可按部件隔离/隐藏，命名清晰是可用性的一部分。
5. **run_code/run_file 结果可疑时**（如返回的统计与修改不符）：可能是页面断连后回放了上一帧缓存——先请用户刷新页面再重跑。
6. **规模参考**：精致展示模型 60~120 个部件为宜；布尔运算集中的部件（如 10 辐条 fuse）建议封进函数复用；整体三角面超过 100 万会触发警告，切 OCCT 内核通常可降 96%。

## 17. 参考图/Blender 复刻技法（金秋银杏案例沉淀）

> 用户给参考图/参考代码（如 Blender bpy 脚本）时，**几何层可全量复刻**，渲染层（Cycles 软阴影/AgX/SSS）
> 是 3d_maker 能力边界不可达。以下每一条都是从 Blender 代码逐行转译验证过的技法，参考图同场景直接套用。

### 17.1 参考代码转译三步法
1. **识别几何生成与渲染的部分**：Blender 脚本里 mesh/tube/ico/join 是几何（照抄逻辑）；
   lights/camera/Cycles/materials 是渲染（跳过，改用 §17.4 观感三件套）。
2. **单位换标**：Blender 米制（树 6.5m）→ 3d_maker 毫米（树 300mm）。**所有尺寸按比例换算**——
   Blender 里 `size=uniform(.12,.215)` 是米制绝对值，直接抄会出现 100 倍错误（叶片小到不可见）。
3. **逐条对照能力**：bpy 的 tube → `loft`；ico_sphere → `sphere`（低分段）+ `scale` 压扁；
   join+Remesh → 分叉处加**融合球**近似（无体素重构）；mesh.from_pydata → `meshFromVerts`（顶点/面全自控）。

### 17.2 有机/植物形态技法（树/花/珊瑚类通吃）
- **褶扇叶**（银杏/扇形叶）：中心柄点 + 两排扇形点（每排含凹口 `rr=frac*(1-.12*exp(-((a/.19)^2)))`
  + 褶皱 `z=.085*cos(j*pi)*frac + .10*frac²`），11-19 顶点/叶——比球/菱形片有叶形细节。
- **叶云分布**：高斯球 + `pow(rand(), .43)` 偏向外壳 → 压扁椭球（每冠 `sc=[sx,sy,sz]` 独立）；
  法线**偏球外+朝上**（`(v*.52, v*.52, .40+rand()*1.05)`）保证受光面朝相机。
- **树皮棱纹**：截面半径 `r*(1+.055*sin(i*5+k*.6))`——5 瓣起伏+沿轴向相位漂移，一行代码提升真实感。
- **分叉融合**：主干中段不同高度发枝（不是同一点），分叉点放**融合球**（缩放压扁）盖接缝。
- **颜色权重**：多色不均匀随机（如 7 色权重 [23,6,18,23,7,13,10]）→ 分桶 mesh 按权重采样，有主色节奏。

### 17.3 森林底座配比（隔离场景出片关键）
- 双层圆盘（深棕泥土 + 深橄榄苔藓毯）+ 50-60 个压扁苔藓垫（两色交替、随机分布、沉入地面）
- 石头：低分段球体**压扁**（1 : .72 : .57）+ **半埋**（中心在 0.15s 高度）+ 深灰绿——不要浮在地面的浅色圆球
- 草丛：5 顶点弯折剑形叶（基座两翼+折点+顶收窄），中环分布 30-55 丛，颜色苔绿
- 蘑菇（柄圆柱+伞压扁球）+ 地面落叶（呼应树冠），全部合并成少量 mesh 部件

### 17.4 观感三件套（无需改代码的“出片”调优）
1. **深色影棚**：`set_theme --theme dark`（背景 0x10131a、地面/网格变暗，模型从背景“跳”出来）
2. **暖金主光**：页面主光已调为暖白 0xffe2b8（金色/橙色模型最搭；冷色模型在 dark 下也成立）
3. **色板按目标作品取色**：参考图的颜色值（leafm 琥珀系/earth 深棕/moss 橄榄）直接抄，不要自己“调亮”

### 17.5 性能纪律（本次教训）
- **部件数 = DOM 数**：叶/草/苔藓等重复元素一律 `meshFromVerts` 按色合并（1-4 个部件），禁止逐件 addPart——
  1400 叶 = 160 万 DOM 节点直接卡死浏览器（页面部件面板/设计步骤都吃 DOM）。
- 大量元素合并后仍在 OCCT 限额内就切 OCCT；超限（>2 万三角面/开放网格）自动回退内置，不用管。
