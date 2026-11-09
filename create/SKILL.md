---
name: create
version: 1.0.14
nickname: create 技能包
description: AIC 扩展作者手册——把一句人话需求拆成云端/界面/设备三端的实际改动：技能包与数据、界面与页面指令、Host/Pod 脚本批量调用技能 API、桌面档案规则、设备命令与常驻服务；含判定流程、字段契约、红线与验收。
keywords: [create, 扩展, 技能包, 界面, 档案, 规则, 设备, 命令, 服务, 模板, API, 批处理, 批量上传]
icon: fa-solid fa-layer-group
---

# create 技能包

把一句人话需求（「我想做一个能记录读书笔记的应用」）变成**具体要写的文件**。
AIC 的扩展落在三个端上，每端有自己的持久化机制和交互协议——**按端选内容物，别自造形态**。

## 0. 三端速查

| 端 | 负责 | 持久化 | 交互协议 | 能加的东西 | 分篇 |
|---|---|---|---|---|---|
| ☁️ 云端 | 存储与服务 | UFS 文件 + 每个包自己的数据表 | HTTP API（Page/Host/Pod 可调，身份自动注入） | 技能包（说明书/接口/表）、用户空间文件 | `references/cloud-package.md` `references/cloud-data.md` |
| 🖥️ 界面 | 交互与呈现 | 用户产物统一经 `$fs` 读写；本地存储只保留界面偏好与最近记录 | 页面指令（AI 可直接操作页面）+ 页面内事件 | 界面（.html 页面或组件）、typed Profile | `references/ui-component.md` `references/ui-storage.md` `references/ui-profile.md` |
| ⌨️ 设备 | 执行 | 设备本机配置与状态（`~/.aic`、服务配置），内容从云端取 | 命令行与服务命令；内建 curl 可循环调用技能 API | 脚本、原生命令、常驻服务 | `references/device-cli.md` |

**多数需求横跨多端**（"带数据的应用" = 云端包 ＋ 界面页 ＋ 可选设备命令）。别只做一端就交。

## 1. 六步流程

### ① 拆需求 → 三端各要什么

先写一行清单并在回复里写出来：`云端：… / 界面：… / 设备：…`。
写不出来的那端 = 不做（最小交付）。判断归属：

- 关掉浏览器还在的 → **云端**
- 用户看得见、点得到的 → **界面**
- 要动用户自己电脑/手机的 → **设备**
- 定时/周期执行 → **云端**（平台的任务调度）
- 对话框已经能完成主任务 → UI 只做展示、输入或快捷交接；不另造工作台、项目档案、备注或选择回写流程

### ② 选内容物与落位

| 需求长什么样 | 内容物 | 放哪 | 生效 | 读 |
|---|---|---|---|---|
| 一个界面 | `.html` | 技能包 `ui/` / 用户云空间 / 页面本地 | 装载 | `references/ui-component.md` |
| 文档/项目编辑器 | `.html` + `$fs` + 自定义存档格式与 opener | 用户选择的 `/fs` 位置 | 打开即读写 | `references/ui-storage.md` `references/cloud-package.md` |
| 能查数据 | 表 + `api/*.sqlx` | 技能包 | 装载 | `references/cloud-data.md` |
| 一个能发布的能力包 | `SKILL.md`（+ 上面两种） | 技能包 | 装载 → 审核发布 | `references/cloud-package.md` `references/publishing.md` |
| 换桌面（换组件/填插槽/排窗口） | typed Profile 文档 | 用户云空间 `.profile/<name>.json` | aliases/slots→reload，layout→live | `references/ui-profile.md` |
| 设备上多一条命令 | 程序源码 / 脚本 / 服务声明 | 设备本地 | 用户安装 | `references/device-cli.md` |
| 设备批处理 / 批量写入云端 | 普通脚本 + `api/*.sqlx` | 包内 `scripts/` + `api/` | 用户运行脚本 | `references/device-cli.md` `references/cloud-data.md` |

