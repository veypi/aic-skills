# 平台页面地图（普通用户可见的全部路由）

> 路由表来自平台 `ui/routes.js`；每页的聚光点都在当前平台版本**实测过**（2026-11-16）。
> 平台改版后选择器可能失效——失效时用 `demo-playbook.md` §3.4 的探针脚本重找，别硬套。
> URL 一律**相对路径**（不要写 `http://localhost:4000/...`）。

## 对话与 Agent

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/agents/{agent_id}` | 会话页（对话主界面） | 当前 Agent、会话切换、输入区、模型与权限 | `.agent-trigger`（当前 Agent）、`.header-fill`（会话标题，**点击展开会话列表**）、`.header-action`（`+` 新建会话）、`.sessions-dropdown`（会话下拉容器，`show` 属性控显隐）、`.session-item`（单条会话）、`.session-title`、`.input-zone`、`.ta-box`（输入框）、`.attachments`、`.btn-icon`（麦克风）、`.grant-chip`（权限模式）、`.model-chip` / `.chip-name` / `.chip-level`（模型与思考档）、`.reasoning-range`、`.context-ring`（上下文占用） |
| `/agents/{agent_id}/real` | 实时语音对话 | Realtime：开始/停止、音色、模型 | `.rt-avatar-wrap`、`.rt-controls`、`.rt-action`（开始/停止）、`.rt-model`、`.chip-voice`（音色） |
| `/agents/{agent_id}/sessions` | 会话记录 | 该 Agent 的全部会话 | `.hero`、`.name-row`、`.avatar`、`.nav-actions`、`.v-btn.rounded-full` |
| `/agents/{agent_id}/tasks` | 任务 | 定时 / 后台任务：状态、目标、恢复、追消息 | `.v-tab-item`（全部/活跃/已暂停/已关闭）、`.task-card`、`.task-card-title`、`.task-card-goal`、`.panel.sidebar`、`.pagination` |
| `/agents/{agent_id}/settings` | Agent 设置 | 基本信息 / 系统提示词 / 工具 / 关联技能 / **记忆** | `.v-tab-item`（五个页签）、`.tab-panel:not([style*="display: none"])`（当前面板）、`.form-group`、`.model-chip`、`.voice-picker`（音色）、`.topbar-actions`（删除/取消/保存） |
| `/agents` | Agent 列表 | 你的 AI 伙伴、官方 Agent、创建入口 | `.hero-title`、`.stat-chip`、`.agent-search`、`.agent-card`、`.card-name`、`.card-desc`、`.card-meta`（模型）、`button.v-btn.v-btn--colored`（创建 Agent） |
| `/agents/new` | 创建 Agent | 名称 / 模型 / 头像 / 系统提示词 / 工具 | `.v-tab-item`、`.form-grid`、`.form-group`、`.model-chip` |

> **会话区要点**：`.header-fill` 点击才展开会话列表（`toggleSessions`），默认收起；
> 标之前先 `click` 展开，标完再点一次收起。完整会话列表另一份在**左侧栏** Agent 组里。

## 技能

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/skills` | 技能中心 | 我的 / 我的发布 / 广场 / 收藏 | `.v-tab-item`（四个页签，**index 2 = 广场**）、`.skills-search`、`.skill-card`、`.card-name`、`.card-desc`、`.card-fav`（收藏星标）、`.section-actions`（新建技能） |
| `/skills/detail/cloud/{skill_id}` | 技能详情 | 版本、说明、包内文件、Fork / 下载 | `.head-main`、`.v-tag`（公开/私有）、`.skill-desc`、`.info-grid`、`.row-item`（包内文件清单）、`.head-actions`（打开界面 / Fork / 下载） |
| `.../members` | 成员与授权 | 谁能用这个私有包 | `.invite-form`（邀请）、`.hint`（席位 0 / 0）、`.v-empty`（暂无关联用户） |
| `.../data` | 数据表管理 | 包的数据表 | 与详情同壳，往下滚到数据表段 |
| `/skills/cloud/{skill_id}` | 技能自己的界面 | 包内 UI 裸入口 | 用包自带手册的引导脚本，别自己猜 |

