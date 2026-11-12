---
name: ppt_studio
version: 1.0.8
nickname: PPT 工坊
description: 幻灯片工作室：以本地 /ppt/ JSON 文件驱动的方式创建、编辑、预览与全屏演示 PPT，支持逐页语音讲解脚本
keywords: [ppt, slides, 幻灯片, 演示, 演讲, 讲解, deck, 演示文稿]
icon: fa-solid fa-person-chalkboard
---

# PPT Studio 操控手册

## 是什么

幻灯片工作台：零依赖 headless 引擎（ppt.js）+ 内置样例 + 本地 `/ppt/` 文件存储。
页面负责渲染、编辑、预览与全屏演示；**内容由你直接读写 JSON 文件完成**，不经过指令传大段内容。

## 操作方式

1. 打开页面：page exec 中 `const opened = await open({url: '/skills/cloud/{skill_id}'})`（`skill_id` 取自 skill 列表；`url_prefix` 同前缀，用于资源与 API）
2. 探测指令：使用 `open` 返回的 `events` 查看 `ppt_*`；需要重新查看时 `return await commands()`
3. 内容创建/修改：用 **fs 工具（_host=page）** 直接读写 `/ppt/...` 路径（与页面同一本地存储）：
   - 每套 PPT 一个目录，核心文件固定 `index.json`，如 `/ppt/产品发布会/index.json`
   - 页数多时用分页拆分：`slides` 数组写相对引用字符串（如 `"slides/slide_1.json"`），每页一个 `slides/slide_N.json`（**推荐**，改一页只动一个文件）
   - JSON 一律 2 空格缩进展开，方便后续按行阅读与 edit 精确修改
   - 图片：元素 `src` 写**相对 json 的路径**（如 `image/cover.png`，放同级 `image/` 子目录）；也支持 http(s) URL、dataURI 与 `svg` 元素内联 markup。**禁止 base64 大体积图片内嵌**；无云→页二进制搬运通道，网络配图直接用 URL 引用或 svg 示意
4. 页面操作（打开、播放、状态查询）在 `exec _host=page` 的 async JS 函数体里走 `win(opened.win_id).command(data)`，例如 `await win(opened.win_id).ppt_open({path: '/ppt/x/index.json'})`
5. 写完文件页面**不会自动感知**：调用 `ppt_open`（刷新打开）或 `ppt_run`（播放）让页面更新

典型流程（用户说「做一个关于 X 的 PPT」）：

1. （可选）`web` 搜索核实关键数据与事实，引用真实数据，不要编造数字
2. fs 写入 `/ppt/x-主题/index.json`（≤12 页，推荐分页拆分）
3. `await win(opened.win_id).ppt_run({path: '/ppt/x-主题/index.json'})` 播放展示，或 `ppt_open({path})` 仅在编辑态打开
4. 一两句话向用户总结；播放后提醒用户按 Esc 退出

修改现有 PPT：fs 读取对应 json → 修改 → fs 写回 → `ppt_open`（若它正是当前文档，调用后页面即刷新）。
用户说「来个样例」：`ppt_case({id?})` 让样例出现在页面，再 `ppt_run()` 播放。

内置样例（cases）：静态模板，位于包内 `ui/cases/`（清单 `ui/cases/cases.json`）。
样例**只读**——页面不会自动保存对样例的编辑。要持久化：用户在页面点「存入本地」按钮，或你 fs 读样例 json → 修改 → 写入 `/ppt/` → `ppt_open`。
**不要用 fs 写包内样例路径**修改样例。

## 指令表

handler 接收 `(data, ctx)` 并直接返回原生对象；失败抛出带原因的 `Error`。AI 用 `win(id).command(data)` 调用。页码字段 `index` 从 **1** 开始，数组直接作为数组传入，不再序列化为命令行 JSON 字符串。

