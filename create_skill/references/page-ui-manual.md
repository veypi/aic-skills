# 技能界面手册（ui/ 与 pageDesc）

> 本手册覆盖「技能页面」的特有内容：包页面平台集成、pageDesc 指令完全规格、布局响应式、样式规范、常见坑。
> vhtml 组件语言的完整语法（绑定、组件、路由、生命周期全契约）请看 **vhtml 技能**：`skills search 'vhtml'` 找到条目 → `skills load <其 id>`（本地已有 vhtml 目录则直接 `load vhtml`）。
> 本包内参考：`examples/hello`（最小页面 + 指令）、`examples/todo_min`（页面 + 数据）、`examples/notes`（文件驱动）。

## 1. 页面形态与文件位置

- `ui/` 下放任意 HTML；frontmatter 的 `ui` 清单登记页面：`[{path: index.html, desc: ...}]`；缺省入口 `index.html`。
- 平台按内容分流两种渲染形态：
  - **含 `<script setup>` → vhtml 组件**（推荐）：响应式、scoped 样式、生命周期全语义、**可获得 pageDesc 指令通道**。
  - **普通 HTML → iframe 隔离渲染**：独立文档、平台运行时不可达、**无指令通道**（需要 AI 交互就用 vhtml 形态）。
- 页面地址由平台直路由，技能只画页面、零路由代码：`/skills/{scope}/{ref}/{页面名}`（缺省 `index`）。
- **必须是完整 HTML 文档**（`<!DOCTYPE html>` + `html/head/body`）。裸 `<template>` / `<style>` 开头的片段会"静默不挂载"，并伴随一个指向包目录 URL 的误导性 404——见到这个报错先怀疑文档结构。

## 2. vhtml 速览（最小可用心智）

```html
<!DOCTYPE html>
<html>
  <head><title>Demo</title></head>
  <style>
    body { height: 100%; }        /* body = 组件宿主节点（满高链路） */
    .title { font-weight: 700; }  /* 样式自动 scoped 到本组件子树 */
  </style>
  <body>
    <div class="title">{{ title }}</div>
    <input v:value="draft" @keyup.enter="submit()" />
    <button @click="submit()">提交</button>
    <div v-for="item in items">{{ item.name }}</div>

    <script setup>
      // 裸赋值 = 注册到 $data（模板可见）；const/let/function = 私有局部
      title = 'Demo'
      draft = ''
      items = []                    // 列表变量先初始化空数组
      submit = () => { items.push({ name: draft }); draft = '' }
    </script>
  </body>
</html>
```

**script 块类型**（同一文件可并存，跨块共享必须走 `$data` 或 import）：

| 块 | 时点 | 用途 |
| --- | --- | --- |
| `<script setup>` | 实例创建、DOM 编译前 | 声明状态/函数/pageDesc；**禁止访问 DOM / `$refs`** |
| `<script>` | 挂载完成（子树编译 + 进文档） | 初始数据加载（fetch 后赋值） |
| `<script active>` / `<script deactive>` | 每次激活/失去激活 | 定时刷新、可见性响应（`$reason` 区分） |
| `<script dispose>` | 销毁 | 清理定时器/观察器（`$watch`/`addCleanup` 自动清理） |

细节坑：v-for **没有 `:key`**（写了也是无效属性，删掉）；`v-if` 各分支表达式都会求值，跨分支变量保持同类型（别在 null 与数组间漂移）；改动嵌套对象要走响应式路径（别用持有的原始引用）。

## 3. pageDesc 完全规格（核心）

### 声明

`<script setup>` 内裸赋值声明（与其它 `$data` 一样）：

```js
pageDesc = {
  desc: '待办清单页面',                     // 必填：string，窗口列表可见
  commands: [
    {
      name: 'todo_status',                  // 必填：非空 string，建议带前缀防冲突
      desc: '待办统计',                      // 一句话（list/commands 展示）
      help: '无参数。返回 {ok,total,done}',  // 强烈建议：调用示例与参数说明
      handler: () => reply({ ok: true }),   // 必填：函数 (argv, ctx) => 结果
    },
  ],
}
```

