---
name: video_studio
nickname: 视频工坊
description: 浏览器内一站式视频制作：AI 文件驱动编辑 + 可视化舞台/时间轴，真实 3D 场景、关键帧动画、逐字弹簧、素材拖拽剪辑、AI 配音（TTS），WebCodecs 硬编直接导出 MP4
keywords: [video, 视频, 剪辑, 动画, 3D, MP4, 配音, TTS, 时间轴, WebCodecs]
icon: fa-solid fa-clapperboard
ui:
  - path: index.html
    desc: 主工作台（场景列表 + 舞台 + 属性面板 + 时间轴 + 素材）
---

# Video Studio · 视频制作

浏览器端视频工作台：左侧场景列表 + 中间舞台（点选/拖拽/双击改字）+ 右侧属性面板 + 底部时间轴，全部编辑实时保存，浏览器内直接导出 MP4（WebCodecs 硬编，无需后端渲染、无需 ffmpeg）。核心工作模式是**文件驱动**：项目是 `video/1` JSON 文档，AI 负责撰写/修改文档内容，页面负责预览播放与可视化编辑。

## 打开与操控

1. 打开页面：`open {url_prefix}/index`（`url_prefix` = skill 列表返回的包前缀，形如 `/skills/local/video_studio`，勿硬编码）
2. 探测指令：`exec 1host=page {win_id}.list`（返回全部 `*_video` / `gen_voice` / `run_js` 指令清单）
3. 项目文件读写：用 **fs 工具（1host=page）** 直接读写 `/video/...` 路径（与页面同一浏览器本地存储）
4. 页面操作（新建/打开/播放/重载/截图/配音）走 `exec 1host=page {win_id}.<cmd>`，argv 形如 `["--name","my-video"]`

## 项目存储：浏览器本地（OPFS 单根，纯本地不依赖会话）

项目文件存储在**浏览器本地 OPFS**（本地根 `/video/{项目名}/`）——不进云端、不依赖 session、换机器/换浏览器不跟随。

- 每个项目一个目录：`index.json`（video/1 文档，含全部场景，默认单一文件；场景多时可拆分，见下文「场景子 json」）
- 素材（图片/音频）放 `assets/` 子目录，文档中 `src` 写**相对路径**（如 `assets/bg.mp3`、`assets/logo.png`）；左侧「素材」tab 可查看/上传/删除素材——**拖拽素材到中间舞台（落点插入）或底部时间轴（插入当前场景中心），或双击素材**即可直接生成元素（图片→image、视频→media video、音频→media audio）；单击素材项复制相对引用路径
- 导出由**用户点击顶部「导出」按钮**完成（弹层可选：格式 MP4(H.264+AAC) / WebM(VP9+Opus) / WebM(VP8+Opus) / WAV(仅音频)，分辨率 原始/1080p/720p/480p/自定义，帧率 原始/24/25/30/60，质量 低/中/高；产物自动存 `/video/exports/{标题}.{扩展名}` 并触发浏览器下载；AI 不触发导出）
- 外部素材可尝试 `exec 1host=page curl -o /video/{项目}/assets/... <url>` 下载，但**受浏览器 CORS 限制经常失败**（页面 fetch 非白名单域会被浏览器拦截）——失败时不要反复重试，改为**把下载链接发给用户，让用户自行下载后通过左侧「素材」tab 上传**（页面会保留文件名存入 `assets/`）

## 典型工作流

用户说「做一个关于 X 的视频」：

1. 构思：脚本 → 场景划分（每个场景 3~6 秒）→ 每场景元素（文字/形状/图片/图表）+ 动画（入场 fx / 关键帧 keyframes）
2. `{win_id}.new_video --name x-主题 --title "标题"` 创建项目
3. 读写项目文件用**标准 fs 工具**（1host=page）：`fs.read {"1host":"page","path":"/video/x-主题/index.json"}` 读骨架 → `fs.write` 写完整文档（JSON 用 2 空格缩进展开）
4. 改完 `index.json` 或素材后调 `{win_id}.reload_video` 让页面刷新画面（保持当前帧）
5. 需要配图/配乐：先尝试 page curl 下载（CORS 经常失败）；失败则把素材链接发给用户请其下载后上传「素材」tab——上传完成后 AI 写相对路径引用（`assets/封面.png`），再 `reload_video` 刷新画面
6. `{win_id}.run_video --name x-主题` 预览播放
7. 删除文件/项目：`fs.rm`（本地文件操作）；清理项目用 `fs.rm` 删 `/video/{name}` 目录
8. 完成：提醒用户点击页面顶部「导出」按钮自行导出（导出由用户操作，AI 不触发）