| 指令 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- |
| `ppt_status` | 页面与当前文档状态（**唯一在未就绪时也可调用**） | 无 | `{ok, ready, mode, presenting, current, current_kind, current_case, title, slide_count}` |
| `ppt_list` | 列出 `/ppt/` 下 PPT 文件与内置样例 | 无 | `{ok, current, current_kind, current_case, files:[{path,size,mod_time}], cases:[{id,title,desc,slides,default}]}`；`current_kind` = `session`（本地文件）/ `case`（样例） |
| `ppt_open` | 打开 `/ppt/` 下指定文档（成为当前文档，编辑态） | `{path}`（限 `/ppt/` 根下） | `{ok, path, title, slide_count}` |
| `ppt_case` | 打开内置样例（只读模板） | `{id?}`，省略=默认样例 | `{ok, id, title, slide_count}` |
| `ppt_run` | 全屏演示 / 演讲模式 | `{path?, index?, script?}`；index 仅无 script 时使用；script 是讲解脚本数组 | `{ok, presenting, start, total, path}`；带 script 时额外 `{script, voiced, skipped}` |
| `ppt_stop` | 退出全屏演示 | 无 | `{ok, presenting:false}` |
| `ppt_new` | 新建空白 PPT（`{name}/index.json` 拆分结构，创建后立即打开） | `{name, title?}` | `{ok, path, slide_count}` |
| `ppt_delete` | 删除文档所在**整个目录**（含 json 与 `image/`，**不可恢复**） | `{path}`，传目录内任一文件 | `{ok, deleted}`；删的是当前文档则自动打开另一个或回落默认样例 |
| `ppt_save` | 立即保存当前文档（样例则先复制为本地文件再保存） | 无 | `{ok, path, forked?}` |
| `ppt_get` | 当前文档信息 | `{full?}`；full:true 返回完整文档（assets 剥离为 key 列表） | `{ok, path, kind, title, size, slide_count, slides:[每页摘要]}`；读内容优先直接 fs 读 json |
| `ppt_mode` | 切换页面模式 | `{mode: 'edit' \| 'view'}` | `{ok, mode}` |

### 演讲脚本（ppt_run 的 script 字段）

对象数组，**数组顺序即演讲顺序**，支持错序跳页（如 1→3→2）。每项：

- 带 `voice`：语音讲解（跳页 + 播音，播完自然进下一项）
- 不带 `voice`：纯展示（只跳页，停留 `stay` 毫秒，默认 2000）
- 页面定位优先 `id`（稳定，重排不漂移），兼容 `index`（1 基）

```js
return await win(opened.win_id).ppt_run({
  path: '/ppt/产品发布会/index.json',
  script: [
    {id: 'slide-1', voice: '欢迎观看，首先看背景'},
    {id: 'slide-2'},
    {id: 'slide-3', voice: '这里是重点数据，增长显著'},
    {id: 'slide-4', stay: 5000},
  ],
})
```

语音流水线：带 voice 的项按序合成（TTS 限流 3s/个，串行节流），第一个合成完即可开播，逐项播放；
某项失败该项停留 `stay` 毫秒后继续，**不中断演讲**、不重试整段；找不到的页记入 `skipped` 跳过。
讲解词口语化、1~3 句为宜。演示中快捷键：方向键/空格翻页，Home/End 跳首尾，**S** 演讲者视图，**B** 黑屏，Esc 退出。

## 事件契约

- 页面在 setup 块声明 `pageDesc = {desc, commands}`，AI 经 `win(id).ppt_*(data)` 调用，页面**不内置 ai-box**
- 所有指令直接返回 `{ok, ...}` 等业务对象；失败抛出明确错误
- 页面未就绪（引擎初始化中）时，除 `ppt_status` 外一律抛错；可先查 `ppt_status.ready`
- 路径安全：`ppt_open/ppt_delete` 仅允许 `/ppt/` 根下，含 `..` 拒绝
- 文件监听：你经 fs 写文件后页面**不会自动刷新**，必须 `ppt_open` / `ppt_run`；反过来页面内编辑由 1.2s 防抖自动保存回 `/ppt/`，你 fs 读到的即为最新内容

## 工作规则

