# 界面（vhtml 页面与组件）

> 面向"不了解平台实现"的 AI。目标：独立写出一个能打开、能交互、AI 还能操作的界面。

## 1. 形态判定

| 需求 | 形态 | 落位 |
| --- | --- | --- |
| 只想看一个界面，不发布 | 独立页面 | 用户云空间 `/u/{uid}/name.html`（长期）或页面本地 OPFS `/name.html`（临时） |
| 主任务由 AI 在对话框完成 | 展示与交接页 | 实样、原始需求、轻量工具；通过 `user_prompt` 回到对话，不另造项目机制 |
| 界面要随技能包发布 | 包内页面 | 技能包 `ui/index.html`（裸入口加载它） |
| 同一份界面要被多处引用 | 可复用组件 | 包内 `ui/local/xxx.html`，用自定义标签引用 |
| 界面要能发布给别人 | 技能包 + UI | 见 [cloud-package.md](cloud-package.md) |
| 文档、项目或素材编辑器 | 文件型 UI + `$fs` | 见 [ui-storage.md](ui-storage.md)，不要自建项目文件库 |

判错的后果：把独立页面硬塞进技能包 → 用户没法单独打开；把可复用组件写成巨型单页 → 改一处崩一片。

## 1.1 多页/复杂 UI：先可视确认，再接业务

带多页或复杂交互的技能包，不要在用户看到页面前一次铺满数据面和执行链。按以下顺序交付：

1. **先写包内 `references/design.md`**：需求边界、页面清单、每页唯一主角与主动作、页面跳转及 query 上下文、关键状态和数据契约。它是包的设计文档，不另建私有设计项目。单个简单页面或明确小改动可省略。
2. **在真实包内做静态 mock**：一次完成一个代表页；只在 `<script setup>` 中声明自洽的示例数据和本地交互，不接 SQLx、AI 或设备执行。示例状态明确标为 mock，不把模拟进度或成功当成真实业务结果。
3. **路由与占位页同步建立**：所有计划页面立即写入包根 `manifest.json` 的 `ui.pages`。尚未设计的页面也必须是完整 HTML，至少显示页面名并提供 `<a href="/">返回首页</a>`；不能留死路由让点击掉到技能详情或其它页面。
4. **展示的主动作必须有本地结果**：例如“新建”打开表单并能向 mock 列表加入对象；暂不提供的行为就不要展示成可点击按钮。正常操作不弹成功提示。
5. **打开真实技能路由给用户看**：使用 `/skills/cloud/{id}` 与包内子路由，检查实际视口、文案、状态和跳转。用户确认结构、样式与交互后，才开始接数据面、AI 和设备链。静态检查通过不等于用户已确认设计。

静态 mock 是正式页面的设计阶段，不是另建一套原型工程；确认后在同一批文件上继续实现。

## 2. 文件形态（硬要求）

组件文件必须是**完整 HTML 文档**：

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>标题</title><style>/* 作用域样式 */</style></head>
<body>
  <!-- 模板 -->
  <script setup>
    // 状态声明
  </script>