用户说「来个样例看看」：`{win_id}.list_video` 查看样例清单，告知用户点页面上的「样例」即可（样例只读，用户可在页面右侧「另存为项目」后手动编辑）。

## pageDesc 指令（exec 1host=page {win_id}.{cmd}）

指令仅在用户打开 Video Studio 页面时响应。成功返回 `{ok:true,...}`，失败 `{ok:false,error}`。

### list_video — 项目列表

无参数。返回 `{ ok, current, current_title, files: [{name,title,duration,scenes}], cases: [{id,title,desc}] }`。

### new_video — 新建项目

| argv | 说明 |
|---|---|
| `--name <名称>` | 项目名（非法字符自动转 `-`），必填 |
| `--title <标题>` | 可选，默认同 name |
| `--width/--height` | 可选，分辨率（≥240），默认 1280×720 |

返回 `{ ok, name, path, scenes, duration }`。创建后页面自动打开。

### open_video — 打开项目

| argv | 说明 |
|---|---|
| `--name <名称>` | 必填 |

### reload_video — 重新加载当前项目

无参数。AI 用 fs 工具写完 `index.json`/素材后调用，页面刷新画面并保持当前帧。返回 `{ ok, name, title }`。

### gen_voice — 文本转语音配音（AI 自动配音）

| argv | 说明 |
|---|---|
| `--text <文本>` | 待合成语音文本，必填（≤5000 字） |
| `--name <文件名>` | 可选，输出文件名（默认 `voice-xxx`；自动带格式后缀，超长自动截断 60 字符） |
| `--set voice\|music` | 可选，生成后自动配置到配音轨/背景音乐轨 |

调用平台包级 TTS 接口（`POST {url_prefix}/api/speech`，按文本 hash 缓存，限流约 3s/个），音频保存到项目 `assets/` 并立即可用（素材面板可见、可拖入舞台）。`--set voice` 时自动写入 `doc.voice = {src, volume:1, offset:0}`（页面播放/导出自动混入）。返回 `{ ok, ref, name, size, duration, track }`（duration 为音频时长秒，如 3.44，可据此设 voice.offset 对齐画面）。

### run_video / stop_video — 预览播放 / 停止

`run_video` 可选 `--name`（先打开再播放）。

### shot_video — 截图当前画面（AI 查看某一帧）

| argv | 说明 |
|---|---|
| `--frame <帧号>` | 可选，指定帧（默认当前帧） |
| `--name <文件名>` | 可选，输出文件名（默认 `{标题}-f{帧号}.png`） |
| `--scale <倍率>` | 可选，分辨率倍率 0.25~2（默认 1 = 文档分辨率） |

复用导出管线（确定性 DOM → canvas）截取指定帧为 PNG，保存到 `/video/screenshots/`（不移动播放头）。返回 `{ ok, path, frame, width, height, size }`；用 `fs.read`（1host=page，路径 `/video/screenshots/...`）查看画面。注意：动画入场起点（如 frame 0）元素可能未显现，截关键帧建议指定 `--frame`。

### run_js — 纯数值计算（动画曲线 / 3D 建模参数）

| argv | 说明 |
|---|---|
| `--code <代码>` | 必填，JS 表达式/IIFE（如 `(() => {...})()`）或语句体（最后 `return`） |

软沙箱执行：仅 `Math` + `M` 数学包 + `T` three.js 核心数学几何 + `console`/`copy`，无 DOM/网络/存储/定时器/构造器。