**硬校验（不满足 = 平台整体忽略该 pageDesc，events 表现为空）**：必须是对象；`desc` 是 string；`commands` 是数组；每条命令有非空 `name` 与函数 `handler`。

### handler 契约

- `argv`：字符串数组——`exec` 传入的原始参数（`--title 买牛奶` → `['--title','买牛奶']`）。自己解析（示例都带一个 `argsGet/argVal` 小助手）。
- `ctx`：`{sessionId, agentId, ...}`——执行方身份，服务端注入不可伪造；可做权限判定（如"当前会话才能改我的画布"）。
- **返回**：字符串，或 `{content: string, attrs?: object}`。结构化数据用 `JSON.stringify`；`content` 就是 AI 看到的工具结果。
- **错误**：抛 `Error` → AI 收到错误响应（消息里写清原因）；不要把失败藏成 `{ok:false}` 当成功返回（可以两者都给：结构化 + ok 字段）。
- `hidden: true`：指令可执行但不在 `list`/`commands` 发现面展示（平台/进阶用法）。

### 采集与更新

- 打开窗口后约 0.5s 采集；**动态更新 = 整体替换 `pageDesc` 对象**（推荐）——原地改 commands 数组也会在下次采集生效，但不如整体替换可靠。
- 指令是**窗口级命名空间**：`{win_id}.{cmd}`；同一页面开两个窗口互不干扰。

### 命名与指令集设计

- 前缀防冲突：页面 `todo_`、技能 `drawio_`；避开平台根命令 `list / open / close / reload / curl`。
- 每个页面至少一条 `status`（返回 ready/数据量/关键状态）——AI 自测与排障的锚点。
- 参数一律 `--flag <值>`；**长内容不进 argv**（传文件路径 / ID，页面自己经数据面或 `$fs` 取）。
- 破坏性操作明确命名（`clear_/delete_`），help 里写警告与影响面。
- 让指令幂等（重复执行无副作用），或明确在 help 里说明非幂等。

## 4. AI 调用流程（探测与调用）

```
open {url_prefix}/index        # 开窗
list                            # win_id | title | ... | events ← 指令名清单
{win_id}.todo_status            # 调用
{win_id}.todo_add --title "买牛奶" --priority 2
```

- 全量命令（含 desc/help）也可用 `commands` 查看。
- 报错语义：win_id 过期 → `window "x" not found (run list to refresh)`（重跑 list）；命令不存在 → `command "x" not found on window "y"`（先看 events）。
- handler 里的异步代码抛错会作为错误响应返回；耗时操作保持快节奏（先返回"已受理"，再让 AI 用 status 轮询）。

## 5. 布局与响应式

页面跑在 OS 窗口里，**窗口宽度 ≠ 视口宽度**——响应式用 `@container`：

```css
body { height: 100%; margin: 0; container-type: inline-size; }   /* 做容器上下文 */
@container (max-width: 720px) { .side { display: none; } }        /* 按窗口宽度切换 */
```

- 满高：`body { height: 100% }`（平台窗口 frame 已保证链路）。
- 工具栏 + 内容骨架：`body { display:flex; flex-direction:column }`、内容区 `flex:1; overflow:auto`（见 todo_min 示例）。
- 画布/棋盘类要精确像素时：`ResizeObserver` 观察 `$node`，用 JS 算尺寸；位图分辨率固定、指针坐标按缩放比换算。

## 6. 样式规范（视觉统一）

平台基调：**轻量工作面板**——简洁、克制、信息密度中高、无重装饰。技能页面与平台本地应用保持同一视觉体系：**一切颜色/圆角/间距/字号用平台设计 token（CSS 变量）**，页面自动适配亮/暗主题。

### 6.1 设计 token（技能页面直接可用）

技能页面是 vhtml 组件、编译进平台同一文档——平台 `global.css` 的 token 直接可用（无需引入任何样式文件）：

**颜色（语义）**：