</body>
</html>
```

只写 `<template>` / `<style>` / `<script>` 的**片段会静默不挂载**（还伴随一条误导性的
"Failed to load external script" 404）——看到那条 404，先怀疑文件不是完整文档。

自定义标签按路径映射：`<user-card>` → `/user/card.html`；`<agent-list>` → `/agent/list.html`。

**所有自定义组件都必须写完整开闭标签**：用 `<user-card></user-card>`、`<v-input ...></v-input>`，禁止 `<user-card />`、`<v-input />`。这不只是 vhtml-ui 的限制；自闭合写法可能造成后续兄弟节点不渲染，而 `vhtml check` 仍通过，静态检查后必须看实际组件结构。

## 3. 状态与模板语法

在 `<script setup>` 里：

- **裸赋值**（`count = 0`、`save = () => {}`）= 公开状态，模板、refs、父组件都能读；
  `const` / `let` / `function` 只在 setup 内部可见。
- 模板里可用：`{{ 表达式 }}` 插值、`:attr="expr"` 单向绑定、`v:value="expr"` 双向绑定
  （**没有 `v-model`**）、`@click="fn()"` 事件、`v-if` / `v-else-if` / `v-else`、`v-for="x in list"`。
- `v-for` **不要写 `:key`**（自动跟踪；写了是无效属性）。
- 双向绑定只接受静态属性路径；计算结果用事件处理器赋值。
- 列表行整体替换（`items[i] = {...}`）会销毁重建行 DOM（焦点丢失）——改字段或用数组 mutator。
- setup 阶段没有 DOM：需要 DOM 就用事件回调或 `<script>` 块，不要在 setup 里碰 `$refs`。
- `setup` 只在实例创建时运行一次；普通 `<script>` 在挂载时运行一次；`<script active>` 在首次挂载、缓存路由重新进入和页面恢复可见时运行。
- 路由参数驱动的装载放进 `<script active>`，每次激活读取当前 `$router.query`；页内持续监听再配 `$router.onChange`。用 `url|case|new` 之类的路由 key 防重，不把参数快照藏在只执行一次的初始化里。

**`active` 与 `onChange` 都必须保留，不能互相替代**：`active` 覆盖首次挂载、缓存页重新进入和恢复可见；页面已经 active 时，从 `?url=A` 原地切到 `?url=B` 属于 query-only 变化，不会重新激活，只能由 `onChange` 捕获。不要在 `setup` 或普通 `<script>` 中只调用一次装载函数。标准模板：

```html
<script setup>
  let lastRoute = ''
  initPage = async () => {
    const url = String($router.query.url || '')
    const caseId = String($router.query.case || '')
    const fresh = String($router.query.new || '')
    const key = url + '|' + caseId + '|' + fresh
    if (key === lastRoute) return
    lastRoute = key
    try {
      if (url) await openDocument(url, {newFile: fresh === '1'})
      else if (caseId) await openCase(caseId)
    } catch (error) {
      if (key === lastRoute) lastRoute = '' // 允许重新激活时重试
      $message.error(String(error?.message || error))
    }
  }
</script>
<script>
  $scope.addCleanup($router.onChange(() => { initPage() }))
</script>
<script active>
  initPage()
</script>
```

`openDocument` 必须读取当前 URL 指向的真实资源，不能只在旧文档上刷新界面；路由 key 只负责去重，不能用来跳过不同 URL 的加载。

## 4. 样式与官方组件

**优先使用平台官方 `vhtml-ui`，不要重复造按钮、输入框、卡片、表格、标签页、弹窗或 toast。**
开发前先查询当前平台的真实组件文档（不是凭记忆猜属性）：

```sh
# exec _host=cloud
curl /v/README.md