- `M` 包：`TAU`、`lerp(a,b,t)`、`clamp(v,a,b)`、`smoothstep(a,b,v)`、`map(v,a,b,c,d)`、`deg`、`rad`、`round(v,n)`、`range(n,a,b)`（均分数组）、`rand(seed)`（可复现种子随机）、`easing`、`easingOf(name)`、`bezier(x1,y1,x2,y2)→fn`、`spring(d,s,m)→fn`、`interpolate(v,[a,b],[c,d],{easing})`
- `T` 包（three r170 纯计算类，无渲染器）：`Vector2/3/4`、`Matrix3/4`、`Quaternion`、`Euler`、`Color`、`Spherical/Cylindrical`、`CatmullRomCurve3`、`SplineCurve`、`CurvePath`、`Path`、`Shape`、`BufferGeometry` 与 `Box/Sphere/TorusKnot/Tube/Lathe/Extrude/Shape` 等 Geometry 类、`MathUtils`——几何体的顶点数据经 `geometry.attributes.position.array` / `toJSON()` 取出；建模辅助：`T.surfaceMesh(fn,[u0,u1,segU],[v0,v1,segV])`（参数曲面采样 → geo json `{positions,index}`）与 `T.geoPack(bufferGeometry)`（任意几何体 → geo json），产物 `fs.write` 到项目 `assets/` 后供 three 元素 `geo` 类型引用（见下文 three 元素说明）

返回 `{ ok, result, result_type, logs, copied }`（`console.log` 收进 `logs`，`copy(v)` 写系统剪贴板）。

典型用法：动画设计时先算好 SVG path / 关键帧数组 / 曲线采样 / 参数化 3D 顶点，再用 `fs.write` 写进 index.json 或项目 `assets/`（Klein 瓶/利萨茹/文字路径/管状网格等参数化图形）。

### get_video — 当前打开项目信息

返回 `{ ok, open, name, title, duration, fps, size, scenes }`。

## video/1 文档格式要点

```jsonc
{
  "format": "video/1", "version": 1, "title": "标题",
  "size": { "width": 1280, "height": 720 }, "fps": 30,
  "theme": { "background": "#0f1420", "color": "#f5f7fa", "accent": "#3a6ff7",
             "fontFamily": "system-ui, ...", "captionStyle": { "fontSize": 38, "color": "#fff", "stroke": "#000" } },
  "music": { "src": "assets/bg.mp3", "volume": 0.3, "loop": true, "offset": 0 },   // 可选背景音乐
  "voice": { "src": "assets/voice.mp3", "volume": 1, "offset": 0 },                // 可选配音轨
  "overlay": [ /* 可选全局覆盖层（HUD）：元素以全片时间为基准渲染于所有场景之上 */ ],
  "scenes": [{
    "id": "s1", "duration": 4,                    // 秒，视频时间轴核心
    "transition": "fade",                          // 进入转场: none|fade|slide-left|slide-right|slide-up|slide-down|zoom|iris
    "transitionIn": 0.6,                           // 转场时长秒
    "background": "#0f1420",                       // 可省略；支持 CSS 渐变字符串
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

**场景子 json（拆分存档）**：`scenes` 数组元素可以是**字符串**（相对 index.json 的场景文件路径，如 `scenes/scene_1.json`），也可以是场景对象，两者可混用。页面加载时按引用逐个拉取组装为内存对象；保存时**拆分结构自动保留**（编辑器新增/复制场景自动分配 `scenes/scene_N.json`，删场景后失效文件自动清理）。

```jsonc
// index.json —— 只留元信息 + 引用数组，体积极小
{ "format": "video/1", "title": "…", "size": …, "fps": 30, "theme": …, "music": …,
  "scenes": ["scenes/scene_1.json", "scenes/scene_2.json", "scenes/scene_3.json"] }
