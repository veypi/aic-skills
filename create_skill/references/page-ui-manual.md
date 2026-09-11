# 技能界面手册（ui/ 与 pageDesc）

> 本手册覆盖「技能页面」的特有内容：包页面平台集成、pageDesc 指令完全规格、布局响应式、常见坑。
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

## 6. 文件交互与导出（页面常用）

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

## 7. 高频坑清单

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

## 8. 调试

- 挂载失败 → 页面内红色 `[vhtml] ... failed` 占位（不是白屏）。
- 错误登记：`window.__vhtml_dev.errors`（含代码预览）；级联循环：`window.__vhtml_dev.cascadeErrors`。
- `reload [win_id]` 刷新窗口；`localStorage.debug = 1` 打开详细日志。
- events 为空的三步排查：① pageDesc 形状（desc string / handler 函数）② `<script setup>` 是否真的执行（文档结构）③ reload 后看错误表。