| token | 用途 |
| --- | --- |
| `--color-primary`（+`-hover`/`-active`） | 主操作：主按钮、链接、选中态、强调文字 |
| `--color-primary-text` | 主色实底上的文字色 |
| `--color-secondary`（+`-hover`/`-active`） | 次操作 |
| `--color-info` / `--color-success` / `--color-warning` / `--color-danger`（danger 另有 `-hover`） | 反馈色 |
| `--bg-color` | 页面底色 |
| `--bg-color-secondary` | 卡片/面板面 |
| `--bg-color-tertiary` | 弱面：控件底、分区、徽标底 |
| `--text-color`（+`-secondary`/`-tertiary`/`-disabled`/`-inverse`） | 正文 / 次要 / 弱化 / 禁用 / 反色 |
| `--border-color`（+`-hover`） | 描边 / 悬停描边 |

**尺寸与排版**：

| token | 值 |
| --- | --- |
| `--radius-sm/md/lg/xl/full` | 2/4/8/12/9999px——**控件与卡片用 `lg`**，小元素 `md`，胶囊 `full` |
| `--spacing-xs/sm/md/lg/xl/2xl/3xl` | 4/8/16/24/32/40/48px |
| `--font-size-xs/sm/md/lg/xl/2xl` | 12/13/14（基准）/16/20/24px |
| `--font-weight-normal/medium/semibold`（另有 `-bold`） | 400/500/600 |
| `--font-mono` | 代码/等宽场景 |
| `--shadow-sm/md/lg` | 层级阴影 |
| `--transition-fast/base/slow` | 150/200/300ms 缓动 |

### 6.2 主题适配（自动）

- 平台根样式在 `body[theme="dark"]` 下维护 token 覆盖——**只要用 token，页面无需写任何暗色代码，也不要自己做主题开关**
- **不要硬编码颜色**（hex/rgb 常量）作为底色与文字色；需要带色调的半透明面时用平台惯例：`color-mix(in srgb, var(--token) N%, transparent)`
- 画布/图表类（JS 自绘像素）：如需随主题，用 `getComputedStyle(document.documentElement).getPropertyValue('--bg-color')` 读取；不随主题也可，但保持内部自洽

### 6.3 平台统一提供的基础（不要覆盖）

- **页面底色**：由 OS 布局统一提供——所有窗口共用同一默认背景，随主题自动切换。**页面不要自己设置背景**（不在 `body`/`:root` 写 `background`、不写死色值）；需要局部“面”时，把 `--bg-color-secondary`/`-tertiary` 用在**具体元素**上（卡片、侧栏区块等）。
- **字体栈、字号（14px 基准）、行高、文字颜色**：平台提供、页面自动继承——**不要重新声明**（`font-family`/`font-size`/`color` 都交给平台）。
- 文档级已提供：盒模型 reset（含 margin/padding 归零）、细滚动条、`:focus-visible` 焦点环、`prefers-reduced-motion` 降级——不要重复声明或覆盖。
- 一句话：**`body` 只写布局**（高度/弹性/`container-type`）；颜色与字体交给平台；页面内要面/要色，用 token 作用在具体元素上。

```css
/* ✓ 页面 body 只写布局 */
body { height: 100%; display: flex; flex-direction: column; container-type: inline-size; }

/* ✗ 自己设置页面底色/文字色/字体（平台已提供） */
body { background: #fff; color: #333; font-family: 'Inter', sans-serif; }

/* ✗ 重定义 token */
:root { --bg-color: #0f1115; }
```

### 6.4 视觉惯例（推荐骨架）

- **布局**：顶栏 toolbar + 内容区（`flex:1; overflow:auto`）；满高与 `@container` 见 §5
- **按钮**：主操作实底 `--color-primary`（文字 `--color-primary-text`，hover `--color-primary-hover`）；一般操作弱面 `--bg-color-tertiary` + `1px --border-color`（hover `--border-color-hover`）；危险操作文字/描边用 `--color-danger`
- **输入框**：面 `--bg-color-secondary`、描边 `--border-color`、圆角 `--radius-lg`（聚焦环平台已给）
- **卡片/面板**：面 `--bg-color-secondary` + `1px --border-color` + `--radius-lg`（可选 `--shadow-sm`）
- **列表行**：1px 描边或弱面分隔；悬停 `color-mix(in srgb, var(--text-color) 8%, transparent)`；选中 `color-mix(in srgb, var(--color-primary) 14%, transparent)`
- **徽标/状态**：胶囊 `--radius-full`、字号 `-xs`、弱底（`--bg-color-tertiary` 或语义色 `color-mix 14%` + 同色文字）
- **空态/次要说明**：`--text-color-tertiary`；空态居中
- **间距节奏**：布局级间距取 spacing token；控件内微调（2-8px）可直写；同一页面的视觉密度保持一致
- **过渡**：交互反馈统一 `var(--transition-fast)`
- **图标**：优先内联 SVG 或 emoji（不引入外部图标字体依赖）