## 文件

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/fs` | 全部文件 | 云盘 / 浏览器文件 / 设备目录；列表、搜索、上传、新建 | `.toolbar`、`.crumbs` / `.crumb.current`、`.search`、`.tool-btn`（新建 / 上传 / 列表-表格视图）、`.list-head`、`.file-list`、`.state`（空目录提示）、`.statusbar`、`.location`（位置条目） |
| `/fs/<路径>` | 指定目录 | 同上，落在某个目录 | `.crumb.current`、`.file-list` |

> **「位置」侧栏默认收起**（`.content.locations-collapsed`）→ 先 `click` `.icon-btn.mobile-menu` 展开，
> 展开后侧栏带 `.open`，标 `.locations.open`。

> **讲技能先点「广场」**：新用户的「我的」是空的（没装任何技能），拿它当讲解对象会对着空白页说话。
> 先 `click .v-tab-item`（index 2 = 广场）再标 `.skill-card`——广场与「我的」共用同一套卡片 class，
> 区别只在哪个页签激活。
> 「我的」是**已装 / 自建**的位置，「我的发布」是自己上架的技能，「收藏」是收藏过的。

## 设备

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/hosts` | 设备管理 | 客户端 / Docker、在线状态、下载客户端 | `.hero-title`、`.v-tab-item`（客户端 / Docker）、`.stat-chip`（设备总数 / 在线 / 离线）、`.hero-guide`、`.guide-download-grid`、`.guide-platform-name` |

> 讲设备时强调**权限是逐次授予的**：AI 在设备上做的事受会话审批约束。

## 生成 / 模型 / 音色

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/aigc` | 生成中心 | 图片 / 视频 / 语音任务与产物、状态筛选 | `.page-title`、`.v-tab-item`（全部/图片/视频/语音）、`.status-select`、`.asset-grid`、`.asset-card`、`.asset-cover`、`.status-badge`、`.asset-prompt`、`.pagination` |
| `/models` | 模型目录 | 模型分组、定价、默认参数、测试模型、自建端点 | `.mp-toolbar`、`.mp-search`、`.v-input__inner`（类型筛选）、`.mp-group`、`.mp-item`、`.mp-item-name`、`.mp-item-sub`（定价）、`.mp-detail`、`.mp-head-actions`（测试模型 / 编辑 / 删除）、`.mp-tabs`、`button.v-btn.v-btn--colored`（模型端点） |
| `/voices` | 音色广场 | 音色分组、试听、自建额度 | `.toolbar`、`.quota`（自定义音色 0/10）、`.search`、`.group`、`.group-head`、`.card`、`.name`、`.play`（试听）、`.badge`（内置 / 女声 / 语言）、`button.v-btn.v-btn--colored`（创建音色） |

## 网关

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/gateways` | 网关管理 | 外部渠道（QQ / 微信等）接入与在线状态 | `.page-title`、`.primary-btn`（新建网关）、`.gw-row`、`.gw-name`、`.platform-badge`（平台）、`.status-dot`（在线 / 离线）、`.gw-id` |
| `/gateways/new`、`/gateways/{gateway_id}` | 新建 / 网关详情 | 平台、语言、接入方式、开关 | `.gd-title`、`.gd-id`、`.gd-dot`（在线状态）、`.gd-btn`（编辑）、`.gd-btn.danger`（删除）、`.gd-card`、`.gd-kv`（平台 / 语言 / 接入方式）、`.gd-toggle` |
| `/gateways/{gateway_id}/channels/{channel_id}` | 频道控制台 | 该渠道的会话记录与代发 | `.gw-conv-title`、`.gw-conv-sub`、`.gw-bubble`、`.gw-bubble-text`、`.gw-input`、`.gw-input-bar`、`.gw-btn.gw-history`、`.gw-file`、`.gw-empty` |

## 用量与费用

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/usage` | 用量概览 | 余额、调用数、Token、缓存命中、热力图 | `.balance-pill`（余额）、`.quick-range`（今天 / 近 7 天 / 近 30 天）、`.ov-table`、`.mix-center`（缓存命中）、`.token-heatmap` |
| `/usage/calls` | 调用记录 | 逐条调用：时间、模型、Tokens、成本 | `.logs-toolbar`、`.table-wrap`、`.cache-rate`（缓存命中）、`.cost-cell`、`.status-200` |
| `/usage/credits` | 额度与收支 | 余额、充值 / 兑换、存储空间配额、额度来源 | `.balance-value`、`.balance-actions`（充值 / 兑换）、`.quota-item` / `.quota-nums`（存储空间）、`.tab`（额度来源 / 消费记录）、`.source-gift`、`.status-active` |

> **余额与成本是两回事**：`/usage` 的 `.balance-pill` 是账户余额，`.cost-cell` 是单次调用花费。

## 设置

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/settings` | 偏好设置 | 主题、语言、页面指令开关、四个入口 | `.eyebrow`、`.card`、`.segmented` / `.seg`（浅色 / 深色 / 跟随系统）、`.toggle-row`、`.links` / `.link`（个人资料 / 账号安全 / 快捷键 / 布局） |
| `/settings/profile` | 个人资料 | 头像、昵称、简介 | `.profile-container`、`.section-title`、`.avatar-section`、`.avatar`、`.avatar-overlay`（换头像）、`button.v-btn.v-btn--colored`（从素材库选择） |
| `/settings/security` | 凭据管理 | 登录凭据 / 设备凭据、退出其他设备 | `.tabs-row`、`.v-tab-item`（登录凭据 / 设备凭据）、`.panel-bar`（退出其他设备）、`.key-list`、`button.v-btn.v-btn--colored` |
| `/settings/shortcuts` | 快捷键 | Leader 键（⌥）+ 命令键映射 | `.card-title`（Leader 键）、`.badge` / `.kh`（⌥）、`.row`、`.name`（呼出启动器）、`.btn`（修改） |
| `/settings/desktop` | 桌面布局 | 保存窗口布局、切换方案、恢复已保存版本；别名 / 槽位 / 打开规则 | `.current-main`（当前使用）、`.badge.warning`（有未保存修改）、`.current-actions`、`.btn.primary`（保存当前布局）、`.editing-bar` |

