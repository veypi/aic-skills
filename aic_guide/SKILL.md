---
name: aic_guide
version: 1.1.0
nickname: AIC 平台导览
description: 给用户讲解 AIC 平台的手册——用 page 通道的 open/click/highlight 打开平台页面、点开折叠内容、聚光标注边讲边指；覆盖普通用户可见的全部路由（Agent/会话/任务/实时语音/技能/文件/设备/生成/模型/音色/网关/用量/额度/设置/公开页）、OS 窗口与侧边栏怎么用、对话界面要素，以及用法速查。当用户问「介绍一下这个平台」「带我逛逛」「AIC 怎么用」「平台有哪些功能」「窗口怎么用」时用。
keywords: [aic, 平台, 导览, 讲解, 演示, 介绍, 导航, 高亮, 聚光, 点击, 窗口, 侧边栏, 启动器, 用法, 速查, 页面地图]
icon: fa-solid fa-compass
---

# AIC 平台导览

给**普通用户**讲 AIC 平台：把平台页面一个个打开，必要时点开折叠内容，用聚光标注指到正在讲的位置，边讲边指。

纯手册包——**没有 UI 页、没有接口、没有设备命令**。讲解动作全部用平台已有的原生指令
（`open` / `click` / `highlight` / `screenshot` / `close`），走 page 通道。
本文所有结论都在当前平台版本**实测过**（2026-11-16）。

## 0. 何时用 / 何时不用

**该用**

- 「介绍一下 AIC 平台」「带我逛逛」「这平台能干什么」「平台有哪些功能」
- 「窗口怎么用」「侧边栏是什么」「快捷键有哪些」「启动器怎么搜」
- 「当前这个界面是干什么的」→ 只讲当前这一页，别做全平台导览
- 「照着界面讲讲怎么配 X（技能 / 设备 / 设置 / 记忆）」

**不该用**

- 用户要**动手做**（帮我装个技能、连台设备、跑个任务）→ 直接执行，别开窗口讲解
- 用户问**具体技术问题**（接口字段、参数含义）→ 查文档回答，别开窗口
- **管理后台**（用户 / 角色 / 额度 / 发布审核）→ 本手册不含，普通用户也看不到，不要带用户进去
- **启动器面板**（`⌥ Space` 的搜索框）→ 那是用户自己的面板，**只讲不点**（见 §5）

## 1. 讲解五步

1. **选页**：按用户关心的事挑 3~6 个页面；完整路由地图见 `references/platform-map.md`
2. **开窗**：**整场只开一个窗**；`open({url})` 一次开一个，`win_id` **从返回值取**
3. **点开**：目标在折叠里（会话列表、页签、抽屉、汉堡菜单）→ **先 `click` 再标**
4. **聚光**：`highlight({selector, title, desc})` 指到正在讲的位置，讲完 `clear: true`
5. **复原**：关掉讲解窗、清掉标注、点开的折叠复原

> **介绍对话界面时不开新窗**：用户正在看的那个主窗（`list()` 里 `real:true`）就是对话界面，
> 直接在它上面聚光（实测可标），别另开一个把用户界面搞乱。

## 2. 脚本模板

在 `exec` 里以 `_host=page` 执行（脚本体是原生 async JS 函数体，可 `await`、可 `return` 结果）：

```js
const sleep = ms => new Promise(r => setTimeout(r, ms))
const w = await open({url: '/skills'})            // win_id 从返回值取
const steps = [
  {sel: '.v-tab-item.is-active', title: '我的技能', desc: '这里列出你自己的技能包'},
  {sel: '.skill-card',            title: '技能卡片', desc: '点卡片进详情，点星星收藏'},
]
for (const s of steps) {
  // 写 win_id = 只在这个窗口里找（同名元素多时更准）
  await highlight({win_id: w.win_id, selector: s.sel, title: s.title, desc: s.desc, wait: 3000})
  await sleep(2000)
  await highlight({win_id: w.win_id, clear: true})
}
await close({id: w.win_id})
return {win_id: w.win_id, steps: steps.length}
```