### ③ 动手前读对应分篇

**只读你要动的那几端**。字段名、约束、寻址方式都在分篇里，照抄比猜准。
需要向用户解释方案、或判断归属拿不准时，读 `references/model.md`。

### ④ 建容器（需要包时才做）

私有包目录默认只读。建行、授权、写文件是三件事，顺序不能反：

1. 建行：`exec _host=page` → `curl /api/skills -X POST -H 'Content-Type: application/json' -d '{"name":"example"}'`
   → 返回 `skill_id` 与 `url_prefix`，并落一份 SKILL.md 骨架
2. 授权：`grant fs /skills/{skill_id}`
3. 写文件：fs 工具写 `/skills/{skill_id}/...`（fs 路径，与页面 URL 不同段）
4. 写包根 `manifest.json`（schema 1）：页面清单进 `ui.pages`（页面 id → 包内
   `ui/<id>.html`）；组件贡献进 `ui.components`，打开规则进 `ui.openers`；设备命令进
   `host`。可复制 `templates/skill/manifest.json`。**没有 `ui.pages` 的包不出 UI 徽标、
   不进 launcher 子页面树**；frontmatter 不承担这些声明。

### ⑤ 按该端的协议实现

- **云端**：页面内 API 用**相对地址**（`api/xxx`，前缀自动补）；Host/Pod 脚本用内建
  `curl {url_prefix}/api/xxx`，不要写死 id。
- **界面**：**完整 HTML 文档**（片段会静默不挂载）；页面清单同步写进包根
  `manifest.json` 的 `ui.pages`；颜色字号一律用平台 token；
  窗口宽度用 `@container`（不是 `@media`）；要让 AI 操作页面就声明 `pageDesc.commands`。
  涉及文档、项目或素材存储时统一走 `$fs`，提供打开/新建/最近记录首页，不另建私有项目库。
- **设备**：一次性处理或批量回写优先普通脚本 + 技能 API，不为 for 循环另造 MCP；
  命令参数走 stdin；**只入库源码**，构建产物与二进制不进包。

### ⑥ 验收

按 §4 的清单逐条验。**没验证不算做完**——尤其档案规则要看 `profile inspect` 的生效表与被拒清单。

## 2. 红线（违反会被平台拒绝或静默失效）

1. **档案规则的目标只能指向平台自带目录**（`/ai/` `/os/` `/page/` `/layout/` `/shared/` `/widgets/` `/assets/`）；
   档内禁 `..` 段（不静默改写，直接报错）。
2. **外壳与管理页不可被替换**（`/os/` `/layout/` `/vb` `/page/admin`——键和目标都算）。
3. **插槽片段必须纯结构**：禁脚本、禁数据绑定、禁 iframe/内联 `on*`，且只放本人空间。
4. **只入库源码**：二进制、构建产物、zip、密钥、用户数据一律不进容器。
5. **不硬编码平台地址**：用相对路径与运行时前缀（`$mod.scoped`、`url_prefix`）。
6. **接口按用户隔离**：每张表带 `user_id`，查询必须 `user_id = :user_id`。
7. **最小交付**：不需要的界面/接口/数据/服务一律不加；只要一个界面就别建包；对话可完成的主任务不另造工作台、项目机制或私有格式。
8. **五个动作分开**：建行、写文件、发布、装软件、授权，不能用一个代替另一个。
9. **UI 不自建文件体系**：用户文档、项目存档与素材必须走 `$fs`；禁止直写 OPFS/IndexedDB、用项目名代替文件路径，或在应用内重复实现目录扫描、项目删除与跨端迁移。
10. **界面不变成说明书**：主体呈现真实对象与动作，不用功能介绍、方法教学或格式路径填空；正常打开、新建和切换不弹成功提示，通知统一用平台 `$message`，不自造 toast。

## 3. 平台动作速查

