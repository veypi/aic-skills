# 讲解手法（page 通道）

> 讲解 = 打开平台窗口 +（必要时）点开折叠内容 + 聚光标注 + 口述。
> 全程用平台原生指令，不自建高亮层、不自造窗口。
> 本文所有结论都在当前平台版本上实测过（2026-11-16）。

## 1. 原生指令清单

page 通道脚本里可直接调用的原生函数（`exec` 的 `_host=page`，脚本体是原生 async JS 函数体）：

| 指令 | 签名 | 说明 |
| --- | --- | --- |
| `list` | `list()` | 列出所有窗口：`{id, title, url, origin_url, mode, real, minimized, self, events}` |
| `open` | `open({url, mode?, win?})` | 打开地址；默认**平铺**（占工作区一格）；`mode:'float'` 浮动窗；`win` 指定在已有窗口里换地址。返回 `{win_id, title, url, mode, events}` |
| `close` | `close({id})` / `close({all:true})` | 关窗；`all` 只关可关且非主窗的窗口 |
| `reload` | `reload({id?})` | 重载窗口页面（默认活动窗） |
| `highlight` | `highlight({win_id?, selector, title?, desc, wait?})` / `highlight({win_id?, clear:true})` | 聚光标注 / 清除。**省略 `win_id` = 整个页面**（所有窗口 + 左侧栏 + 顶栏）；**给了 `win_id` = 只那个窗口** |
| `click` | `click({win_id?, selector, index?})` | 真点击；作用域规则同上。`index` 是第几个匹配（**0 起**），返回值带 `tag`/`text` 自检 |
| `screenshot` | `screenshot({id?, output?})` | 整屏或单窗截图；`output` 必须是 `/fs/{page|cloud|<host_id>}/...` 形式 |
| `profile` | `profile({action, name?})` | 桌面档案：list / save / apply / revert / inspect |
| `win(id)` | `win(id).command(data)` | 调窗口自己的业务函数（技能页面指令） |

`highlight` 参数：`title` 是加粗首行（可省），`desc` **必填**，`wait` 是**等元素出现**的超时（毫秒，上限 60000）——不是停留时长；停留靠 `sleep`。

**标注用户能自己关**：气泡右上角有 **×**，**Esc** 也能关。所以 AI 讲完仍要自己清——别把标注留给用户手动关。

## 2. 窗口模型与 win_id

- `win_id` **只能从 `open()` 的返回值取**（路由窗形如 `wg2mu`：首字母 + 地址哈希；复用、参数不同都会变，不要自己拼）。
- **同 URL 已有窗口时 `open` 会复用它**——「开窗前先问自己是不是要复用用户自己的窗口」。
- **整场讲解只开一个窗**：开一次拿到 `win_id`，之后一律 `open({url, win: win_id})` 换页；
  报 `window "x" not found` 时用 `list()` 重新取 id。
- 一个窗口在 OS 布局里对应一个 `.win-box[data-wid="<win_id>"]`；**只有 `.win-box` 里的元素能被 `highlight`/`click` 标到**（给了 `win_id` 时）。
- **省略 `win_id` 就能越过这个限制**：搜索范围是**整个 document**（所有窗口内容 + 左侧栏 dock + 顶栏），
  所以侧边栏、顶栏这些「不在窗口里」的东西**省略 `win_id` 才碰得到**。
- `real: true` 的窗口是用户当前的主窗（正在跟你对话的那个），**别关**；但它**可以被聚光**——
  介绍对话界面时直接用它，不必另开窗口。
- 页面内容是内嵌 memory vrouter（不是 iframe），所以 `document.querySelector` 能直接读到窗口里的 DOM。
- **换页后要等页面渲染完**：`open({url, win})` 换址后 `sleep(2500)` 再标——列表类页面（文件、任务、技能）要拉数据，
  元素已存在但**尺寸为 0**（这时报的是 `is not visible`，不是 `no element matches`），早标必失败。
- **窗口宽度会改布局**：窗口窄时平台页面切移动版（侧栏收进 `.icon-btn.mobile-menu`），
  宽版选择器命中不到 → 先 `click` 汉堡按钮展开，或换元素。

## 3. 定位：三层作用域