1. **先读后改**：修改前先 fs 读取目标 json；不确定有哪些文件先 `ppt_list`
2. **控制体积**：每套 ≤12 页；页数多或单页元素多时分页拆分（`index.json` + `slides/`）；图片走独立文件/URL/svg，不 base64
3. **坐标合理**：基于文档 `size`（建议 1280×720）布局，避免越界重叠；文字框给足高度（fontSize 64 标题至少 h=90）
4. **写完即所见**：fs 写文件后调用 `ppt_open`（刷新）或 `ppt_run`（播放）
5. **结果反馈**：操作完成一两句话总结；播放后提醒用户 Esc 退出
6. 页面调用超时或抛错时，向用户说明原因并提示确认页面已打开；用户没开页面时不要强行调用，先发页面链接

## ppt/1 文档格式要点

纯 JSON，坐标系基于 `doc.size`，元素绝对坐标摆放：

```jsonc
{
  "format": "ppt/1", "version": 1, "title": "标题",
  "size": { "width": 1280, "height": 720 },
  "theme": { "background": "#fff", "color": "#1f2430", "accent": "#3a6ff7", "fontFamily": "system-ui" },
  "slides": [{
    "id": "s1",
    "background": "#0f1420",         // 可省略
    "transition": "fade",            // none | fade | slide | zoom | morph
    "elements": [
      { "id": "t1", "type": "text", "x": 80, "y": 100, "w": 1120, "h": 120,
        "html": "标题文字",            // 白名单富文本 <b><i><u><br><span>
        "fontSize": 64, "fontWeight": 700, "color": "#fff",
        "align": "center", "valign": "top", "lineHeight": 1.2 },
      { "id": "r1", "type": "shape", "shape": "rect", "x": 80, "y": 260, "w": 400, "h": 200,
        "fill": "#3a6ff7", "radius": 16 }
    ]
  }]
}
```

元素公共字段：`id`（必须唯一）、`x/y/w/h`、`rotation`、`opacity`、`z`（显式层叠，省略按文档顺序）、`link`（点击跳指定页 id）。

| type | 关键字段 |
| --- | --- |
| `text` | `html`、`fontSize`、`fontFamily`、`fontWeight`、`color`、`align`、`valign`、`lineHeight` |
| `shape` | `shape`: rect/ellipse/triangle/arrow/line/path、`fill`、`fillGradient`、`stroke`、`strokeWidth`、`radius` |
| `image` | `src`（相对路径/URL/dataURI）、`fit`、`radius` |
| `svg` | `markup` |
| `table` | `columns`、`rows`、`header`、`style` |
| `chart` | `option`：ECharts 风格子集 `{xAxis:{data}, series:[{type:bar/line/scatter/pie, name, data}], color}` |

**层叠顺序**：元素按数组顺序绘制，越靠后越在上层；引擎不抬高 morph 元素。装饰性 morph 元素放数组前部沉底，焦点指示类放末尾置顶，或用 `z` 字段突破。

## 动画能力（引擎实际支持集，勿超范围）

- **入场**：元素 `fx: {"enter": "fade|fade-up|fade-down|slide-left|slide-right|slide-up|slide-down", "order": N, "enterDur": 秒}`；`order` 按 80ms 步进错峰。`fx.enter` 在非 morph 转场与首次显示时播放
- **数字滚动**：文本元素 `fx.countUp: true`——数字 token 从 0 滚到终值（支持小数/千分位）
- **环境动效**：`fx.ambient: "kenburns"` + `fx.ken: {"dir": "drift|out|in", "scale": 1.15, "duration": 20}`
- **页间 morph**：相邻页同 `id`（或同 `morphId`）元素自动插值几何/颜色/渐变；同 id 图表自动数据 morph（bar⇄line⇄pie⇄scatter）
- **隐藏状态页**：页 `stateOf: "<父页id>"`（可配 `name`）：不参与线性翻页，经元素 `link` 到达；状态页 ← 返回父页、→ 回主线
- **悬停交互**：页级 `hover: {"type": "focus-group", "dim": 0.22}` + 元素 `group`（悬停某组其余变暗）；或 `hover: {"type": "reveal", "default": "组名"}` + 元素 `showOnHover`。仅演示时生效
- **模板字段**：文本 html 中 `{{page}}`、`{{pages}}`、`{{title}}`（支持 `{{page:2}}` 零填充），页码不计状态页
- **演讲者备注**：页级 `notes`，演示时按 S 的演讲者视图可见