| 动作 | 怎么调 |
|---|---|
| 调技能数据 API | Page/Host/Pod 均可：`curl {url_prefix}/api/...`；页面内则用 `$fetch('api/...')` |
| 调平台管理接口 | `exec _host=page` → `curl /api/...`；不要把技能 API 的三端支持扩展到管理接口 |
| 建包 / 授权 / 写包 | 见 §1 ④；写文件用 fs 工具，路径 `/skills/{id}/...` |
| 读写用户文件 | fs 工具，路径 `/u/{uid}/...` |
| UI 打开/另存为 | 页面内 `$fs.pickFiles` / `$fs.pickSavePath`，再用 `$fs.readFile/writeFile`；跨端复制用 `$fs.transfer` |
| 操作桌面档案 | `exec _host=page` → `profile list` / `save <name>` / `apply <name>` / `revert` / `inspect` |
| 开窗口 | `exec _host=page` → `open <url>` / `list` / `close <win_id>` / `reload` |
| 调设备命令 | `exec _host=<设备ID>` → `<alias>` 列工具 / `<alias> <tool> --help` 看参数 / `<alias> <tool> --input '{...}' --json` 调用（`mcp ...` 仅调试直通） |
| 页面调设备 | `$hosts.openTools(hostId)` → `execCall(script, {stdin})` → 用完 `close()` |

## 4. 验收清单

- **界面**：能打开；资源无 404；亮/暗主题都正常；声明的页面命令能被 AI 调通；可见文案双语完整；缓存页面重新激活时路由参数同步；通知走平台 `$message`。正常打开、新建与切换不弹成功提示。
- **文件型 UI**：无文档时显示打开/新建/最近记录首页；文件可保存到用户选择的 `/fs` 位置；项目资源使用相对路径；移动或跨端复制后可重新打开。
- **数据**：接口通；换账号看不到别人的数据；包内无真实用户数据；有批处理脚本时，Host/Pod 至少实测一次读写、一条失败即停和结果读回。
- **档案**：`profile inspect` 里 aliases/slots 在生效表；被拒项在 rejected 里可查；改 aliases/slots 后 reload 生效。
- **包**：SKILL.md 可执行、引用完整；包内无二进制/密钥/用户数据；发布前自查过。
- **设备**：源码在包内、产物不在；正文写全安装/依赖/路径/调用；设备上跑得通。

## 5. 分篇索引

| 分篇 | 讲什么 | 什么时候读 |
|---|---|---|
| `references/model.md` | 三端模型、需求→组合对照表、跨层说明 | 判断不清归属时；需要向用户解释方案时 |
| `references/cloud-package.md` | 技能包结构、frontmatter、建行写包、寻址 | 要建包或往包里加文件 |
| `references/cloud-data.md` | 表声明、sqlx 接口、Page/Host/Pod 调用与批处理、用户隔离、SQL 规范、owner 调试直连 | 要存数据、批量写入或查/修数据 |
| `references/ui-component.md` | 完整 HTML 文档、vhtml 语法、容器响应式、生命周期、双语、反馈与页面指令 | 要写界面 |
| `references/ui-storage.md` | UI 文件/存档默认契约、`$fs` 选择器、首页、相对资源、格式注册与迁移 | UI 涉及文档、项目、素材或导出时 |
| `references/ui-profile.md` | typed registry + layout、硬约束、生效语义、档案命令面 | 要改桌面 |
| `references/device-cli.md` | 脚本批量调用技能 API、命令与服务形态、manifest 字段、真实 MCP/Streamer 契约、源码与产物边界 | 要动设备或做设备批处理 |
| `references/materials.md` | 共享服务、页面/设备通道、身份边界 | 要调平台能力或设备 |
| `references/publishing.md` | 发布流程、审核要点、fork、下架 | 用户说"发布出去" |

模板在 `templates/`（技能包骨架、组件页、档案、服务声明），可复制参考的成品在 `examples/`。