**省略 `win_id` = 在整个页面里找**（所有窗口 + 左侧栏 + 顶栏在同一个 document 里）：

```js
// 侧边栏的启动器入口——它在任何窗口之外，只有整页搜才碰得到
await highlight({selector: '[vrefof="/os/dock"] .launcher-row', title: '启动器', desc: '⌥ Space：搜页面、Agent、技能、文件、命令', wait: 2500})
await highlight({clear: true})
```

**要点的先点开再标**：

```js
// 会话列表默认收起：点标题行展开 → 标 → 再点回去收起
await click({win_id: w.win_id, selector: '.header-fill'})
await sleep(900)
await highlight({win_id: w.win_id, selector: '.session-item', title: '历史会话', desc: '标题 · 日期 · 用量；★ 收藏', wait: 2500})
await highlight({win_id: w.win_id, clear: true})
await click({win_id: w.win_id, selector: '.header-fill'})   // 复原
```

- **一窗讲到底**：下一页用 `open({url: next, win: w.win_id})` 在原窗里换地址，别开一堆窗
- **先说后标**：先讲一句再打标注；标注停留 2~4 秒，`wait` 是等元素出现的超时（不是停留时长）
- **URL 用相对路径**（`/skills`、`/usage`），不要写 `http://localhost:4000/...`
- 手法细则、探针脚本、组件级定位、错误兜底见 `references/demo-playbook.md`

## 3. 平台速览（普通用户可见的全部页面）

| 页面 | 入口 | 一句话 |
| --- | --- | --- |
| 关于 | `/about` | 产品落地页，访客可见 |
| Agent 列表 | `/agents` | 你的 AI 伙伴 + 官方 Agent；可创建 |
| 创建 Agent | `/agents/new` | 名称 / 模型 / 头像 / 系统提示词 / 工具 |
| 会话页 | `/agents/{id}` | 对话主界面：会话切换、输入区、模型与权限、上下文占用 |
| 会话记录 | `/agents/{id}/sessions` | 该 Agent 的全部会话 |
| 实时语音 | `/agents/{id}/real` | Realtime 语音对话，边说边听 |
| 任务 | `/agents/{id}/tasks` | 定时 / 后台任务：状态、目标、恢复、追消息 |
| Agent 设置 | `/agents/{id}/settings` | 基本信息 / 系统提示词 / 工具 / 关联技能 / **记忆** |
| 技能中心 | `/skills` | 我的 / 我的发布 / 广场 / 收藏（**讲技能先点「广场」**，新用户「我的」是空的） |
| 技能详情 | `/skills/detail/cloud/{id}` | 版本、说明、包内文件、Fork / 下载 |
| 技能成员 | `.../members` | 谁能用这个私有包 |
| 技能数据 | `.../data` | 包的数据表 |
| 全部文件 | `/fs` | 云盘 + 浏览器本地 + 已连设备，三处一个管理器；可预览可编辑 |
| 设备管理 | `/hosts` | 连过的桌面 / Docker 设备，装客户端后可让 AI 操作本机 |
| 生成中心 | `/aigc` | 图片 / 视频 / 语音生成任务与产物 |
| 模型目录 | `/models` | 可用模型、定价、默认参数；也能加自己的模型端点 |
| 音色广场 | `/voices` | 音色分组、试听、自建（额度 0/10） |
| 网关管理 | `/gateways` | 把 QQ / 微信等外部渠道接进来 |
| 网关详情 | `/gateways/{id}` | 平台、语言、接入方式、开关 |
| 频道控制台 | `/gateways/{id}/channels/{cid}` | 该渠道的会话记录与代发 |
| 用量概览 | `/usage` | 余额、调用数、Token 消耗与缓存命中 |
| 调用记录 | `/usage/calls` | 逐条调用：时间、模型、Tokens、成本 |
| 额度与收支 | `/usage/credits` | 余额、充值 / 兑换、存储空间配额、额度来源 |
| 偏好设置 | `/settings` | 主题、语言、页面指令开关 |
| 个人资料 | `/settings/profile` | 头像、昵称、简介 |
| 凭据管理 | `/settings/security` | 登录凭据 / 设备凭据、退出其他设备 |
| 快捷键 | `/settings/shortcuts` | Leader 键（⌥）+ 命令键映射 |
| 桌面布局 | `/settings/desktop` | 保存窗口布局、切换方案、恢复已保存版本 |
| 公开主页 | `/users/{id}` | 公开资料与公开技能 |

