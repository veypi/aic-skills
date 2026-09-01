# ppt.js — 零依赖、无样式（headless）的 HTML 幻灯片引擎

一个 ES module，把任何 DOM 容器变成幻灯片**查看器 / 演示器 / 编辑器主体**。
从 `slides/` 应用抽取核心能力重写：无框架、无构建步骤、无任何运行时依赖。
不含协作、版本管理与自我更新，无任何品牌标识。

**Headless 契约**：引擎只渲染三种模式的 *body*（edit = 缩略图栏 + 画布，
view = 缩放舞台 + 翻页，present = 全屏覆盖层），**不带工具栏、不注入任何
CSS、不向 window 挂载任何全局对象**。工具栏/按钮等 chrome 由引入方用编辑
API 自建，`.ppt-*` 样式由引入方样式表提供；幻灯片内容的样式与动画完全由
JSON 文档决定。

## 快速开始

```html
<div id="app" style="height:100vh"></div>
<script type="module">
  import PPT from './ppt.js'
  const ppt = new PPT('#app', {
    doc: myDoc,            // 文档对象或 JSON 字符串；省略则生成示例文档
    mode: 'edit',          // 'edit'（默认）| 'view' | 'present'
    onChange(doc) {        // 每次编辑提交后回调（持久化由宿主决定）
      localStorage.setItem('deck', JSON.stringify(doc))
    }
  })
</script>
```

引擎不注入样式。请引入一份覆盖 `.ppt-*` 钩子的样式表——
`ppt/stage.html` 的 `<style>` 块就是一份完整的参考实现（含全部布局、
选中框/手柄与 fx 动画关键帧），可直接拷贝或按需换肤。

## API

| 方法 | 说明 |
| --- | --- |
| `new PPT(target, opts)` | `target` 为选择器或元素；容器需有高度 |
| `ppt.getDoc()` | 深拷贝当前文档（可直接 `JSON.stringify`） |
| `ppt.setDoc(doc)` | 替换整个文档并重渲染 |
| `ppt.present(startIndex?)` | 进入全屏演示（Esc 退出） |
| `ppt.closePresent()` | 退出演示 |
| `ppt.setMode('edit'/'view'/'present')` | 切换模式 |
| `ppt.getState()` | 工具栏状态快照（见下） |
| `ppt.on(event, fn)` | 事件：`change`、`slidechange`、`statechange`、`presentclose`、`error` |
| `ppt.destroy()` | 销毁，释放监听 |
| `PPT.starterDoc()` | 生成一个空白起始文档 |

### 编辑 API（工具栏接口，edit 模式外调用为空操作）

| 方法 | 说明 |
| --- | --- |
| `insertText()` / `insertShape(kind)` | 插入文本 / 形状（`rect`、`ellipse`、`triangle`、`arrow`、`line`），居中放置并选中 |
| `insertImage(file)` | 插入图片（File/Blob，由宿主文件选择器提供）；经 `imageStore` 持久化，缺省回退 dataURL |
| `deleteSelected()` | 删除选中元素（多选时全部删除） |
| `setFill(color)` | 形状填充色（作用于所有选中形状） |
| `setTextColor(color)` / `setFontSize(n)` / `toggleBold()` / `setAlign(a)` | 文本样式（作用于所有选中文本） |
| `setSlideBackground(color)` | 当前页背景色 |
| `setTransition(name)` | 当前页过渡（`none/fade/slide/zoom/morph`） |
| `updateSelected(props)` | 通用元素补丁：样式键应用于全部选中，几何键（`x/y/w/h/rotation`）多选时仅应用于主选中；值为 `null` 时删除该键 |
| `updateSlide(props)` | 当前页补丁（`background/transition/name/stateOf/notes` 等） |
| `updateDocSize(w, h)` | 修改文档坐标系（240–4096） |
| `setZoom(z)` / `zoomIn()` / `zoomOut()` / `zoomReset()` | 画布缩放（相对适配比例，0.1–6；Ctrl/⌘ + `=`/`-`/`0`） |
| `goTo(±1)` | 线性翻页（键盘 `[` / `]`） |
| `addSlide()` / `duplicateSlide()` / `deleteSlide()` / `moveSlide(±1)` | 页操作；复制保留元素 id（驱动 morph） |
| `undo()` / `redo()` | 撤销 / 重做 |
| `togglePen()` | 钢笔模式：点击放锚点（拖拽出对称曲线手柄），点击首锚点闭合，Enter/双击完成，Esc 取消。双击既有 path 形状进入**贝塞尔编辑**：拖锚点/手柄（平滑锚自动镜像，Alt 打破对称/拉出新手柄），双击线段插锚（de Casteljau）、双击锚点删锚，Enter/点空白提交，Esc 取消（弧线 A 命令与非零旋转的路径暂不支持编辑） |
| `print()` | 打印/PDF 导出：隐藏 iframe 按文档像素尺寸逐页渲染（跳过 stateOf 状态页，保留背景与内嵌字体），调起浏览器打印对话框（选“另存为 PDF”） |
| `exportPptx(opts?)` | PowerPoint 导出：懒加载 vendored PptxGenJS（`./vendor/`，完全离线），text/shape/image/svg/table/chart 映射为 OOXML 元素，图片内嵌 base64、svg 栅格化，跳过 stateOf/broken 页，触发浏览器 .pptx 下载。引擎专属动效（morph/fx/悬停交互）无 OOXML 对应，不转换。返回 Promise<文件名> |

