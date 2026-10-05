# aic-skills

官方技能内容仓库。技能由 `SKILL.md`、可选 `ui/`、`api/`、`tables/` 与普通资源组成；Go embed 仅嵌入这些静态内容。

- 说明、UI 和 API 在 cloud 发布和使用。
- CLI、脚本由用户按说明下载、安装后原生执行。
- 有状态工具使用 MCP。Pod 默认直接启动官方 agent-browser MCP 与 cua-driver mcp，所有工具遵循上游；Desktop 分发固定版本依赖，独立 CLI 按说明安装。第三方服务由 `mcp.servers` 配置。
- `hello/scripts/hello.go` 演示普通 CLI，`create_skill/templates/scripts/hello.sh` 演示普通脚本。都不需要 manifest 或 provider SDK。

`go test ./...` 验证静态目录、元数据和 ZIP；`cd browser/ui && npm test` 验证页面发现与上游结果透传。
