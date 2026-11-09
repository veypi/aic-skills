# video_studio/1 格式参考

项目是 `.video_studio` JSON 主存档，`format` 为 `video_studio/1`。主文件与所有资源均可经 `$fs` 位于云端、页面或设备；资源只使用主文件目录内的相对路径。AI 撰写/修改文档，页面预览与可视化编辑。本文是字段契约；制作方法论见 `pipeline.md` / `aesthetic-rules.md` / `shots/`。

## 文档骨架

```jsonc
{
  "format": "video_studio/1", "version": 1, "title": "标题",
  "size": { "width": 1280, "height": 720 }, "fps": 30,
  "theme": { "background": "#0f1420", "color": "#f5f7fa", "accent": "#3a6ff7",
             "fontFamily": "system-ui, ...", "captionStyle": { "fontSize": 38, "color": "#fff", "stroke": "#000" } },
  "music": { "src": "assets/bg.mp3", "volume": 0.3, "loop": true, "offset": 0 },   // 可选背景音乐
  "sfx": [ /* 声明式音效表，见下文 */ ],
  "overlay": [ /* 可选全局覆盖层（HUD）：元素以全片时间为基准渲染于所有场景之上 */ ],
  "scenes": [{
    "id": "s1", "duration": 4,                    // 秒，视频时间轴核心
    "transition": "fade",                          // 进入转场: none|fade|slide-left|slide-right|slide-up|slide-down|zoom|iris
    "transitionIn": 0.6,                           // 转场时长秒
    "background": "#0f1420",                       // 可省略；支持 CSS 渐变字符串
    "camera": { /* 场景运镜，见下文 */ },
    "voice": { "src": "assets/voice-s1.mp3", "volume": 1, "offset": 0.2 },  // 本幕旁白；offset 为场景内秒
    "captions": [{ "start": 0.8, "end": 3.4, "text": "字幕内容" }],  // 相对场景起点（秒）
    "elements": [
      { "id": "t1", "type": "text", "x": 80, "y": 100, "w": 1120, "h": 120,
        "html": "标题文字",                          // 白名单富文本 <b><i><u><br><span>
        "fontSize": 64, "fontWeight": 700, "color": "#fff",
        "align": "center", "valign": "middle",
        "fx": { "enter": "fade-up", "enterDur": 0.8, "delay": 0.5,     // 入场
                "exit": "fade-out", "exitDur": 0.4 } },               // 退场（可选）
      { "id": "r1", "type": "shape", "shape": "rect", "x": 80, "y": 260, "w": 400, "h": 200,
        "fill": "#3a6ff7", "radius": 16,
        "keyframes": [ { "t": 0, "x": 80, "opacity": 0 },              // 关键帧（场景内秒）
                        { "t": 2, "x": 400, "opacity": 1 } ] },
      { "id": "im1", "type": "image", "src": "assets/logo.png", "x": 40, "y": 40, "w": 200, "h": 80 }
    ]
  }]
}
```

## 场景运镜 camera（1.1.0）

作用于场景内容层（字幕与 overlay 不受运镜影响），预览/导出/截图三链路一致，media/three 元素同步随运镜合成。

```jsonc
"camera": {
  "keyframes": [
    { "t": 0,   "zoom": 1 },                                   // 全景
    { "t": 0.9, "zoom": 0.97, "easing": "easeOut" },           // 预备回拉（先退后冲）
    { "t": 1.1, "zoom": 2.3, "focus": [640, 300], "easing": "easeIn" },  // 急推锁定
    { "t": 1.28,"zoom": 2.15, "focus": [640, 300], "easing": "easeOut" },// 过冲回收
    { "t": 4,   "zoom": 2.15, "focus": [640, 300] }            // 特写 hold
  ],
  "shakes": [ { "t": 1.1, "amp": 10, "decay": 0.06, "dur": 0.25, "freq": 25 } ]
}
```