### 状态快照与事件

`getState()` 返回工具栏渲染所需的全部状态；`statechange` 事件在选中、翻页、
提交、撤销/重做、模式切换后推送同构快照：

```js
{ mode, presenting, current, count, background, transition,
  canUndo, canRedo, zoom, size: { width, height },
  slide: { id, name, stateOf, notes },
  slides: [{ id, name, index, hidden }],
  selection: null | { ...主选中元素深拷贝, fill, color, fontSize, bold, align,
                      _count, _ids } }   // _count > 1 为多选
```

### 画布交互（edit 模式）

单选/拖拽/八向缩放之外：

- **多选**：Shift+点击增减成员；空白处拖出**框选**（Shift 保留已选）；点击组内元素不拖动则收拢为单选；样式编辑应用于全部，几何编辑应用于主选中
- **旋转手柄**：单选框上方圆点，拖动绕中心旋转（Shift = 15° 步进）
- **对齐吸附**：拖动/缩放时自动吸附其他元素边缘/中心与页面边缘/中心，粉色参考线指示
- **缩放**：`setZoom` 系列 + Ctrl/⌘ 快捷键；放大后画布可滚动
- **键盘**：`F5` 从当前页演示、`[`/`]` 翻页、`Esc` 取消选择、`Delete` 删除、方向键微调（Shift×10）、Ctrl+Z/Y 撤销重做

## 三种模式

- **edit** — 缩略图栏 + 画布。选中/拖拽/八向缩放手柄、双击就地编辑文本、
  方向键微调（Shift×10）、Delete 删除元素、Ctrl+Z/Y 撤销重做。
  所有插入/样式/页操作经编辑 API 由宿主工具栏触发；图片插入经 `imageStore`
  钩子（`{put(file)→url, remove(url)}`）落到宿主存储，缺省回退 dataURL。
- **view** — 只读内嵌视图：缩放适配套件 + 上下页按钮（仅有的引擎内 chrome）。
- **present** — 全屏演示：方向键/空格翻页（**无限循环**：末页下一页回到首页、首页上一页跳到末页，stateOf 状态页始终跳过），Home/End 跳首尾，Esc 退出；
  鼠标点击不再翻页，只在元素设了 `link` 时跳转到对应幻灯片；
  **S** 开关演讲者视图（弹窗：计时/页码/备注/下一页），**B** 黑屏；
  悬停图表显示数据 tooltip（柱/线/散点按带区、饼图按角度）；
  `slide.hover` 支持 focus-group（悬停聚焦变暗）与 reveal（悬停显隐）交互；
  可选页码与进度条（`doc.present: { slideNumber: true, progress: true }`）。

## 文档格式

```jsonc
{
  "format": "ppt/1", "version": 1, "title": "…",
  "size": { "width": 960, "height": 540 },        // 幻灯片坐标系，自动缩放适配
  "theme": { "background": "#fff", "color": "#1f2430", "accent": "#3a6ff7",
             "fontFamily": "system-ui", "chartPalette": ["#3a6ff7", "…"] },
  "slides": [{
    "id": "s1", "background": "#0f1420",
    "transition": "morph",        // none | fade | slide | zoom | morph
    "notes": "",
    "elements": [ /* 见下 */ ]
  }]
}
```

元素公共字段：`id, x, y, w, h, rotation, opacity, shadow, blur, blend,
backdropFilter, fx, link, morphId, z`。类型：

| type | 关键字段 |
| --- | --- |
| `text` | `html`（白名单富文本：b/i/u/br/span…）、`fontSize`、`fontFamily`、`fontWeight`、`color`、`colorGradient`、`align`、`valign`、`lineHeight`、`letterSpacing`、`textStroke`、`placeholder` |
| `shape` | `shape: rect/ellipse/triangle/arrow/line/path`、`fill`、`fillGradient`、`stroke`、`strokeWidth`、`strokeStyle`、`radius`、`lineStart/lineEnd`（none/arrow/dot/bar）、`d`+`pathBox`（path） |
| `image` | `src`（dataURI/URL/`asset:key`）、`fit`、`radius` |
| `svg` | `markup` 或 `asset`、`css` |
| `table` | `columns`、`rows`、`header`、`style` |
| `chart` | `option`：ECharts 风格子集 `{xAxis:{data}, series:[{type:bar/line/scatter/pie, name, data}], color}`，静态 SVG 渲染 |
| `media` | `kind: video/audio`、`src`、`poster`、`autoplay`（仅演示时生效）、`loop`、`muted`、`controls` |

