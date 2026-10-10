# 技能内容格式

技能是云端内容单元，SKILL.md 必需；UI/API 和普通资源可选。

```text
example/
  SKILL.md
  ui/index.html
  api/get.list.sqlx
  tables/items.json
  references/usage.md
  scripts/example.sh
```

SKILL.md 的 YAML frontmatter 可包含 name、version、nickname、description、keywords、icon、ui。name 必须与注册表行一致；version 使用发布规则允许的语义版本。ui 条目使用 path、desc、handles，例如：

```yaml
name: example
version: 1.0.0
description: 示例用途
ui:
  - path: index.html
    desc: 示例页面
    handles: [https]
```

能力摘要只反映已存在的 UI 和 API；scripts、二进制、MCP 配置示例都是普通资料，不产生运行能力或命令名。没有 cli manifest、provider、服务状态或 artifacts 安装约定。

私有行由 owner 编辑，公开内容通过发布和审核形成。读取 `skill search/load` 返回的 `skill_id` 与 `url_prefix`：页面入口与 HTTP 包服务同段（`url_prefix` = `/skills/cloud/{skill_id}`）——裸入口打开包首页，子页 `/skills/cloud/{skill_id}/{page}`，没有 UI 时回退 `/skills_detail/cloud/{skill_id}`；API、manifest、静态资源用同一前缀下的子路径。包目录的 fs 工具路径是 `/skills/{skill_id}/...`（与 URL 不同段）。设备不提供技能内容路由。

创建工作区（两步）：`exec 1host=page` → `curl /api/skills -X POST -H 'Content-Type: application/json' -d '{"name":"example"}'` 建行（同源 + cookie 身份自动携带；cloud vsh 无平台 API 入口），再 `grant fs /skills/{id}` 后写 `/skills/{id}/...`（fs 工具路径，私有包默认只读）。独立 HTML 可放用户云空间 `/u/{uid}/name.html`，或页面本地 OPFS（`1host=page`，如 `/name.html`）。页面关闭后的能力需要云端 API 或设备 MCP，不能靠页面任务常驻。

本地工作：`skill download <ref> --output <path.zip>` 只保存 ZIP，拒绝覆盖，不解压、不执行、不注册；解压和安装按说明执行。`skill fork <ref>` 只创建云端私有内容副本。

普通 CLI 使用系统自己的包管理器或构建命令安装，脚本调用对应解释器。有状态工具使用标准 MCP stdio 或 Streamable HTTP；browser/CUA 随 Pod 内置，第三方服务按设备 `mcp.servers` 配置接入。详细例子见 browser/CUA 技能。