## 公开页

| 路由 | 页面 | 讲什么 | 聚光点（实测） |
| --- | --- | --- | --- |
| `/about` | 关于（产品落地页） | 访客可见的产品介绍 | `.eyebrow`（PUBLIC BETA）、`.hero-title`、`.hero-subtitle`、`.hero-actions`（继续工作 / 查看应用成果 / 查看技术架构）、`.btn-primary` |
| `/users/{user_id}` | 公开用户主页 | 公开资料与公开技能 | `.user-card`、`.avatar`、`.username`、`.nickname`、`.stats-card`、`.stat-item`（公开技能 / Tokens）、`.heatmap-card` |

## OS 外壳（窗口 / 侧边栏 / 启动器）

| 东西 | 怎么用 | 能不能聚光 |
| --- | --- | --- |
| 窗口位置 | 平铺（工作区自动分屏）/ 浮动（可拖可缩）/ dock（固定车道） | 能（窗口内容在 `.win-box` 内） |
| 主窗口 | 就是你正在对话的那个窗口（`list()` 里 `real:true`） | 能 |
| 同地址窗口 | 复用，不新开 | — |
| 编排模式 | 按住 `⌥` 不放，窗口上浮出色块：拖拽 / 缩放 / 浮动 / 关闭 | 能（省略 `win_id` 整页搜） |
| 快捷键 | `⌥ Space` 启动器、`⌥ F` 最大化、`⌥ R` 重载、`⌥ W` 关窗；面板内 `↑↓`/`Enter`/`Tab`/`Esc` | 能（省略 `win_id`） |
| 启动器 | 搜窗口、页面、Agent、技能、文件、命令；`↵` 打开、`→` 下钻、`⌥↵` 直接打开 | 入口能标（`.launcher-row`）；**面板不标也不点**（见下） |
| 侧边栏 | 左栏按组（Agent 组 / 技能组 / 用量组），点会话直接切 | 能（省略 `win_id`；**先判形态**，窄条只能标图标） |
| 顶栏 / 账户 / 语言 | 用户头像、语言、主题在顶栏与 dock 底部 | 能（省略 `win_id`） |

> **启动器只讲不点**：它的遮罩 `z-index: 10000`，压在 AI 标注（`z-index: 60`）之上；
> 它是用户自己的面板，AI 点开它只会盖住自己的讲解。

### 侧边栏区域与选择器

| 区域 | 选择器 | 讲什么 |
| --- | --- | --- |
| 品牌 | `.brand`、`.brand-mark`、`.brand-title` | ivec.ai 标志；点标志回主窗口 |
| 收起/展开 | `.mode-btn` | 侧栏折叠按钮（展开态才有） |
| 分组 | `.grp`、`.grp.active`、`.grp-head`、`.grp-name`、`em.badge` | 一个分组（Agent / 技能 / 用量）；角标是会话数 |
| 新建 | `.grp-add` | 组右侧 `+`：新建会话 / 新建 Agent |
| 组内会话 | `.grp-fold`、`.grp-body`、`.session-item`、`.session-title` | 历史会话；★ 收藏；`i.session-status`（`.active` / `.wait` / `.error`）状态点 |
| 其他 Agent | `.grp` 里的 `span.ico` | 其他 AI 伙伴 |
| 功能入口 | `i.fa-cubes`（技能）、`i.fa-chart-line`（用量）、`i.fa-gear`（设置）、`i.fa-shield-halved`（管理后台，仅管理员） | 点图标直达对应页 |
| 底部 | `.dock-bottom`、`.launcher-row`（`⌥ Space` 启动器）、`.pref-row`、`.header-user` | 启动器 / 主题 / 语言 / 账户 |

> **标侧边栏前先判状态**：形态（窄条 rail / 展开 panel，由菜单宽度决定）与位置（左 / 顶）；
> 窄条下 `.grp-name`、`.session-title` 是 0 尺寸，标不到 → 标图标那一组。

## 不在范围（本手册不含）

- **管理后台** `/admin/*`：用户、角色、OAuth、额度发放、发布审核、维护——普通用户看不到，
  讲了只会让用户困惑；管理员另有其手册
- 内部接口、数据库、部署与运维——属于开发文档，不属于「给用户讲平台」