`doc.assets`（key → dataURI/SVG 字符串）与 `doc.fonts`（@font-face 注入）受支持。

## Morph 过渡

招牌特性：相邻幻灯片中 **`id`（或 `morphId`）相同的元素自动互相动画**。

- **几何全部来自模型**，不读 DOM——旧页即时切走，新页每个匹配元素以
  `transform: translate + rotate + scale`（左上角原点，PowerPoint 式：内容随框缩放而非重排）
  从旧帧飞到新帧，纯合成器动画，60fps；
- **0.65s / power2.inOut**（与参考实现同参数），rAF 驱动，可被下一次翻页随时取消；
- 颜色同样从模型插值：透明度、文字颜色、形状填充（纯色 ⇄ 纯色逐 RGBA 插值；
  渐变参与时逐 `<stop>` 插值并扫描渐变角度，纯色终点先织物化渐变再坍缩）；
- 未匹配的新元素 **fade + 上浮 14px** 进场，延迟到 morph 进行 40% 后按 0.03s/个错峰；
- **图表数据 morph**：同型图表逐数据点插值、逐帧重绘 SVG（柱状→柱状数据变化时柱子原地生长）；
  异型图表（柱状→饼图）在原位交叉淡化——几何直接在模型空间推进而非 transform 缩放，
  网格线与标签全程矢量清晰，结束处无重栅格化跳变；
- 所有 tween 在创建时同步应用起始帧，杜绝输入事件与首帧 rAF 之间的终态闪帧；
  旋转围绕元素中心插值，收尾帧与自然渲染逐像素一致；
- `stateOf` 隐藏态幻灯片跳过线性翻页、只能经 `link` 到达，到达后左箭头返回父页、右箭头继续主线；
- **层叠规则**：引擎不抬高 morph 元素，一律按文档顺序绘制（越靠后越在上层）；
  需要显式控制时用元素 `z` 字段（如焦点指示器置顶、背景粒子沉底），层叠设计由内容侧负责。
  仅演示模式下，非交互元素（无 `link`、非 chart/media、无 `group`）`pointer-events: none`——装饰与 morph 形状不遮挡下层图表悬停与链接点击；编辑/查看模式所有元素始终可命中（点选与拖拽依赖之）。

编辑器里“复制幻灯片”会保留元素 id，因此“复制→重排→播放”即可得到设计好的转场。

morph 转场页同样执行 `fx.countUp` 与 `fx.ambient`（一次性 kenburns 延迟 0.9s、无限 drift 延迟 1.25s，均在飞行/入场编排落定后启动，避免 WAAPI transform 覆盖 morph 飞行）；`fx.enter` 只在非 morph 转场与首次显示时播放（morph 自带未匹配元素 fade+rise 错峰编排）。

图表自带默认入场动画（无需 fx，仅演示模式）：柱状从基线逐根生长、折线描边后数据点弹入、散点弹入、饼图切片依次弹入；morph 匹配（同 id）的图表除外——它们播放数据 morph。

## 分页拆分

`slides` 数组的元素可以是**字符串**——相对文档文件的分页引用（与图片相对引用同理），也可以是页面对象，两者可混用：

```jsonc
// index.json
{
  "format": "ppt/1", "version": 1, "title": "…",
  "size": { "width": 1280, "height": 720 }, "theme": { … },
  "slides": ["slides/slide_1.json", "slides/slide_2.json"]
}
```

每个分页文件是一页完整定义（id/transition/notes/elements）。宿主在加载文档时按引用逐个拉取组装（vhtml 版页面的 `resolveSlideRefs`），保存时拆分结构自动保留。字符串与对象可混用。

加载与保存的健壮性：

- **单页容错**：某个分页文件缺失（404）或 JSON 非法时不再拖垮整稿——该页以 ⚠ 错误占位页载入（缩略图与画布均有标记），演示/打印/页码统计自动跳过、链接不可达；编辑模式可直接删除该页。保存时占位页不写文件、原引用字符串回写，补写文件后重新打开即恢复。
- **增量保存**：自动保存按「序列化内容快照比对」逐页增量写盘——改哪页写哪页，未变的分页不落盘；index.json 仅在文档结构（页序/增删页/元信息）变化时写入；删页导致的失效分页文件仅在结构变化时清理。

## 入场动画

