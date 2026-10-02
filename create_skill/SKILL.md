---
name: create_skill
nickname: 创建 Skill 指南
description: 创建或修改 aic 的单文件界面、静态描述技能与组合技能包；技能包必带 SKILL.md 使用说明，UI、API、CLI 三种扩展按需组合，指导页面、数据接口、工具注册和发布，并区分当前可运行能力与待实现协议
keywords: [skill, 创建, 技能包, 组件, SKILL.md, ui, api, cli, stream, vsh, 发布]
icon: fa-solid fa-wand-magic-sparkles
---

# 创建 Skill：先选形态，再选能力

面向在 aic 中创建或修改能力的 AI。每个技能包必带 SKILL.md，说明何时使用、如何使用和必要前提；UI、API、CLI 是三种正交的可选扩展。三种扩展都不需要时，仅交付静态说明技能；单独的 HTML 也可以作为非技能组件交付。不要创建空目录、占位说明或没有用途的服务。

## 实现状态

2026-10-01 核对：当前 aic 使用 v5 包解析，SKILL.md 始终是必需入口，目标 v6 也保留这一要求。当前可交付纯描述、附带说明的 UI/API 包；CLI 只有目录标记，**cli/manifest.json 注册、provider/stream 协议与配套 UI SDK 尚未实现**。本指南采用“必需说明 + 三种正交扩展”的模型，不把规划当成可调用接口。

- 用户要立即运行：先读 [当前格式与能力限制](references/current-format.md)，按目标部署实际支持的机制交付。
- 用户要规划 v6、改造平台或写目标格式草案：读 [必需说明与三种正交扩展](references/skill-v6.md)，明确标注未实现的依赖。
- 只有目标部署已验证支持相应 schema/组件/协议后，才使用 v6 可运行模板。不能因为读到本文件、存在 cli 目录或生成了 manifest 就声称注册成功。

## 1. 选择交付形态

先根据请求选择一种形态，不按 L0–L4 逐级升级：

| 形态 | 什么时候用 | 最小交付 |
|---|---|---|
| 单界面组件 | 只需要一个独立页面，不需要包发现、资源组织或发布 | 一个完整 `.html` 文件 |
| 纯静态描述 | 只需要给 AI 提供知识、步骤、规范或操作说明 | `SKILL.md`，必要时加 references |
| 技能包 | 需要独立身份、发现、版本、多文件资源、安装或发布 | SKILL.md + 所选 UI/API/CLI 扩展；三项均可不选 |

单文件组件不必变成技能包；一旦包装为技能，就必须提供 SKILL.md。纯界面包采用 SKILL.md + UI，说明如何打开、操作及适用限制；纯描述技能无需 UI/API/CLI。

## 2. 先写使用说明，再选择三种扩展

SKILL.md 必需：frontmatter 是包元数据来源，正文提供触发场景、用法、前提和例子。说明应与实际能力一致；UI-only 写界面用法，API-only 写调用方式，CLI-only 写安装前提与命令示例。包加载和发布必须校验这个文件，但运行扩展无需先把正文加载到 AI 上下文。

| 扩展 | 选择依据 | 与其他扩展的关系 |
|---|---|---|
| UI | 人是否需要表单、画布、列表或操作面板？ | 可纯前端；需要时才调用 API/CLI |
| API | 是否需要独立、可认证的结构化接口？ | 页面关闭后仍可调用；tables 是可选存储 |
| CLI | 是否需要目标设备的程序、自动化或驻留服务？ | 不打开 UI 也可运行；stream 按需提供 |

具体入口可以有明确依赖，例如 Browser 的实时 UI 依赖 browser CLI 与 RTC。不要把某个入口的依赖扩大成整个包或所有技能的通用前提。

以下技能均必带 SKILL.md：纯描述操作规范；UI-only 计算器；API-only 数据服务；CLI-only 格式转换器；UI+API 待办；UI+CLI 设备控制和 Browser/CUA。“only”仅表示只选择一种运行扩展，不省略使用说明；没有需求就不添加其他扩展。