### 3.1 作用域（找不找得到）

| 写法 | 搜索范围 | 什么时候用 |
| --- | --- | --- |
| `highlight({selector})` | **整个 document** | 目标在侧边栏 / 顶栏 / 别的窗口里 |
| `highlight({win_id, selector})` | 该窗口的 `.win-box` 内 | 目标在某个窗口里，且要跟别的同名元素区分 |

### 3.2 组件级定位（找得准不准）

同名 class 满地都是（`.session-item` 侧边栏和聊天页都有）。用 vhtml 的组件标记钉死：

- 每个**组件实例根**带 `vref="/组件路径"`（如 `<ai-chat-sessions vref="/ai/chat/sessions">`）
- 组件内的元素带 `vrefof="/宿主组件路径"`（表示「我由该组件渲染」）

| 写法 | 含义 | 例子 |
| --- | --- | --- |
| `[vref="X"] .foo` | 组件 X **实例内部**的元素（含直接子节点） | `[vref="/os/launcher"] .trigger` |
| `[vrefof="X"] .foo` | 属于 X 的元素的**后代**（再往下一层） | `[vrefof="/ai/chat/sessions"] .session-item` |

**两者不能混用**——这是实测踩过的坑：

- 启动器的 `.trigger` 自己带 `vrefof="/os/launcher"`，但它的**祖先**是 `<os-launcher vref="/os/launcher">`（带的是 `vref`），
  所以 `[vrefof="/os/launcher"] .trigger` **匹配不到**，必须写 `[vref="/os/launcher"] .trigger`。
- 反过来，`.session-item` 的祖先里有带 `vrefof="/ai/chat/sessions"` 的 `.session-list`，
  所以 `[vrefof="/ai/chat/sessions"] .session-item` 命中。

> ⚠️ `querySelector('[vref="X"]')` 的**首个匹配可能是 `<style>` 标签**（loader 给模板样式也打了 vref）——
> 查组件根要用具体 class（`.dock-body`、`.os-launcher`）或 `[vrefof]`。

**实测组件表**

| 组件 | 里面有什么 |
| --- | --- |
| `/page/agents/chat` | 会话页路由根 |
| `/ai/box` | 对话外壳：`.conversation-shell`、`.grant-chip`、`.model-chip`、`.context-ring` |
| `/ai/chat/header` | `.header-fill`（会话标题，点击展开会话列表）、`.header-action`（+ 新建会话） |
| `/ai/chat/sessions` | 会话下拉容器 `.sessions-dropdown`（`show` 属性控显隐）、`.session-list`、`.session-item`、`.session-title` |
| `/ai/chat/agent_menu` | `.agent-trigger`、`.trigger-name`（当前 Agent） |
| `/ai/chat/input` | `.input-zone`、`.ta-box`（输入框）、`.btn-icon`（麦克风） |
| `/os/dock` | 侧边栏全部：`.brand`、`.grp`、`.grp-head`、`.session-item`、`.launcher-row`、`.dock-bottom` |
| `/os/launcher` | 启动器：`.trigger`、`.panel`、`.search`、`.result` |

### 3.3 可见性（首个匹配的坑）

`highlight` 取**第一个**匹配。平台大量 `v-show` 面板留在 DOM 里只带 `style="display: none"`，
于是**隐藏的兄弟会挡住选择器**：

| 写法 | 结果 |
| --- | --- |
| `.tab-panel` | 命中第一个（通常是隐藏的）→ `is not visible` |
| `.tab-panel:not([style*="display: none"])` | **只命中可见的那一个** → 成功 |

整页搜时同理：同名元素先命中文档里靠前的那个 → 要指准就加 `vrefof`/`vref` 或写 `win_id`。

### 3.4 探针脚本（不知道选择器时先探）

探针要同时报出**元素属于哪个组件**，这样能直接写出精确到组件的选择器：