`fx: { enter: 'fade-up' | 'fade' | 'fade-down' | 'slide-left/right/up/down',
enterDur, order, countUp }`，`order` 按 80ms 步进错开；`countUp: true` 让文本中的
数字从 0 滚动到终值；`fx.ambient: 'kenburns'` 提供图片缓慢推拉，可用
`fx.ken: { dir: 'drift'|'out'|'in', scale, duration }` 调参（drift 往返、out 由远及近定格、
in 由近及远）。入场动画关键帧由宿主样式表提供（见 `ppt/stage.html`），Ken-burns
用 WAAPI 驱动。悬停交互：`slide.hover: { type: 'focus-group', dim }` 或
`{ type: 'reveal', default }`，配合元素 `group` / `showOnHover`。

文本 HTML 中的 `{{page}}`、`{{pages}}`、`{{title}}` 模板字段（含 `{{page:2}}` 零填充）会在渲染时解析。

## 明确不包含

协作/同步（CRDT、relay、E2EE）、版本历史、自更新与签名、品牌标识、
批注、**工具栏与样式表**。
持久化完全交给宿主的 `onChange`。

## 文件

本目录既是独立的 `ppt.js` 引擎，也是 agent 自定义页面的资源：

```
ui/
├── index.html       PPT Studio 主页面（vhtml）：顶栏 + 工具栏 + 舞台 + 右侧切换式侧栏（AI 对话 / 属性 双 tab）
├── langs.json       面板双语文案 zh-CN / en-US（env.js 自动加载，$t() 引用）
├── ppt/
│   ├── ppt.js       幻灯片引擎（ESM，export default PPT；零 CSS、零全局挂载）
│   ├── stage.html   <ppt-stage> 组件：import 引擎、$data 持有实例、宿主样式表
│   ├── toolbar.html <ppt-toolbar> 组件：编辑工具栏（:st 状态 + :side-tab 侧栏 tab + @cmd 意图）
│   ├── panel.html   <ppt-panel> 组件：右侧属性面板（幻灯片/元素/动画/文本/形状/图片）
│   └── vendor/      PptxGenJS + jszip ESM 离线包（exportPptx 懒加载，勿手动改动）
├── cases/           内置样例库：cases.json 清单 + <id>/index.json + <id>/slides/*.json（分页拆分，只读；也兼容旧的单文件 <id>/<id>.json）
└── README.md
```

## vhtml 版（skill 操控面）

`index.html` 是 skill 页面（`/skills/ppt_studio/ui/index.html`）：顶栏（样例/文件/模式/演示）

- 编辑工具栏（`<ppt-toolbar>`，仅 edit 模式显示）+ PPT 舞台（`<ppt-stage>`）+ 右侧
属性面板（`<ppt-panel>`，仅 edit 模式显示）。要点：

- **初始加载优先级**：上次打开的本地文件（localStorage `ppt_last_open`）→ 本地最近
  修改的 PPT → 默认样例。顶栏「✦ 样例」「📁 文件」弹层分别切换样例、列出本地 PPT。
- **本地文档**：存放在页面本地存储 `/ppt/<名称>/index.json`，编辑后 1.2s 防抖自动
  保存（写入串行化防乱序覆盖）；AI 经 fs 工具（1host=page）读写同一路径，页面指令
  经 pageDesc 声明（`ppt_*`），平台自动注册。
- **工具栏数据流**：引擎 `statechange` → stage `$emit` → 页面 `st` → 工具栏 `:st`
  渲染；工具栏 `@cmd` 意图 → 页面中转为 stage 命令式调用。导出两种：`exportPptx`
  （引擎内置，vendored PptxGenJS 离线生成 .pptx 下载）与 `print()`（浏览器打印
  另存 PDF）；不支持导入/上传。
- **图片不内嵌 base64**：编辑器经 `imageStore` 钩子把图片上传到 `<名称>/image/`，
  json 里存相对路径（`image/xxx.png`）；渲染时经 `$mod.$cloud_fs.fsPrefix` 解析为 HTTP URL，
  保存时还原。删除图片元素 / 删除页会同步删除对应图片文件。
- **样例只读**：页面不会自动保存对样例的编辑；点顶栏「存入会话」显式转为会话文件后可编辑保存。
- **文件删除**：「📁 文件」弹层每项 ✕ 删除整个目录（json + `image/`），不可恢复。
- **双语**：面板与工具栏文案在 `langs.json`（zh-CN / en-US），经 `$t()` 引用，语言跟随全局 header。

双向交互：AI 直接用 fs 工具读写会话目录下的 json 完成内容编辑；页面操作经
`page_exec` 指令（`list_ppt / open_ppt / open_case / run_ppt [--start] / stop_ppt /
new_ppt / save_ppt / get_ppt [--full] / set_mode / delete_ppt`），由 AI 用 `exec 1host=page`
调用，路径参数为全局 UFS 路径（`sessions/{sid}/...`）。指令声明见 agent 的 `index.md`。