// scenes/scene_1.json —— 单个场景完整定义（id/duration/transition/elements 等）
{ "id": "s1", "duration": 4, "transition": "fade", "elements": [ … ] }
```

使用建议：场景少（≤5）或元素轻量时用内联对象单文件；场景多、单场景元素重（如 showreel 样例 518+ 元素）时拆分，**改某一场景只需读写对应的 `scenes/scene_N.json`，不必动 index.json**。素材仍放 `assets/`（相对 index.json 引用，不是相对场景子文件）。

元素公共字段：`id`（场景内唯一）、`x/y/w/h`（文档坐标系）、`rotation`、`opacity`、`z`（层叠，缺省按数组顺序）、`origin`（transform-origin，如 `"bottom"` 柱图从底生长）、`blur`（CSS 模糊 px，柔光/光斑）。**时间窗（Sequence 语义）**：`start`（场景内开始秒，缺省 0）、`dur`（可见窗口秒数，缺省 0=到场景尾）、`hidden`（隐藏不渲染，时间轴眼睛开关）——窗口内动画/关键帧/媒体源都以窗口相对时间求值，拖窗口即整体平移动画；overlay 元素以全片时间为容器。

| type | 关键字段 |
|---|---|
| `text` | `html`、`fontSize`、`fontWeight`、`color`、`align`、`valign`、`lineHeight`、`letterSpacing`、`colorGradient`、`textStroke`、`fx.countUp`（数字滚动） |
| `shape` | `shape`: rect/ellipse/triangle/arrow/line、`fill`、`fillGradient`、`stroke`、`strokeWidth`、`radius`、`direction`(arrow) |
| `image` | `src`（相对路径）、`fit`（contain/cover）、`radius` |
| `svg` | `markup` 或 `asset` |
| `table` | `columns`、`rows`、`header`、`style` |
| `chart` | `option`：`{xAxis:{data}, series:[{type:bar/line/scatter/pie, data}], color}` |
| `media` | `kind`: video/audio、`src`、`loop`、`muted`。**基本剪辑**：`start`（场景内开始秒）、`trimStart`/`trimEnd`（源裁剪入/出点，`trimEnd:-1`=源全长）——预览播放时真实播放（stage overlay，遵守裁剪窗口），拖动/导出按裁剪帧定位；导出把 video 当前帧合成进画面（不是黑框），未静音媒体（含视频原声）按裁剪窗口混入音轨；audio 元素预览显示为绿色音频 chip（导出无视觉）。不要写 `controls/autoplay`（确定性帧渲染忽略） |
| `three` | `scene`：声明式 3D 场景（vendored three.js r170，WebGL 逐帧确定性渲染） |

`three` 元素 scene 描述（速度单位 rad/s，Remotion 的 rad/frame × 30）：

```jsonc
{ "id": "tk", "type": "three", "x": 0, "y": 0, "w": 1920, "h": 1080,
  "scene": {
    "camera": { "position": [0, 0, 7.6], "fov": 45 },
    "lights": [ { "type": "ambient", "intensity": 0.55 },
                { "type": "directional", "position": [6, 6, 6], "intensity": 1.15 },
                { "type": "point", "position": [-5, -3, 4], "intensity": 60, "color": "#FFC24B" } ],
    "group": { "rotation": [0, 0.12, 0] },          // 整组旋转
    "objects": [
      { "type": "torusKnot", "args": [1.25, 0.4, 240, 32],
        "material": { "kind": "standard", "color": "#FFC24B", "metalness": 0.65, "roughness": 0.22 },
        "rotation": [0.18, 0.27, 0.09] },
      { "type": "icosahedron", "args": [2.75, 1],
        "material": { "kind": "basic", "color": "#4ECDC4", "wireframe": true, "opacity": 0.32 },
        "rotation": [-0.09, -0.15, 0], "scalePulse": { "amp": 0.05, "speed": 1.5 } },
      { "type": "orbiters", "count": 10, "radius": 3.35, "speed": 0.9,
        "yWave": { "freq": 1.7, "amp": 0.9 },
        "sizes": [0.09, 0.135, 0.18], "colors": ["#FF6B57", "#4ECDC4"], "emissiveIntensity": 0.55 }
    ] } }