```js
const w = await open({url: '/skills'})
await new Promise(r => setTimeout(r, 1400))
const box = document.querySelector('.win-box[data-wid="' + w.win_id + '"]')
const seen = new Map()
for (const el of box.querySelectorAll('*')) {
  const cls = typeof el.className === 'string' ? el.className : ''
  const owner = el.getAttribute('vrefof') || el.getAttribute('vref') || ''
  if (!cls && !owner) continue
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) continue            // 零尺寸 = 收起/隐藏，不可见
  const key = el.tagName.toLowerCase() + '.' + cls.split(' ').filter(Boolean).slice(0, 2).join('.') + (owner ? ' @' + owner : '')
  if (seen.has(key)) continue
  seen.set(key, (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24))
}
return [...seen.entries()].slice(0, 45).map(([k, v]) => k + ' :: ' + v)
```

- 返回形如 `div.session-item @/ai/chat/sessions :: 评估设计一下rg优化方案`：
  左边是**选择器 + 组件归属**，右边是元素文字，用来判断标哪。
- 探完记得 `close({id: w.win_id})`。

## 4. `click`：先点开再标

平台很多内容默认折叠：**直接标会报 `is not visible`**。正确姿势是**先 click 点开，再 highlight**。

| 目标 | 先做什么 | 标什么 |
| --- | --- | --- |
| 会话列表（对话页） | `click .header-fill`（标题那行，`toggleSessions`） | `.session-item`、`.session-title` |
| 技能中心的「广场」 | `click .v-tab-item`（index 2 = 广场） | `.skill-card`、`.card-name`、`.card-fav`（**新用户「我的」是空的，讲技能要讲广场**） |
| 文件页「位置」侧栏 | `click .icon-btn.mobile-menu`（汉堡） | `.locations.open`（展开后带 `open`） |
| 设置页 / Agent 设置的页签 | `click .v-tab-item`（带 `index`） | `.tab-panel:not([style*="display: none"])` |
| 窄窗口下的侧栏 | `click .icon-btn.mobile-menu` | 展开后的条目 |
| **启动器** | **不点**（见 §10） | — |

```js
// 1) 切到「工具」页签（.v-tab-item 的第 3 个，index 从 0 起）
const r = await click({win_id: w.win_id, selector: '.v-tab-item', index: 2})
// r.text 回显点到的东西 —— 「工具」就对了，别的就是点歪了
await sleep(900)
// 2) 标展开后的面板（排除还藏着的兄弟面板，见 §3.3）
await highlight({win_id: w.win_id,
  selector: '.tab-panel:not([style*="display: none"])',
  title: '工具', desc: '这个 Agent 能用哪些工具，都在这里开关', wait: 3000})
await highlight({win_id: w.win_id, clear: true})
```

注意：

- `index` 是**第几个匹配**（0 起），不是「名字」；靠 `click` 返回的 `text` 确认没点歪。
- **点完必须 `sleep`（≥600ms）再标**：面板切换是异步的，刚点完就标会碰到「还在过渡」的零尺寸元素 → `is not visible`。
- 点不到会抛 `click: no element matches ...`；元素不可见会抛 `click: ... is not visible`。
- `click` 是**真的点击**——别点删除、提交、付费这类按钮；讲解只点「展开 / 切换」这类无害动作。
- 点完要**复原**：抽屉点回去、页签切回原位、下拉再点一次收起。

## 5. 侧边栏：先判状态

侧边栏（dock）有两种**形态**、两种**位置**，不定状态就标会白标：

| 维度 | 判定 | 依据（实测） |
| --- | --- | --- |
| 位置 | 顶部 / 左侧 | 车道 `.dock-lane` 有没有 `top`（`dockEdge`：`auto` = 宽屏左、窄屏顶） |
| 形态 | 展开 panel / 窄条 rail | `.menu` 上的 `m-panel` / `m-rail`；判据是 `isPanel = () => menuW >= PANEL_LT`（**由菜单宽度决定**，用户拖车道宽就变） |

```js
// —— 判状态 ——
const dockRoot = document.querySelector('.dock-body')      // 别用 [vref="/os/dock"]：首个匹配可能是 <style> 标签
const lane = dockRoot ? dockRoot.closest('.dock-lane') : null
const menu = dockRoot ? dockRoot.querySelector('.menu') : null
const state = {
  位置: lane && lane.classList.contains('top') ? '顶部' : '左侧',
  形态: menu && menu.classList.contains('m-panel') ? '展开' : '窄条',
}
```