| 字段 | 语义 |
|---|---|
| `keyframes[].t` | 场景内秒；按 t 排序，段间缓动取前帧 `easing`（缺省 easeInOut） |
| `zoom` | 缩放，缺省 1；>1 推近。绕画面中心 |
| `focus: [px,py]` | 便利字段：把该文档坐标点推到画面中心（自动换算 x/y，含旋转补偿）；与 x/y 二选一 |
| `x` / `y` | 内容层平移（文档像素），缺省 0 |
| `rotation` | 内容层旋转（度），缺省 0 |
| `easing` | 命名缓动 / `spring(d,s,m)` / `bezier(x1,y1,x2,y2)` |
| `shakes[]` | 确定性衰减震屏：`t` 触发秒、`amp` 幅度 px、`decay` 衰减常数 s（缺省 0.06）、`dur` 持续 s（缺省 0.3）、`freq` Hz（缺省 25） |

规则：运镜管时机与视线，不做逐拍画面泵（aesthetic-rules R4）；急推全片 ≤2 次；震屏只给撞停/重击，amp 8–14px（>20 读作故障）。inspector 场景页有「慢推近/急推/横移」预设与 JSON 编辑。

## 声明式音效表 sfx（1.1.0）

全片秒钉帧的音效清单，预览播放触发、导出混入音轨、时间轴可拖拽改钉帧。

```jsonc
"sfx": [
  { "id": "sfx-1", "src": "assets/whoosh.mp3", "t": 1.1, "volume": 0.5, "dur": 0.4, "note": "S2 卡片急推到位" },
  { "id": "sfx-2", "src": "assets/impact.mp3", "t": 1.12, "volume": 0.6, "note": "S2 撞停震屏" }
]
```

| 字段 | 语义 |
|---|---|
| `t` | 全片秒（钉帧）；时间轴拖动即改此值 |
| `volume` | 乘法系数，缺省 1；轻音素材可 >1，以听感为准 |
| `dur` | 播放窗口秒，0/缺省 = 源全长；拟音裁到与动作严格等长 |
| `srcOffset` | 源内入点秒（缺省 0） |
| `note` | 对应画面动作注释（必填习惯，S2 判例：杜绝凭感觉铺音效） |

素材放 `assets/`；选材与对齐方法论见 `sound-design.md`。

## 场景子 json（拆分存档）

`scenes` 数组元素可以是**字符串**（相对主 `.video_studio` 的场景文件路径，如 `scenes/scene_1.json`），也可以是场景对象，两者可混用。页面加载时按引用逐个拉取组装；保存时拆分结构自动保留（新增/复制场景自动分配 `scenes/scene_N.json`，删场景后失效文件自动清理）。

```jsonc
// demo.video_studio —— 只留元信息 + 引用数组
{ "format": "video_studio/1", "title": "…", "size": …, "fps": 30, "theme": …, "music": …, "sfx": […],
  "scenes": ["scenes/scene_1.json", "scenes/scene_2.json"] }
// scenes/scene_1.json —— 单个场景完整定义（id/duration/camera/elements 等）
{ "id": "s1", "duration": 4, "transition": "fade", "camera": {…}, "elements": [ … ] }
```

场景少（≤5）或元素轻量时内联单文件；场景多、单场景元素重时拆分——改某一场景只需读写对应子文件。素材仍放 `assets/`（相对主存档引用）。禁止绝对路径、`..`、外部 URL 和大体积 base64；迁移时复制主文件所在的整个项目目录。

## 元素

公共字段：`id`（场景内唯一）、`x/y/w/h`（文档坐标系）、`rotation`、`opacity`、`z`（层叠，缺省按数组顺序）、`origin`（transform-origin，如 `"bottom"` 柱图从底生长）、`blur`（CSS 模糊 px）。

**时间窗（Sequence 语义）**：`start`（容器内开始秒，缺省 0）、`dur`（窗口秒数，缺省 0=到容器尾）、`hidden`（隐藏不渲染）——窗口内动画/关键帧/媒体源以窗口相对时间求值，拖窗口即整体平移动画；overlay 元素以全片时间为容器。