## 4. 用法速查（普通用户能做的事）

回答「这个平台怎么用」时，按这张卡讲，不要临场编：

| 想做的事 | 怎么做 |
| --- | --- |
| 换个 AI 伙伴 | `/agents` → 「创建 Agent」：名称、模型、头像；再到 `/agents/{id}/settings` 写系统提示词与可用工具 |
| 让 AI 记住长期偏好 | 在对话里直接说「记住 …」；长期记忆在 `/agents/{id}/settings` → 「记忆」页签里可看可改 |
| 给 AI 装能力 | `/agents/{id}/settings` → 「关联技能」绑定；或 `/skills` 广场里收藏 |
| 让 AI 按时干活 | `/agents/{id}/tasks` 新建任务：定时跑、后台跑，状态可暂停 / 恢复 / 关闭 |
| 语音对话 | `/agents/{id}/real`，或在会话菜单里选「实时对话」 |
| 让 AI 动手做本机的事 | `/hosts` → 装客户端并连上 → 之后 AI 能读写这台机器（受逐次授权约束） |
| 找文件 / 存文件 | `/fs` 左侧「位置」：云盘是你的空间，浏览器文件是这台浏览器本地，设备目录是连上的机器 |
| 看花了多少钱 | `/usage` 看余额与今日成本、`/usage/calls` 逐条；`/usage/credits` 看充值与存储配额；缓存命中越高越省 |
| 生成图片 / 视频 / 语音 | `/aigc` 看任务与产物；对话里说「画一张…」也能直接生成 |
| 加自己的模型 | `/models` → 「模型端点」，接 OpenAI 兼容的自家后端 |
| 接外部渠道（QQ / 微信） | `/gateways` → 新建网关 → 拿 ID → 在机器人后台填上 |
| 找东西别翻菜单 | `⌥ Space` 启动器：搜页面、Agent、技能、文件、命令，回车直接开 |
| 把界面调成自己顺手的 | `/settings` 换主题与语言；`/settings/shortcuts` 改键位；`/settings/desktop` 保存窗口布局 |
| 公开自己的技能 | `/skills` → 我的发布；技能详情页可 Fork / 下载 |

## 5. OS 外壳与对话界面怎么讲

**窗口**（AI 自己就在这套窗口里跑，讲的时候可以拿自己举例）

- 三种位置：**平铺**（占工作区一格，多窗自动分屏）、**浮动**（浮在工作区上，可拖可缩）、**dock**（左侧/顶部固定车道）
- **主窗口**就是你正在跟 AI 说话的那个；同一地址的窗口会**复用**，不会越开越多
- 快捷键（默认 leader = `⌥`）：`⌥ Space` 启动器、`⌥ F` 最大化、`⌥ R` 重载、`⌥ W` 关窗；
  按住 `⌥` 不放 = **编排模式**（窗口上浮出色块，可拖拽 / 缩放 / 浮动）；面板里 `↑↓` 选、`Enter` 确定、`Tab`/`→` 下钻、`Esc` 取消

**侧边栏（dock）**——**先判状态再标**：形态（窄条 rail / 展开 panel，由菜单宽度决定）与位置（左 / 顶）。
窄条下文字类元素（`.grp-name`、`.session-title`）是 0 尺寸，标不到 → 标图标那一组：

| 位置 | 讲什么 |
| --- | --- |
| 顶部品牌区 | ivec.ai 标志与 AGENT OPERATING SYSTEM；点标志回主窗口；旁边 `«` 收起/展开侧栏 |
| Agent 组（头像 + 名字 + 角标） | 当前 Agent；角标 = 会话数；组右侧 `+` = 新建会话 / 新建 Agent；点组名展开会话列表 |
| 组内会话列表 | 历史会话；★ = 收藏；小圆点 = 状态（绿进行中 / 黄等待 / 红出错）；当前会话高亮 |
| 其他 Agent | 其他 AI 伙伴（如「伊可」），点开换人 |
| 功能入口 | 技能、用量与费用、设置；**管理员**账号还会看到「管理后台」 |
| 底部 | 放大镜 + `⌥ Space` = 启动器；主题；语言；账户 |