pageDesc 是页面已打开时供 AI 操作的可选接口；只有需要 AI 操作页面才设计指令或 status，不要求每个页面都提供。它不能代替关闭页面后仍可调用的 CLI。

## 3. 按所选能力加载资料

| 文件 | 何时读取 |
|---|---|
| [current-format.md](references/current-format.md) | 需要在当前 v5 立即运行或解释兼容边界 |
| [skill-v6.md](references/skill-v6.md) | 规划正交包、CLI/provider/stream 或迁移 |
| [platform-runtime.md](references/platform-runtime.md) | 开窗、文件路径、平台服务与排障 |
| [page-ui-manual.md](references/page-ui-manual.md) | 编写 UI、可选 pageDesc、响应式与样式 |
| [data-manual.md](references/data-manual.md) | 编写 SQLX API 和实际需要的 tables |
| [publishing.md](references/publishing.md) | 发布、审核、版本与现行大小限制 |

写 vhtml 页面时加载目标环境提供的 vhtml 技能取得完整语言契约；没有它时按本包页面手册和现有示例推进，不假定未提供的接口。

在 aic 内读取本包参考资料：本地为 `/u/{uid}/skills/create_skill/references/...`，公开为 `/skills/{load 返回的 skill_id}/references/...`。使用工具返回的 url_prefix，不自行猜测 scope。

## 4. 实施流程

1. 根据请求确定交付形态和必要能力；已明确的信息不重复询问。
2. 核对目标环境支持程度，选用当前可运行格式或明确的设计草案。
3. 技能先写 SKILL.md，再实现所选 UI/API/CLI 扩展；只声明真实依赖，不用一份页面承担整个后台生命周期。单 HTML 作为非技能交付时无需包结构。
4. 分别验证所选能力，再验证组合链路。没有 UI 就不做开窗测试，没有 API 就不添加数据库。
5. 交付入口、实际验证结果与未完成部分；发布、设备安装、权限授予是不同动作，按用户授权执行。

普通已有 CLI 可以继续通过设备 exec 使用；只有需要技能发现、固定命令绑定、配套 UI 或驻留 stream 时才规划注册包。

## 5. 当前示例与目标模板

以下现有示例采用 **v5 可运行格式**，每个示例均有 SKILL.md；当前与目标 v6 都必须保留并完善使用说明，三种扩展可按实际需要选择：

- `examples/hello`：界面与可选 AI 页面指令。
- `examples/notes`：界面+文件服务，无业务数据库。
- `examples/todo_min`：界面+API+存储，带独立 HTTP 调用示例。

复制后按当前格式修改目录名与 name，并以实际调用验证。保留它们作为 UI、UI+文件、UI+API 模板；按平台能力补齐纯描述、API-only、CLI-only、service+stream 和 UI+CLI 模板，全部保留 SKILL.md。CLI 相关模板须随平台实现后验证，不提前声称可运行。

## 6. 按能力验收

- SKILL.md（所有技能必验）：文件及 frontmatter 有效，使用说明明确、步骤可执行、引用能找到；不声称未实现的命令存在。缺少该文件不能交付为技能包。
- UI：能直接打开，资源/相对路径正确，适应窗口大小；只有声明 AI 操作时才验证 pageDesc。
- API：不开 UI 也能调用；参数绑定、身份隔离与错误语义正确；仅在需要业务数据时定义表。
- CLI：安装/注册与实际执行都验证；标准流、退出码、管道、取消和设备 rules 生效；不依赖页面存活。
- stream：提供方与数据版本匹配，慢消费有界，断线/关闭释放句柄，不自动重放输入。
- 组合：缺依赖的入口有明确状态，独立能力仍可用；包升级不混用旧 UI 与新 provider。
- 发布：只打包代码、声明和静态资产，不带用户数据、密钥或运行状态；当前发布规则见专门手册。