| type | 关键字段 |
|---|---|
| `text` | `html`、`fontSize`、`fontWeight`、`color`、`align`、`valign`、`lineHeight`、`letterSpacing`、`colorGradient`、`textStroke`、`fx.countUp`、`reveal`、`stagger` |
| `shape` | `shape`: rect/ellipse/triangle/arrow/line、`fill`、`fillGradient`、`stroke`、`strokeWidth`、`radius`、`direction`(arrow) |
| `image` | `src`（相对路径）、`fit`（contain/cover）、`radius` |
| `svg` | `markup` 或 `asset`；`draw` 描边生长 |
| `table` | `columns`、`rows`、`header`、`style` |
| `chart` | `option`：`{xAxis:{data}, series:[{type:bar/line/scatter/pie, data}], color}`；折线 `option.draw` 生长 |
| `media` | `kind`: video/audio、`src`、`loop`、`muted`、`start`、`trimStart`/`trimEnd`（源裁剪，-1=全长）。预览真实播放，导出按裁剪帧合成+混音；audio 预览为绿色 chip，导出无视觉。不写 controls/autoplay |
| `three` | `scene`：声明式 3D 场景（vendored three r170，WebGL 逐帧确定性渲染） |

**文本对齐契约**：`align` 管水平，`valign` 管垂直（默认顶端）。要放进圆环、按钮或卡片中心的文字必须同时写 `align:"center"` 与 `valign:"middle"`，并检查文字框中心是否与主体中心一致；只有外框 `x/w` 居中不代表实际字形居中。多行标题与附属线/说明文字应共用同一中心线或左轴线，复合图标按实际文字位置留间距（Q12）。轨道标签使用独立元素绑定各槽位，不用 `<br>` 空行撑垂直位置（Q13）。

### 文字质感件（1.1.0）

**遮罩揭示 `reveal`**（text 专用）：外层裁剪、内层从掩体后滑入——出版级字卡入场。

```jsonc
{ "type": "text", "html": "Product Name", "reveal": { "dur": 0.7, "delay": 0, "dir": "up", "easing": "bezier(0.16,1,0.3,1)" } }
// dir: up|down|left|right = 内容滑入方向
```

**单点扫光 `sheen`**（除 media/three 外均可）：一道渐变光带划过元素表面，自动被 overflow/圆角裁剪。**一个镜头最多给主角一次，不群发**（Q4）。

```jsonc
{ "type": "shape", "shape": "rect", "radius": 16, "sheen": { "t": 1.2, "dur": 0.9, "angle": 20, "color": "rgba(255,255,255,0.35)", "width": 0.35 } }
// t=场景内触发秒；width=光带宽占元素宽比例
```

**马克笔 highlight**：html 内 span 样式白名单已含 `background-color`/`border-radius`/`padding`：

```jsonc
{ "html": "让研究<span style=\"background-color:#ffe58a;border-radius:4px;padding:0 6px\">自动发生</span>" }
```

### 动画能力（勿超范围）

- **入场** `fx.enter`: fade / fade-up / fade-down / slide-left / slide-right / slide-up / slide-down / zoom / zoom-in / none，配 `enterDur`（默认 0.6s）、`delay`、`enterEasing`（默认 `bezier(0.16,1,0.3,1)`）
- **退场** `fx.exit`: fade-out / fade-up / slide-left / slide-right / zoom-out / none，配 `exitDur`（默认 0.5s）、`exitEasing`，场景结尾播放
- **关键帧** `keyframes`: `[{t, x?, y?, scale?, scaleY?, rotation?, opacity?, blur?}]`，t 为窗口相对秒，x/y 为画面绝对坐标，blur 为 CSS 模糊 px；每段 `easing`（命名 / `spring(d,s,m)` / `bezier(...)`）。虚焦入场时 y/opacity/blur 必须共用同一段缓动
- **真实弹簧** `spring(d,s,m)`：欠阻尼物理解，过冲回弹（`spring(13,170,0.9)` 逐字弹簧）
- **逐字 stagger**：`stagger: { by:'char'|'word', step, delay, dur, dy, dx, rotation, scaleFrom, easing }`（纯文本，不含 html 标签）
- **循环环境动画**：`kfLoop: true` 关键帧取模循环（漂移/走马灯/瀑布墙）
- **描边生长**：svg `draw: {dur, delay, easing}`；折线图表 `option.draw`
- **数字滚动**：`fx.countUp: true`（配 `countUpDur`，默认 1.2s）
- **转场** `transition`：进入场景的整体动画（内容滑入/缩放 + 背景交叉淡入淡出）

