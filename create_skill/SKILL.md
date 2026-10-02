---
name: create_skill
version: 0.2.0
nickname: 创建 Skill 指南
description: 创建或修改 aic 的单文件界面、静态描述技能与组合技能包；技能包必带 SKILL.md 使用说明，UI、API、CLI 三种正交扩展按需组合；含现行包格式契约、复制即用模板与发布/装设备全流程。用户要"做个页面/工具/技能/自动化"时必读
keywords: [skill, 创建, 技能包, 组件, SKILL.md, ui, api, cli, stream, tables, 模板, 发布, 自动化]
icon: fa-solid fa-wand-magic-sparkles
---

# 创建 Skill：先选形态，再选能力

面向在 aic 中创建或修改能力的 AI。每个技能包必带 SKILL.md，说明何时使用、如何使用和必要前提；UI、API、CLI 是三种正交的可选扩展。三种扩展都不需要时，仅交付静态说明技能；单独的 HTML 也可以作为非技能组件交付。不要创建空目录、占位说明或没有用途的服务。

## 现行契约

2026-10-02 核对（v6.1）：SKILL.md 必需；UI、API、CLI 三种扩展**均已落地可运行**——cli/manifest.json 声明 providers（process/service）与 streams，process = argv/stdin/stdout 透传，service = unix socket 帧协议（skillproc）；**provider 可用任何语言编写，只需实现交互协议**，Go 作者可参考 `sdk/go` 与 browser/cua/hello 包源码。

**模板文件在 `templates/` 下，复制后改内容即可，不要从零写结构。**

## 1. 选择交付形态

先根据请求选择一种形态，不按级别逐级升级：

| 形态 | 什么时候用 | 最小交付 |
|---|---|---|
| 单界面组件 | 只需要一个独立页面，不需要包发现、资源组织或发布 | 一个完整 `.html` 文件（落点见 current-format.md） |
| 纯静态描述 | 只需要给 AI 提供知识、步骤、规范或操作说明 | `SKILL.md`，必要时加 references |
| 技能包 | 需要持久数据（tables/api）、设备命令（cli）、多页应用、可发布分发 | SKILL.md + 所选 UI/API/CLI 扩展；三项均可不选 |

单文件组件不必变成技能包；一旦包装为技能，就必须提供 SKILL.md。纯界面包采用 SKILL.md + UI，说明如何打开、操作及适用限制；纯描述技能无需 UI/API/CLI。

## 2. 先写使用说明，再选择三种扩展

SKILL.md 必需：frontmatter 是包元数据来源，正文提供触发场景、用法、前提和例子。说明应与实际能力一致；UI-only 写界面用法，API-only 写调用方式，CLI-only 写安装前提与命令示例。包加载和发布必须校验这个文件，但运行扩展无需先把正文加载到 AI 上下文。

| 扩展 | 选择依据 | 与其他扩展的关系 |
|---|---|---|
| UI | 人是否需要表单、画布、列表或操作面板？ | 可纯前端；需要时才调用 API/CLI |
| API | 是否需要独立、可认证的结构化接口？ | 页面关闭后仍可调用；tables 是可选存储 |
| CLI | 是否需要目标设备的程序、自动化或驻留服务？ | 不打开 UI 也可运行；stream 按需提供 |

具体入口可以有明确依赖，例如 browser 的实时 UI 依赖 browser CLI 与 RTC。不要把某个入口的依赖扩大成整个包或所有技能的通用前提。

以下技能均必带 SKILL.md：纯描述操作规范；UI-only 计算器；API-only 数据服务；CLI-only 格式转换器；UI+API 待办；UI+CLI 设备控制和 browser/cua。"only" 仅表示只选择一种运行扩展，不省略使用说明；没有需求就不添加其他扩展。

pageDesc 是页面已打开时供 AI 操作的可选接口；只有需要 AI 操作页面才设计指令或 status，不要求每个页面都提供。它不能代替关闭页面后仍可调用的 CLI。