### 6.5 可访问性

- 可点击元素用 `<button>`/`<a>`（非 div）；悬停与聚焦状态要有可见反馈
- 正文二级信息对比度不低于 `--text-color-secondary`；禁用态用 `--text-color-disabled`
- 不做全屏渐变/大图重装饰（窗口是工作面板，不是营销页）；动画克制

### 6.6 参考实现

本包 `examples/` 全部按本规范实现：`hello`（最小页）、`todo_min`（工具型应用骨架：toolbar + 列表 + 底栏）、`notes`（双栏布局）——照它们的样式写就不会跑偏。

### 6.7 反例

- ✗ 硬编码 `#0f1115` / `#fff` 等底色与文字色（不随主题、与平台割裂）
- ✗ 覆盖 `:root` token、滚动条、焦点环等全局基础
- ✗ 用 `@media` 做布局（窗口 ≠ 视口，用 `@container`）
- ✗ 引入外部 UI 框架/大套 CSS（页面是平台组件，不是独立站）

## 7. 文件交互与导出（页面常用）

```js
// 打开文件（平台选择器）
const pick = await $mod.$fs.open({ accept: ['.md', '.txt'], multiple: false, start: dir })
if (pick) { text = (await $mod.$fs.get(pick.path)).content }

// 另存为（只返回目标路径，自行写入）
const target = await $mod.$fs.save_as({ name: current || 'a.md', ext: 'md', start: dir })
if (target) await $mod.$fs.put(target.path, text)

// 导出为浏览器下载
saveBlob = (name, blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
```

- 图片/媒体直链：`$mod.$fs.resolve(path)`（同源鉴权 URL）。
- $fs 完整 API 见 `references/platform-runtime.md` §5。

## 8. 高频坑清单

1. 不是完整 HTML 文档 → 静默不挂载（叠一个很误导的 404）。
2. `<script setup>` 里访问 DOM / `$refs` → setup 阶段无 DOM；用 `<script>` 块或事件回调。
3. 绑了模板的变量没在 setup 里初始化 → 运行时不更新；列表先 `= []`。
4. `v-for` 上写 `:key` → 无效属性（自动跟踪，删掉）。
5. `v-if` 跨分支变量类型漂移（null ↔ array）→ 表达式抛错；保持同类型。
6. 运行时创建元素用相对路径 → 不会被前缀，404；用 `$mod.scoped + '/x.png'`。
7. `fetch('/abs/x')` 也会被加包前缀 → 别手拼前缀；要绕过用 `@/`。
8. 自携 `env.js` → 平台固定出口，不生效；逻辑别写 env.js 里。
9. 页内导航写 `news.html` → 写干净路径 `news`（`$router.push('news')` / `<a href="news">`）。
10. 同页 query 变化不重建组件 → 用 `$router.onChange(() => init())` 自刷新。
11. 组件里写死 `/skills/local/xxx` 前缀 → 发布后 scope 变了就 404；用相对路径或 `$router`/`$mod.scoped` 派生。
12. 大二进制素材塞包 → 包 ≤16MB 且不该塞；放用户空间，包内只存 `/fs` 路径。
13. `:key` 之外的另一半：对象行整体替换（`items[i] = {...}`）会销毁重建行 DOM（焦点丢失）；原地改字段或用数组 mutator 保持身份。

## 9. 调试

- 挂载失败 → 页面内红色 `[vhtml] ... failed` 占位（不是白屏）。
- 错误登记：`window.__vhtml_dev.errors`（含代码预览）；级联循环：`window.__vhtml_dev.cascadeErrors`。
- `reload [win_id]` 刷新窗口；`localStorage.debug = 1` 打开详细日志。
- events 为空的三步排查：① pageDesc 形状（desc string / handler 函数）② `<script setup>` 是否真的执行（文档结构）③ reload 后看错误表。