**按状态挑能标的元素**（窄条下文字类元素是 `display:none` → 0 尺寸 → 标不到）：

| 元素 | 窄条 rail | 展开 panel |
| --- | --- | --- |
| 品牌区 | `.brand-mark`（图标） | `.brand-copy` / `.brand-title`（文字） |
| Agent 组 | `.grp-head`（图标）、`.grp.active` | `.grp-name`（名字）、`em.badge`（角标） |
| 会话 | 不可标（`.grp-body` 收起） | `.session-item`、`.session-title` |
| 功能入口 | `i.fa-cubes` / `i.fa-chart-line` / `i.fa-gear` | 同左（图标一样） |
| 底部 | `.launcher-row`、`.pref-row` | 同左 |

```js
await highlight({selector: '[vrefof="/os/dock"] .grp-head',     title: 'Agent 组', desc: '窄条只有图标'})
await highlight({selector: '[vrefof="/os/dock"] .launcher-row', title: '启动器',    desc: '⌥ Space：搜页面、Agent、技能、文件、命令'})
await highlight({clear: true})
```

- 顶置与左置**选择器不变**（同一个组件 `/os/dock`），只是排布不同 → 别写死方位。
- 标不到文字、但用户想看文字时：让用户把侧栏拖宽（宽度就是形态开关），再标。

## 6. 节奏与话术

- **先说后标**：先讲一句「这里是技能中心」，再打标注；标注是「指」，不是「说」。
- **一次只标一个**：同一作用域的新标注替换旧的；同时标多处会互相打架。
- **停留 2~4 秒**：`await sleep(2000)`；`wait` 只管等元素出现。
- **`title` 一行短标题**（≤ 10 字），**`desc` 一句解释**（≤ 30 字）——气泡卡片很小，写长了用户读不完。
- **一窗讲到底**：`open({url: next, win: w.win_id})` 在同一个窗里换页；比开一串窗干净。
- 讲完一句「这页就这样」，立刻换下一段，别在一个元素上反复标注。

## 7. 错误兜底

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `window "x" not found` | 窗口已关 / id 不对 | `list()` 刷新后重取 id |
| `no element matches <sel>` | 选择器不对或元素还没渲染 | 加 `wait: 3000`；或跑探针脚本重找；或换成 `vref`/`vrefof` 写法 |
| `<sel> is not visible` | 命中的是隐藏的兄弟 / 抽屉收起 / 标签页没切 / **页面还没渲染完** | 先 `click` 展开；或用 `:not([style*="display: none"])`；换页后**等 2.5s** 再标 |
| `invalid querySelector` | 选择器语法错 | 修正语法（平台页面用普通 class 选择器即可） |
| `click: no element matches` | 选择器错 / `index` 越界 | 探针重找；数一数第几个才是它 |
| `page not found` / 404 | 路由参数缺失 | 补参数（`/agents/{id}`、`/skills/cloud/{id}`） |

**标不到就换一个元素**，不要死磕：讲解的价值在「指对地方」，不在「标上那个 class」。

## 8. 复原与礼仪

- 讲完：`highlight({win_id, clear:true})` → `close({id: w.win_id})`。
- 点开的页签 / 抽屉 / 下拉**复原**（再点一次，或点到原位）。
- **别关用户自己的窗口**：`real: true` 的主窗、以及用户自己开着的会话窗，都留着。
- 讲解窗用**默认平铺**（`open({url})`）：占工作区一格，尺寸够大、元素可见。讲完一关即复原。
- 中途被打断（用户发新消息、换窗口）时，把已开的窗和标注收干净再继续。
- 讲解期间**别顺手替用户做操作**（点删除、点创建）——那是执行任务，先问再做。

## 9. 完整示例：单窗导览

**全程一个窗**：对话界面用主窗（不开窗），其余页面开一个窗换着走。