```

单体几何：`torusKnot` / `icosahedron` / `sphere` / `box`（args 透传 three 构造函数）；
material `kind: standard|basic`，支持 `color/metalness/roughness/wireframe/opacity/emissive/emissiveIntensity`；
动画字段：`rotation`（rad/s）、`scalePulse{amp,speed}`、`position`、`scale`；`orbiters` 为群组轨道卫星。

**参数曲面 parametric**：`{ "type": "parametric", "eq": "(u,v)=>[x,y,z]", "u0":0, "u1":6.283, "v0":0, "v1":6.283, "segU":48, "segV":24, "material": {...} }`——按参数方程采样生成网格（u/v 默认 [0, 2π]），自动计算法线、双面渲染。例：克莱因瓶 `eq: "(u,v)=>{const R=2.2;const w=R+Math.cos(u/2)*Math.sin(v)-Math.sin(u/2)*Math.sin(2*v);return [w*Math.cos(u),w*Math.sin(u),Math.sin(u/2)*Math.sin(v)+Math.cos(u/2)*Math.sin(2*v)]}"`。eq 只注入 `Math`（无 DOM/网络），适合利萨茹/环面/波形/螺旋等可解析曲面。

**自定义网格 geo**：`{ "type": "geo", "src": "assets/xxx.geo.json", "material": {...} }`——渲染预计算的网格数据（或内联 `data` 字段）。geo json 格式：`{ "positions": [x,y,z,...], "index": [i0,i1,i2,...], "uvs": [u,v,...]?, "normals": [...]? }`（缺法线引擎自动 computeVertexNormals）。数据用 `run_js` 的 `T.surfaceMesh(fn,[u0,u1,segU],[v0,v1,segV])` 或 `T.geoPack(bufferGeometry)` 生成后 `fs.write` 到项目 `assets/`，**写完必须调 `reload_video`**（资产 dataURL 与几何缓存需要重载预热）。

元素本身的 keyframes/fx（透明度/缩放入场等）照常作用于外层 div。预览直接挂活 canvas（无每帧 dataURL 开销）；
导出由 render.js 将 WebGL canvas 按几何合成到目标画布（foreignObject 无法序列化 WebGL 位图）。

**全局覆盖层 `overlay`**（HUD）：与场景元素同构的元素数组，渲染于场景内容之上、字幕之下，`pointer-events:none`（舞台点选穿透）。与场景元素的唯一区别是**时间基准为全片**（keyframes/fx/countUp 按全片秒数驱动；`fx.exit` 在全片结尾触发；`kfLoop` 跨全片循环）。适合做：帧计数器、全片进度条、常驻角标水印、开场黑渐隐。

**文本模板字段**（html 内插值，预览/导出逐帧求值）：

| 写法 | 含义 |
|---|---|
| `{{page}}` / `{{page:2}}` | 当前场景序号（可补零宽度） |
| `{{pages}}` / `{{title}}` | 场景总数 / 文档标题 |
| `{{frame}}` / `{{frame:4}}` | 全片帧号（如 `F {{frame:4}}` → `F 0263`） |
| `{{time}}` / `{{time:2}}` | 全片秒数（小数位数，左补零 → `T+{{time:2}}s` → `T+08.77s`） |
| `{{progress}}` / `{{sprogress}}` | 全片 / 场景进度 0-100 整数百分比 |
| `{{sframe}}` / `{{stime:2}}` | 场景内帧号 / 秒数 |

**动画能力（勿超范围）**：

- **入场** `fx.enter`: `fade` / `fade-up` / `fade-down` / `slide-left` / `slide-right` / `slide-up` / `slide-down` / `zoom` / `zoom-in` / `none`，配 `enterDur`（默认 0.6s）、`delay`（默认 0）、`enterEasing`（默认 `bezier(0.16,1,0.3,1)`，可换 `spring` 或其它缓动）
- **退场** `fx.exit`: `fade-out` / `fade-up` / `slide-left` / `slide-right` / `zoom-out` / `none`，配 `exitDur`（默认 0.5s）、`exitEasing`（默认 `bezier(0.7,0,0.84,0)`），在场景结尾播放
- **关键帧** `keyframes`: `[{t, x?, y?, scale?, scaleY?, rotation?, opacity?}]`，t 为场景内秒，**x/y 为画面绝对坐标**；`scaleY` 独立纵向缩放（缺省跟随 scale，配合 `origin: "bottom"` 做柱图生长）；每段支持 `easing`（命名缓动或参数化 `spring(damping,stiffness,mass)`、`bezier(x1,y1,x2,y2)`）
- **真实弹簧** `spring(d,s,m)`：欠阻尼物理解，过冲回弹（如 `spring(13,170,0.9)` 逐字弹簧、`spring(9,180,1)` 弹跳小球）；命名 `spring` = `spring(10,100,1)`
- **逐字 stagger**：文本元素加 `stagger: { by: 'char'|'word', step, delay, dur, dy, dx, rotation, scaleFrom, easing }`（纯文本专用，不能含 html 标签）——每字以弹簧从 dy/rotation 过渡到原位，Showreel 标志性逐字入场
- **循环环境动画**：元素加 `kfLoop: true`，关键帧时间取模循环（漂移/走马灯/粒子）
- **描边生长**：svg 元素加 `draw: { dur, delay, easing }`（对 markup 内所有 path 做 dashoffset 生长）；折线图表 `option.draw`（秒）同理且采样点随进度逐个出现
- **数字滚动** `fx.countUp: true`（配 `countUpDur`，默认 1.2s）：文本中数字 token 从 0 滚到终值
- **转场** `transition`: 进入场景时的整体动画（内容滑入/缩放 + 背景交叉淡入淡出）

## 制作规范

1. **场景时长**：每场景 3~6 秒为宜；全片一般 8~60 秒（导出性能与时长线性相关）
2. **先读后改**：修改前先 `fs.read`（1host=page，路径 `/video/{项目名}/index.json`）了解现状；不确定项目名先 `list_video`
3. **坐标合理**：基于 `size` 布局，避免元素越界；文字框给足高度（fontSize 64 标题至少 h=100）；`align/valign` 配合居中
4. **动画克制的**：同屏 2~4 个入场动画即可，`delay` 错峰（0.3~0.5s 间隔）；关键帧运动轨迹明确、有终点
5. **字幕**：口语化短句，与画面内容对应；不要整屏字幕
6. **素材**：图片/音频放 `assets/` 并写相对路径；禁止 base64 大体积进 JSON；外部素材优先尝试 page curl 下载，**浏览器 CORS 限制下经常失败**——失败即停止重试，直接把链接给用户让其下载后上传到左侧「素材」tab（上传保留原始文件名，重名自动 -1/-2），AI 写引用时用真实文件名；不要引用外链 URL（离线失效）
7. **写完即所见**：`fs.write` 写 index.json 后调 `reload_video` 刷新画面（保持当前帧）；用 `run_video` 播放确认效果，播放后提醒用户可再次点击播放/暂停
8. **结果反馈**：操作完成后一两句话向用户总结（时长、场景数、效果亮点）；完成后提醒用户可点顶部「导出」自行导出（可选 MP4/WebM/WAV 与分辨率/帧率/质量）

## 常见问题

- 用户没打开页面时指令会超时/无响应：先 `open {url_prefix}/index` 打开页面，再重试
- 导出需要最新版 Chrome/Edge（WebCodecs）：不支持时向用户说明
- 导出分辨率建议 ≤1280×720（更高会明显变慢）；单视频建议 ≤60 秒
- 视频剪辑：拖入素材后，时间轴出现绿色剪辑块——**左缘拖切入、右缘拖切出（同步源出点）、块体拖动改开始时间**；所有元素都有时间窗（开始/时长，inspector 或时间轴拖拽）；入点/出点（trimStart/trimEnd）是媒体专属的源裁剪。预览播放时视频真实播放（变速/倒放时按帧定位显示）。时间轴是多轨道视图：场景组（可折叠/眼睛隐藏）+ 元素轨 + overlay 轨 + 音乐/配音轨，左栏眼睛开关元素可见性（hidden，预览/导出都不渲染）