## 3. 按所选能力加载资料

| 文件 | 何时读取 |
|---|---|
| [current-format.md](references/current-format.md) | 写任何包之前：现行包结构、frontmatter、四类能力契约、寻址与 fs 门 |
| [platform-runtime.md](references/platform-runtime.md) | 开窗、文件路径、平台服务与排障 |
| [page-ui-manual.md](references/page-ui-manual.md) | 编写 UI、可选 pageDesc、响应式与样式 |
| [data-manual.md](references/data-manual.md) | 编写 sqlx API 和实际需要的 tables |
| [publishing.md](references/publishing.md) | 发布、审核、版本与大小限制 |
| `templates/` | 复制即用骨架（见 §5 索引） |

写 vhtml 页面时加载目标环境提供的 vhtml 技能取得完整语言契约；没有它时按本包页面手册和现有示例推进，不假定未提供的接口。

在 aic 内读取本包参考资料：用 load 返回的 `url_prefix` 拼路径（`/skills/cloud/{id}/references/...`），不自行猜测前缀。

## 4. 实施流程

1. 根据请求确定交付形态和必要能力；已明确的信息不重复询问。
2. 技能先写 SKILL.md，再实现所选 UI/API/CLI 扩展；只声明真实依赖，不用一份页面承担整个后台生命周期。单 HTML 作为非技能交付时无需包结构。
3. 云端工作区：建行（`POST /api/skills {name}`）→ fs 门写文件（`PUT /fs/cloud/skills/{id}/...`，私有行 owner 可读写）→ 调试（页面 `{url_prefix}/...`，api 直接调）。模板从本包 `templates/` 读取改入。
4. 分别验证所选能力，再验证组合链路。没有 UI 就不做开窗测试，没有 API 就不添加数据库。
5. 交付入口、实际验证结果与未完成部分；发布、设备安装、权限授予是不同动作，按用户授权执行。

普通已有 CLI 可以继续通过设备 exec 使用；只有需要技能发现、固定命令绑定、配套 UI 或驻留 stream 时才打包注册。

## 5. 示例与模板

现有示例（均含 SKILL.md，可复制后按现行契约改造）：

- `examples/hello`：界面与可选 AI 页面指令。
- `examples/notes`：界面+文件服务，无业务数据库。
- `examples/todo_min`：界面+API+存储，带独立 HTTP 调用示例。

复制即用模板（`templates/`，已按现行契约核对）：

| 模板 | 说明 |
|---|---|
| `templates/ui/index.html` | 最小 vhtml 页面（env.js 引导 + $fetch 调包内 api 示例） |
| `templates/tables/items.json` | 数据表（user_id 隔离约定 + required 示例） |
| `templates/api/post.add.sqlx`、`templates/api/get.list.sqlx` | 增/查接口 |
| `templates/cli/manifest.json` + `templates/cli/bin/hello` | 最小 process provider（shell 脚本：解析 argv、JSON 输出契约，已实测） |
| `templates/scripts/` | 包内资源脚本骨架（随包分发，运行期相对包目录调用） |

## 6. 按能力验收

- SKILL.md（所有技能必验）：文件及 frontmatter 有效，使用说明明确、步骤可执行、引用能找到；frontmatter name 与注册表行 name 一致。缺少该文件不能交付为技能包。
- UI：能直接打开，资源/相对路径正确，适应窗口大小；只有声明 AI 操作时才验证 pageDesc。
- API：不开 UI 也能调用；参数绑定、身份隔离与错误语义正确；仅在需要业务数据时定义表。
- CLI：安装/注册与实际执行都验证；标准流、退出码、管道、取消生效；不依赖页面存活。
- stream：提供方与数据版本匹配，慢消费有界，断线/关闭释放句柄，不自动重放输入。
- 组合：缺依赖的入口有明确状态，独立能力仍可用；包升级不混用旧 UI 与新 provider。
- 发布：只打包代码、声明和静态资产，不带用户数据、密钥或运行状态；规则见 publishing.md。