# 只查某个组件；可继续用 grep/head/tail 组合缩小上下文
curl /v/README.md | grep -n -A 30 '^## Button'
```

文档包含组件清单、Props、Events、Slots、`$message` 和主题服务。常用标签包括 `<v-btn>`、
`<v-input>`、`<v-form>`、`<v-card>`、`<v-tag>`、`<v-alert>`、`<v-table>`、`<v-tabs>`、
`<v-dialog>`、`<v-dropdown>`；全局反馈直接用 `$message`。官方组件能满足结构或交互时，自定义
CSS 只负责业务布局与少量外观调整；确有缺失再写本地组件，并沿用同一套 token 与状态规范。

**平台还有一组全局公共组件**，标签前缀 `<widgets-*>`（`/widgets` 是全局别名，技能页面直接写
标签即可，不要手拼 scoped 前缀）：`<widgets-host-connector>`（设备选择器）、
`<widgets-fs-picker>` / `<widgets-fs-browser>`（文件选择与浏览）、`<widgets-viewer-md>` /
`<widgets-viewer-json>` / `<widgets-viewer-preview>`（文件预览）。公共组件与 `$fs` 一样是平台
给的，**先查再用，不要在包里重写一套**；除 `<widgets-host-connector>` 外的 props/events 以
平台当前实现为准，用前先看 `ui/widgets/**` 源码。

平台基调是"轻量工作面板"：简洁、克制、信息密度中高。规则只有几条，但违反会明显跑偏：

- **颜色/字号/圆角/间距一律用平台设计 token**：`--color-primary`、`--color-success`、
  `--color-danger`、`--bg-color`、`--bg-color-secondary`、`--bg-color-tertiary`、
  `--text-color`（`-secondary`/`-tertiary`）、`--border-color`、`--radius-lg`、
  `--spacing-sm|md|lg`、`--font-size-xs|sm|md|lg`。**不要硬编码 `#0f1115`、`#fff` 这类色值。**
- **不要给页面设底色**：`body` 不写 `background`、不写 `color`、不写 `font-family`——
  平台已提供并自动适配亮/暗主题。要"面"就把 `--bg-color-secondary` / `-tertiary`
  用在具体元素（卡片、面板）上。
- **body 只写布局**：`body { height: 100%; display: flex; flex-direction: column; container-type: inline-size; }`
- **窗口宽度用 `@container`，不要用 `@media`**（窗口 ≠ 视口）。容器查询基于 `container-type` 建立的容器。嵌套窗口中的字号与控件尺度用 `cqw`/`clamp` 跟随容器，不用 `vw`。
- 分隔线只服务真实对象边界；留白已经分组时不重复加线。固定设计尺寸的实样预览按容器等比缩放，不能用内部滚动条或文字裁切冒充缩略图。
- 组件样式自动作用域化（只作用于本组件 DOM）；用 `body .x` 前缀可向下穿透到后代。
- 按钮：主操作实底 `--color-primary` + 文字 `--color-primary-text`；一般操作弱面
  `--bg-color-tertiary` + `1px --border-color`；危险操作用 `--color-danger`。
- 图标用内联 SVG 或 emoji，不引外部图标字体。
- 可点击元素用 `<button>` / `<a>`，别用 div 假装按钮。

## 5. 内容、反馈与双语

- 页面主体是用户要操作的真实对象与动作，不是产品说明书。功能介绍、方法教学、格式路径、实现方式和“如何使用”不能用来填充空白；空态只说当前事实与下一步。
- 正常打开、新建、切换或进入页面不弹成功提示。保存状态、只读状态等优先就地表达；只有结果需要离开当前上下文、异常或需要处理时才通知。
- 通知统一使用平台 `$message.info/success/warning/error`，确认使用 `$message.confirm`；禁止在技能里另造 toast 状态、计时器、DOM 和样式。
- 所有用户可见文案使用 `$t`：包括导航、按钮、空态、表单、提示、运行时反馈和内置条目标题。`ui/langs.json` 至少维护 `zh-CN` 与 `en-US`，通过 `vhtml i18n scan/add` 管道更新；动态 key 使用 `_` 前缀，禁止 `--autoremove`。
- `$t(item.labelKey)` 这类动态引用不会被静态 scan 发现：使用 `_nav.scan` 等保留键，并通过 `vhtml i18n add` 显式补齐两种语言。scan 的 100% 只覆盖它发现的静态 key，不能证明动态 key 完整。

## 6. 平台能力（共享服务）

平台壳向页面注入这些共享服务（可直接用，也可经 `$mod` 读同名服务）：`$fs` `$auth` `$ai`
`$hosts` `$os` `$skills` `$account` `$catalog` `$pageExec` `$message`。细节见 [materials.md](materials.md)。

包内 API 用 `$fetch('api/xxx')`——相对地址会自动补上包服务前缀。包外资源用 `$mod.scoped`
前缀或相对路径；**不要手拼前缀、不要写死技能 id**（fork/换部署会 404）。

**UI 用户产物默认存 `$fs`**：文档、项目、素材和导出文件都通过统一文件树读写；打开用
`$fs.pickFiles`，新建/另存为用 `$fs.pickSavePath`，跨端复制用 `$fs.transfer`。没有打开文档时提供
「打开 / 新建 / 最近记录」首页，不扫描私有项目目录，不在应用里重复实现文件管理器。完整契约见
[ui-storage.md](ui-storage.md)。

**设备连接用平台公共组件 `<widgets-host-connector>`**（全局别名 `/widgets`，技能页面直接用，
不要自己写设备下拉框与在线判断）：

```html
<widgets-host-connector v:value="selectedHostId" remember="my_skill"></widgets-host-connector>
```

- `value`：设备 id，支持 `v:value`；空值表示未选择。`remember`：可选，按用途把最近设备 id
  记进 localStorage（不存凭证）。
- 事件：`v-connect` 回传 `{hostId, host, connection}`，`v-disconnect` 回传 `{hostId}`，
  `v-error` 回传错误对象。
- 组件统一了设备列表、在线判断与连接生命周期：选中在线设备即经 `$hosts.openTools` 建立真实
  工具连接；切换设备、断开或页面销毁时关闭旧连接；停用、离线或不支持 RTC 的设备会显示状态
  并抛 `v-error`。
- 组件只统一连接与状态，**不替你授予设备命令权限**；具体命令与 stdin 契约仍由技能负责。

不用组件时直接调共享服务：`const conn = await $hosts.openTools(hostId)` → `conn.execCall(script,
{stdin})` 调设备命令 → 用完 `conn.close()`。设备停用抛 `permission_denied`，离线抛
`unreachable`。页面销毁或切换设备时必须关掉旧连接。

技能包自带页面与平台页面共用同一套 UI 能力：`$fs`（文件）、`$hosts`（设备）、`$message`
（通知）、`<widgets-*>`（公共组件）都是平台注入的，技能只写业务，不重写基础设施。

JS 参数用 camelCase；后端 DTO 与工具协议字段保留 snake_case。

## 7. 页面指令（让 AI 操作你的界面）

在 `<script setup>` 里声明 `pageDesc`。handler 接收 `(data, ctx)`，业务数据直接返回；AI 在 `exec _host=page` 的 async JavaScript 函数体里通过 `win(id).command(data)` 调用：

```js
pageDesc = {
  desc: '待办清单页面',
  commands: [
    {
      name: 'todo_status', desc: '待办统计', help: 'win(id).todo_status()；返回 {ok, total}',
      handler: async () => {
        await load()
        return { ok: true, total: items.length }
      },
    },
    {
      name: 'todo_add', desc: '新增待办', help: 'win(id).todo_add({title})',
      handler: async (data) => {
        const title = String(data?.title || '').trim()
        if (!title) throw new Error('todo_add: title required')
        await add(title)
        return { ok: true, title }
      },
    },
  ],
}
```

AI 调用示例（`exec _host=page`，`script` 是 async JavaScript 函数体）：

```js
const available = await commands()       // 发现页面与窗口业务函数
const opened = await open({url: '/skills/cloud/{skill_id}'})
const before = await win(opened.win_id).todo_status()
const added = await win(opened.win_id).todo_add({title: '写周报'})
const after = await win(opened.win_id).todo_status()
return {available, before, added, after}
```

约定：

- 参数是有名字段对象，例如 `{title}`、`{path}`、`{values}`；纯文本命令可定义为 `{text}`；无参命令忽略 `data`。
- 返回原生对象、数组或字符串，不包 `{content: JSON.stringify(...)}`；失败抛出带明确原因的 `Error`。
- `ctx` 是第二个参数，只在需要执行方身份、取消信号等上下文时接收；不经命令行参数数组或标准输入传参。
- 用 `return await commands()` 可单独发现函数；多步操作用 `win(id).command(data)` 顺序 `await`。
- 同页重复注册由后注册者覆盖；跨标签通过 session queue 单次投递。

### 通用高亮标注（无需技能声明）

AI 要给人类讲解页面重点时，直接调用平台 `highlight` 指令，不要在技能里自造高亮层：

```js
await highlight({win_id: 'w1', selector: '.row', desc: '说明'})
await highlight({win_id: 'w1', clear: true})
```

默认标注活动窗口中首个匹配元素，显示边框和 desc 标签；同一窗口再次调用替换旧标注，目标随导航移除时自动清理。该指令只负责视觉标注，不承担业务动作或数据修改。

## 8. 组件复用与插槽

- 组件通过属性传参：`<user-card name="Tom" :age="userAge" v:score="score" disabled></user-card>`
  （静态值 / 单向 / 双向 / 布尔存在即 true）。
- 宿主组件可以用 `<vslot>` 留出口，父级用 `vslot="名称"` 投影内容；投影内容不是组件的一部分，作用域仍属父级。
- 往插槽里放**自定义片段**走档案规则（slot），见 [ui-profile.md](ui-profile.md)——片段是纯结构的。

## 9. 高频坑

1. 文件不是完整 HTML 文档 → 静默不挂载（伴随误导性 404）。
2. 模板里用了 setup 里的 `const` → 引用不到（公开状态一律裸赋值）。
3. `v-for` 上写 `:key` → 无效属性，删掉。
4. `@media` 做窗口响应式 → 改用 `@container`。
5. 自己设页面底色/字体 → 与平台割裂，且不随主题。
6. 手拼前缀或写死技能 id → fork / 换部署后 404。
7. 双向绑定写 `v-model` → 没有这个语法，用 `v:value`。
8. 数字输入框拿到的是字符串 → 提交前自己 `Number()`。
9. 页内导航写 `news.html` → 写相对页面名 `news`（`$router.push('news')`）。
10. 同页 query 变化或缓存页面重新激活后仍读旧参数 → 装载放入 `<script active>` 并读当前 `$router.query`，用路由 key 防重。
11. 运行时创建的元素用相对路径 → 不会被加前缀，用 `$mod.scoped + '/x.png'`。
12. 自带 `env.js` → 平台有固定出口，不生效；逻辑别写 env.js。
13. 跳其他应用或 `/fs/...` 文件时，包页面里的 `<a href="/绝对路径">` 会被路由器拦下并按包作用域重写；改用按钮 + `$mod.$os.open(url)`。正式页内导航用 `$router.push`；设计占位页可用 `<a href="/">` 返回包首页。`$os.open` 只用于跨应用、文件或 Launcher/OS 等特殊开窗场景。
14. 任意自定义组件写 `<user-card />` / `<v-input />` → 可能吞掉后续兄弟节点；改成完整开闭标签，并实际检查弹窗/表单内容。
15. 导航只写主页、目标页没登记 `ui.pages` → 点击可能掉到技能详情；所有计划路由先登记并放可返回的占位页。
16. 自造设备下拉框、在线判断与连接开关 → 用平台公共组件 `<widgets-host-connector>`（或共享服务
    `$hosts`）；建连与旧连接释放已由平台统一，别再写一套。

## 10. 验收

- 页面能打开，控制台无错误占位（挂载失败会显示红色 `[vhtml] ... failed`）。
- 多页静态 mock 的每个导航目标都已登记且可打开，占位页能返回首页；所有展示出来的主动作都有本地可见结果。
- 复杂 UI 在接业务前已打开真实技能路由并取得用户确认；没有用说明文案、方法教学或实现原理填充页面。
- 页面展示真实对象与动作，没有产品说明、方法教学或格式路径等注释型内容；正常打开、新建与切换不弹成功提示。
- 中英文可见文案完整，i18n 扫描无缺失；通知使用 `$message`，没有自定义 toast。
- 缓存页面重新激活后读取当前路由参数，首次挂载不会重复装载。
- 资源无 404；相对路径在包内与用户空间两种落位都成立。
- 亮色/暗色主题下都可读（只用 token 就自动成立）。
- 声明了 pageDesc 的命令能被 AI 经 `win(id).command(data)` 调通，直接返回结构化业务数据或文本，错误明确抛出。
- 交互元素可用键盘聚焦，悬停/聚焦有可见反馈。
- 涉及存储时，用户产物可从任意 `$fs` 位置打开并写回；最近记录不冒充文件清单，移除记录不删除文件。
- 涉及设备时用 `<widgets-host-connector>` 或 `$hosts.openTools`，没有自造设备下拉框与在线判断；页面销毁或切换设备时旧连接已关闭。
