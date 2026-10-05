---
name: create_skill
version: 1.0.4
nickname: 创建 Skill 指南
description: 创建静态说明、云端 UI/API 技能；按实际需要附带脚本、原生 CLI 或独立 MCP 软件的安装说明。
keywords: [skill, 创建, 技能, ui, api, mcp, 脚本, 模板, 发布]
icon: fa-solid fa-wand-magic-sparkles
---

# 创建技能

每个技能必须有 SKILL.md，清楚说明适用场景、步骤和依赖。技能的核心是静态文本，可按需增加云端 UI 和 API；没有需求不添加页面、数据库或服务。

普通程序安装后通过 exec 原生调用。只有确实需要保留连接、窗口、快照或其他状态的软件才使用独立 MCP 服务；pod 按设备配置维护服务，技能不管理其安装或运行状态。

## 实施流程

1. 确定最小交付：纯文本、UI、API，或这些内容的组合。只需要独立 HTML 时不必建技能。
2. 创建私有行：`POST /api/skills {"name":"example"}`，按返回 id 写入 `/fs/cloud/skills/{id}/SKILL.md` 及必要文件。使用返回的 `skill_id` 打开 `/skills/{skill_id}`；HTTP API 和资源使用返回的 `url_prefix`。
3. 阅读 [包格式](references/current-format.md)，按需加载 [页面手册](references/page-ui-manual.md)、[数据手册](references/data-manual.md)、[运行边界](references/platform-runtime.md)。
4. 从 `templates/ui`、`templates/api`、`templates/tables` 复制需要的模板。普通脚本示例在 `templates/scripts`；执行前说明解释器和依赖。
5. UI 通过 HTTP API 调云端业务；设备 UI 用 `$hosts.openTools(hostId)` 的 `execCall(script, {stdin})` 调 Pod command。参数经 stdin 传 JSON，读取命令 stdout；不在 UI 接入 MCP 协议。
6. 本地依赖写明独立安装步骤、固定路径和 MCP 配置；不创建 provider manifest、不扫描技能目录、不把下载当安装。
7. 验证实际入口和权限，再按 [发布说明](references/publishing.md) 发布内容。发布、下载、软件安装、权限授予是不同动作。

页面可通过 pageDesc.commands 提供普通 command handler。页面能力按 session 注册，窗口命令沿用 `{窗口ID}.{命令名}`。同页重复注册由后注册者覆盖，跨标签通过 session queue 单次投递；子会话沿用父会话通道。AI 设置 exec.1host=page，脚本使用 `commands`、`<name> --help` 或 `<name> <args...>`，直接调用 handler。文件能力保留原生 fs 入口。MCP 仅在 Pod 内部。

参考示例：`examples/hello`（页面）、`examples/notes`（文件）、`examples/todo_min`（UI/API/表）。browser/CUA 技能演示云端 UI 与 Pod 内置 MCP 服务的组合。

验收：文本可执行且引用完整；UI 资源可加载；API 正确隔离用户；脚本/CLI 能原生运行；MCP 工具 schema、取消和关闭有效；内容 ZIP 不包含用户数据、密钥或运行状态。只验证实际选择的能力。
