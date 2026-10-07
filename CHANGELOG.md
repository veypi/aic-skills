# Changelog

版本号见 [VERSION](VERSION)，遵循 SemVer：破坏性变更进位 minor。

两个版本面：**模块版本**（本文件 / tag `vX.Y.Z`，Go 依赖面）与**技能版本**（各 `SKILL.md` frontmatter 的 `version:`，平台定版按它决定是否覆盖）。内容更新 bump 技能版本；契约或结构变化 bump 模块版本。

## 0.1.0 — 2026-10-08

首个版本：技能仓从「带 provider/SDK/CLI manifest 的可执行包」收敛为**纯静态内容仓**。

### 变更（破坏性）

- **只保留静态内容**：技能 = `SKILL.md` + 可选 `ui/`、`api/`、`tables/` + 普通资源。删除 provider 与 SDK 机制（browser/cua/hello 的 `provider/*`、`cli/manifest.json`、`build.sh`、`cmd/build` overlay 嵌入、`sdk/go`、hello-service 整包）；内嵌集不再包含任何 provider 产物。
- **browser / cua 改为官方 MCP 说明**：browser（1.0.7→1.0.10）说明设备侧官方 `agent-browser mcp --tools core,tabs`（当前发行固定 0.38.2，工具/schema/结果原样透传，Pod 默认注册）；cua（1.0.3→1.0.7）说明官方 `cua-driver mcp`（Desktop 随包 0.33.2）。实时画面走 Pod 内建 RTC 通道，技能只提供静态说明与云端 UI。
- **hello 改为普通原生 CLI 示例**（1.0.0）：`scripts/hello.go` 自行 `go build` 放入 PATH，无 manifest、无注册表、无 MCP。
- **create_skill 手册重写**（1.0.3→1.0.4）：「静态说明 + 云端 UI/API」；`templates/cli` 与 manifest 模板删除，新增 `templates/scripts/hello.sh`；references 全面对齐现行边界。
- **UI 文件 API 统一**：drawio / office_studio / ppt_studio / video_studio 的 `$fs.open`、`$fs.save_as` 统一改为 `pickFiles` / `pickSavePath`；create_skill 新增页面共享服务契约（`$auth` / `$ai` / `$hosts` / `$skills` / `$account` / `$catalog` / `$fs` / `$pageExec`）。

### 新增

- **cua 远程查看/控制 UI**：桌面与窗口截图预览（等比压入 1280×720、≤600 KiB JPEG）、点击/双击/右键/拖动/滚轮/文字与快捷键、窗口列表过滤与失效处理、`check_permissions` 诊断保留、`capture_id`/`_meta["aic.dev/image-preview"]` 坐标映射契约。
- **browser UI 与官方 MCP 能力对齐**：标签页/导航/快照工具透传、实时画面与人工输入走 Pod 内建 Browser 通道。
- **内嵌集扩充至 9 个技能**：`drawio` / `hello` / `ppt_studio` / `video_studio` 纳入 `builtin_embed.go`（补齐 frontmatter `version: 1.0.0`）；`vhtml` 补齐 nickname / keywords / icon。
- 仓库工程面：`VERSION`、本 CHANGELOG、`AGENTS.md`、CI（gofmt / vet / go test + 各技能 UI 的零依赖 `node --test`）、README 中英双语。

### 说明

- `builtin_embed.go` 的 embed 列表是**唯一的发布面**：目录存在但不在列表中即不发布。
- 无历史兼容层：不保留旧 URL、旧协议、provider 产物或设备安装状态（2026-10-05 起设备端已无技能包机制）。