> 「管理后台」只对管理员出现——普通用户看不到，讲平台时别往那边带。

**启动器**：只讲不点——它的遮罩 `z-index: 10000` 压在 AI 标注（`z-index: 60`）之上，
它是用户自己的面板，AI 点开只会盖住自己的讲解。用「左下角那个放大镜，`⌥ Space`」这种位置词引导。

**对话界面**（最核心的一页，务必讲）

- 顶部：当前 Agent 名（点它是 Agent 菜单）；**会话标题那一行（点它展开历史会话列表）**；右侧 `+` 新建会话
- 底部输入区：正文框、**附件**、**麦克风**、**权限模式**（人工审批 / 自动）、**模型 + 思考档**（Low/…）、**上下文占用环**

> 讲解时优先聚光 `.grant-chip`（权限）、`.model-chip`（模型）、`.context-ring`（上下文）——
> 这三个是用户最常问「这什么意思」的地方。

## 6. 坑（踩过就会白屏/报错/看不见）

- **`win_id` 必须来自 `open()` 返回值**；同 URL 已有窗口时 `open` 会**复用**它
- **整场只开一个窗**：换页用 `open({url, win})`；报 `window "x" not found` 时用 `list()` 刷新 id
- **换页后别急着标**：`open({url, win})` 换址后等 **2.5s**——列表类页面要拉数据，元素已存在但尺寸为 0，
  这时报的是 `is not visible`（不是「找不到」），早标必失败
- **`click` 之后要 sleep ≥600ms 再标**：面板切换是异步的，刚点完就标会碰到「还在过渡」的零尺寸元素
- **先点开再标**：会话列表（点 `.header-fill`）、**技能中心（点「广场」页签，新用户「我的」是空的）**、
  文件页侧栏（点 `.icon-btn.mobile-menu`）、设置页签（点 `.v-tab-item`）——不点开就是 0 尺寸 / 空页，标不到
- **组件级定位用 `[vref="X"]` / `[vrefof="X"]`**：class 名会重复（`.session-item` 侧边栏和聊天页都有）。
  `[vref="X"]` = 组件实例**内部**（含直接子节点），`[vrefof="X"]` = 属于 X 的元素的**后代**——**两者不能混用**
- **整页搜时同名元素会误命中**：先命中文档里靠前的那个 → 要指准就写 `win_id` 或加 `vref`/`vrefof`
- **隐藏的 `v-show` 兄弟会挡住选择器**：`highlight` 只标首个匹配 → 用 `.tab-panel:not([style*="display: none"])` 排除
- **侧边栏要先判状态**：窄条 / 展开、左 / 顶，决定哪些元素能标
- **`[vref="X"]` 的首个匹配可能是 `<style>` 标签**（loader 给模板样式也打了 vref）→ 查组件根用具体 class
- **带参数的路由要带参数**：`/skills/cloud/{skill_id}` 打到不存在的包会显示「资源不存在」；
  `/agents/`（带尾斜杠）会回到 Agent 列表页，不是 404
- 讲完**必须清场**：`highlight({win_id, clear:true})` + `close({id})`；点开的折叠也复原
  （标注用户自己也能关——气泡有 ×、Esc 也能关——但 AI 讲完仍要自己清干净）

## 7. references

| 文件 | 内容 |
| --- | --- |
| `references/platform-map.md` | **全部路由**（普通用户可见）：每页的 URL、讲什么、实测聚光点、注意点；加 OS 外壳与侧边栏区域表 |
| `references/demo-playbook.md` | 讲解手法：原生指令清单、三层作用域（整页/窗口、vref 组件级、可见性）、探针脚本、click 先点开再标、侧边栏判状态、节奏话术、错误兜底、单窗导览完整示例 |