## Morph 编排理念（默认遵循）

Morph 是**视觉重点引导**，不是装饰。每个 morph 元素必须能回答「它把观众视线带到哪」：

1. **标题必 morph**：每页主标题固定 id（如 `fx-title`）跨页连续形变，作叙事锚点
2. **引导值 2~4 个**：全片固定 2~4 个（推荐 3 个）引导形状（`mg-a`/`mg-b`/`mg-c`），每页核心内容收敛到同等数量并一一对应；焦点少时多余形状退化为边框/角落装饰（变浅、变透明或变小），焦点多时只落在最重要的 2~4 项
3. **每次 morph 至少变两样**：形状、大小、颜色至少同时变两项，叠加位置移动；**禁止纯位置平移**
4. **背景与页码不参与 morph**：常驻元素同 id 同坐标保持静止，否则每页独立 id

相邻页同 `id` 元素自动 morph——「复制一页再重排元素」即可做出流畅转场。

## 给用户演示（引导脚本）

用户问「这个怎么用」时，在 page exec 里跑下面这段：单窗口逐步聚光，讲完自动清场。
窗口 id 必须从 `open()` 返回值取（`win_id`）。

```js
const sleep = ms => new Promise(r => setTimeout(r, ms))
const demo = (await open({url: '/skills/cloud/ppt_studio'})).win_id
// 四个面板开关默认全关：0=幻灯片列表 1=编辑工具 2=属性 3=缩放
const panel = async (index) => {
  try { await click({win_id: demo, selector: '.panel-switches button', index}); await sleep(300) } catch (_) {}
}
const steps = [
  {sel: '.topbar',         title: '顶栏',     desc: '编辑 / 预览切换、✦ 样例、📁 文件、▶ 演示'},
  {sel: '.panel-switches', title: '面板开关', desc: '幻灯片列表 / 编辑工具 / 属性 / 缩放，默认全关'},
  {sel: '.stage-box',      title: '舞台',     desc: '当前页编辑区；演示时就是全屏画面'},
  {before: () => panel(0), after: () => panel(0), sel: '.ppt-thumbs',    title: '幻灯片列表', desc: '缩略图切页、拖拽排序'},
  {before: () => panel(1), after: () => panel(1), sel: 'ppt-toolbar',    title: '编辑工具',   desc: '插元素、对齐、层级与样式'},
  {before: () => panel(2), after: () => panel(2), sel: '.side-pane',     title: '属性面板',   desc: '选中元素的几何、样式与动画参数'},
  {before: () => panel(3), after: () => panel(3), sel: '.stage-cluster', title: '缩放控件',   desc: '缩放与复位（Ctrl +/-）'},
]
for (const s of steps) {
  if (s.before) await s.before()
  await highlight({win_id: demo, selector: s.sel, title: s.title, desc: s.desc, wait: 3000})
  await sleep(1600)
  await highlight({win_id: demo, clear: true})
  if (s.after) await s.after()   // 标注完立即收起，别挡住舞台
}

// 演示（ppt_run 全屏）不在引导脚本里做：全屏会抢走用户屏幕，需要时单独用指令演示
return {win_id: demo, steps: steps.length}
```

- 样例：`ppt_list` 列出（默认 `agents`·12 页，另有 `k3` 17 页 / `qwen3.8` / `weekly-report`），`ppt_case({id})` 打开；页面启动时自动打开默认样例
- `.ppt-thumbs` / `ppt-toolbar` / `.side-pane` / `.stage-cluster` 默认隐藏：直接 `highlight` 会报 `is not visible`，必须先 `click` 顶栏 `.panel-switches button`（0~3）
- **每个面板开 → 标 → 立刻关**，否则会盖住舞台
- 引导脚本**不要自动进全屏演示**（`ppt_run` 会夺屏）；用户明确要求时再调，`ppt_stop` 退出
- `.side-pane` 需 `mode==='edit'`；`ppt-toolbar` 还需 `stage_ready`