```js
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- 1) 对话界面：直接用主窗，不开新窗 ----
const main = (await list()).find(w => w.real)
for (const s of [
  {sel: '.grant-chip',   title: '权限模式', desc: 'AI 动手前要不要问你'},
  {sel: '.model-chip',   title: '模型与思考档', desc: '换模型、调思考深度'},
  {sel: '.context-ring', title: '上下文占用', desc: '这个会话吃掉多少上下文'},
]) {
  await highlight({win_id: main.id, selector: s.sel, title: s.title, desc: s.desc, wait: 2500})
  await sleep(2000)
  await highlight({win_id: main.id, clear: true})
}

// ---- 2) 会话列表：先点标题展开，再标 ----
await click({win_id: main.id, selector: '.header-fill'})
await sleep(900)
await highlight({win_id: main.id, selector: '.session-item', title: '历史会话', desc: '标题 · 日期 · 用量；★ 收藏', wait: 2500})
await sleep(2200)
await highlight({win_id: main.id, clear: true})
await click({win_id: main.id, selector: '.header-fill'})   // 复原：收起
await sleep(700)

// ---- 3) 其余页面：只开一个窗，用 win 换页 ----
const tour = [
  {url: '/agents/coder/settings', steps: [
    {sel: '.tab-panel:not([style*="display: none"])', title: '工具', desc: '这个 Agent 能用哪些工具',
     before: async () => { await click({win_id: id, selector: '.v-tab-item', index: 2}) }},
  ]},
  {url: '/skills', steps: [
    {sel: '.skill-card', title: '广场上的技能', desc: '点进详情，星星是收藏',
     before: async () => { await click({win_id: id, selector: '.v-tab-item', index: 2}) }},   // 2 = 广场
  ]},
  {url: '/fs', steps: [
    {sel: '.locations.open', title: '位置', desc: '云盘 / 浏览器文件 / 设备目录',
     before: async () => { await click({win_id: id, selector: '.icon-btn.mobile-menu'}) }},
  ]},
  {url: '/usage/credits', steps: [{sel: '.balance-value', title: '余额', desc: '账户里的钱'}]},
]

let id = null
for (const page of tour) {
  try {
    if (!id) id = (await open({url: page.url})).win_id
    else await open({url: page.url, win: id})
    await sleep(2500)
    for (const s of page.steps) {
      try {
        if (s.before) { await s.before(); await sleep(900) }
        await highlight({win_id: id, selector: s.sel, title: s.title, desc: s.desc, wait: 3000})
        await sleep(2200)
        await highlight({win_id: id, clear: true})
      } catch (e) {
        continue   // 标不到就跳过这一步，继续讲后面的内容
      }
    }
  } catch (e) {
    const L = await list()
    const t = L.find(x => !x.real && x.mode !== 'dock')
    if (t) id = t.id
  }
}
if (id) { try { await close({id}) } catch (_) {} }
return {pages: tour.length}
```

> 每个 `try/catch` 都要写：**用户正在看你的讲解，一处失败不该让整场导览中断**。

## 10. 启动器：只讲，不点

启动器（`⌥ Space` 的搜索面板）是**用户自己的面板**，**AI 不要点开它**：

- 它的遮罩 `z-index: 10000`（fixed 全屏），**压在 AI 标注（z-index 60）之上**——AI 标注盖不住它。
- 用户手动打开时，AI 标注会落在它下面，用户看不见。
- 真要提它，就**口述**：「左下角那个放大镜，⌥ Space 打开，能搜页面、Agent、技能、文件、命令」，
  并用 `[vrefof="/os/dock"] .launcher-row` 指向那个入口。

## 11. 别做的事

- **别自建高亮层**：平台 `highlight` 就是给这个用的，自造 overlay 会挡住用户操作。
- **别用 class 硬猜组件**：同名 class 会串 → 用 `vref` / `vrefof` 钉死组件（注意两者不能混用）。
- **别点启动器**：用户自己的面板，优先级比 AI 标注高。
- **别用 `click` 做危险操作**：讲解只点展开 / 切换，别点删除、提交、充值。
- **别用 `highlight` 做业务动作**：它只标注不改数据；真要执行就用对应接口 / 指令。
- **别硬编码平台地址**：用相对路径 `/skills`；`localhost:4000` 会随环境变。
- **别一次开一堆窗**：用户界面会被糊住，讲完也收不干净。
- **别讲普通用户看不到的东西**：管理后台、内部接口、运维命令都不在这个手册范围内。
- **别编平台没有的页面**：不确定就探针看一下，没有就别讲。