### three 元素

`scene` 描述（速度单位 rad/s）：

```jsonc
{ "id": "tk", "type": "three", "x": 0, "y": 0, "w": 1920, "h": 1080,
  "scene": {
    "camera": { "position": [0, 0, 7.6], "fov": 45 },
    "lights": [ { "type": "ambient", "intensity": 0.55 },
                { "type": "directional", "position": [6, 6, 6], "intensity": 1.15 },
                { "type": "point", "position": [-5, -3, 4], "intensity": 60, "color": "#FFC24B" } ],
    "group": { "rotation": [0, 0.12, 0] },
    "objects": [
      { "type": "torusKnot", "args": [1.25, 0.4, 240, 32],
        "material": { "kind": "standard", "color": "#FFC24B", "metalness": 0.65, "roughness": 0.22 },
        "rotation": [0.18, 0.27, 0.09] },
      { "type": "orbiters", "count": 10, "radius": 3.35, "speed": 0.9,
        "yWave": { "freq": 1.7, "amp": 0.9 }, "sizes": [0.09, 0.135, 0.18], "colors": ["#FF6B57", "#4ECDC4"] }
    ] } }
```

单体几何 torusKnot/icosahedron/sphere/box（args 透传）；material kind standard|basic（color/metalness/roughness/wireframe/opacity/emissive）；动画 rotation(rad/s)/scalePulse/position/scale；orbiters 群组卫星。

**相机朝向**：设置 `scene.camera.position` 后，引擎自动 `lookAt(0,0,0)`；侧机位的默认构图中心就是世界原点。主体与主几何应围绕原点布局，不要为补偿视角再手挪元素外框。参数曲面的 `u0/u1/v0/v1` 要与方程实际周期一致，并检查几何本身的中心是否也在原点；最终必须截帧确认主体完整、无边缘裁切。

- **参数曲面**：`{ "type": "parametric", "eq": "(u,v)=>[x,y,z]", "u0":0, "u1":6.283, "v0":0, "v1":6.283, "segU":48, "segV":24, "material": {...} }`（eq 只注入 Math）
- **自定义网格**：`{ "type": "geo", "src": "assets/xxx.geo.json", "material": {...} }`；geo json = `{positions, index, uvs?, normals?}`；用 `run_js` 的 `T.surfaceMesh` / `T.geoPack` 生成后 fs.write 到 assets/，**写完必须 reload_video**

### 全局覆盖层 overlay

与场景元素同构，渲染于场景之上、字幕之下，pointer-events:none。**时间基准为全片**。适合：帧计数器、进度条、水印、开场黑渐隐、白闪帧。

### 文本模板字段（html 内插值）

| 写法 | 含义 |
|---|---|
| `{{page}}` / `{{page:2}}` | 当前场景序号（可补零） |
| `{{pages}}` / `{{title}}` | 场景总数 / 文档标题 |
| `{{frame}}` / `{{frame:4}}` | 全片帧号 |
| `{{time}}` / `{{time:2}}` | 全片秒数（左补零） |
| `{{progress}}` / `{{sprogress}}` | 全片 / 场景进度 0-100 |
| `{{sframe}}` / `{{stime:2}}` | 场景内帧号 / 秒数 |

## 节拍分析产物 beats.json（1.1.0）

`analyze_music --src assets/bgm.mp3` 写入项目根（可用 fs 工具读）：

```jsonc
{ "src": "assets/bgm.mp3", "bpm": 124.0, "beatOffset": 0.08, "beatPeriod": 0.4839,
  "duration": 32.5, "beats": [0.08, 0.564, …],          // 拍点网格（秒）
  "onsets": [{ "t": 0.08, "strength": 1 }, …],           // 真实瞬态（稀疏重音钉这些）
  "confidence": 0.82 }                                    // 网格通量覆盖率；<0.3 人工核对
```

分镜时把关键切点/动效触发写成 beats/onsets 里的真实秒数（换算场景内 t）。卡拍管时机不放大幅度：全画面级冲击全片 ≤3 处（R4）。