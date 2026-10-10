# Changelog

版本号见 [VERSION](VERSION)，遵循 SemVer：破坏性变更进位 minor。

两个版本面：**模块版本**（本文件 / tag `vX.Y.Z`，Go 依赖面）与**技能版本**（各 `SKILL.md` frontmatter 的 `version:`，平台定版按它决定是否覆盖）。内容更新 bump 技能版本；契约或结构变化 bump 模块版本。

## 0.1.1 — 2026-10-10

内容刷新与契约对齐（无结构变更）：同步 vhtml 指南、修正 create_skill 建技能链路与模板、UI 响应式（`@media`→`@container`）与**配色全部归到平台设计 token**；页面入口改为与包服务同段（对齐平台破坏性路由变更 `/skills/cloud/{id}`）。

### 技能版本

- `vhtml`（0.1.1→0.2.0）：指南整体同步到框架 v0.12.0（`ui/docs/SKILL.md`）——补「Module isolation（QuickJS 隔离）」章、删除已移除的 `restrictedFetch`、更正 unsafe 语义/双向绑定（只接受静态属性路径）/路由前缀兜底（路由表空间）/`manager.addAlias`/`scopeOf` 等描述。
- `create_skill`（1.0.4→1.0.6）：①建技能改为可复制的两步（`exec 1host=page` + `curl` 建行 → `grant fs /skills/{id}` 后写 `/skills/{id}/...`）；模板 `templates/ui/index.html` 去掉 `v-model`/硬编码兜底色/字体栈，补 `height:100%` + `container-type`；`examples/*` 的「当前 v5 格式」改 v6.1；页面手册 §4 去掉多余的 `list` 步骤并注明 page 通道。②页面入口写法改为 `/skills/cloud/{skill_id}`（与 `url_prefix` 同段），并明确 fs 工具路径仍是 `/skills/{id}/...`。
- `browser`（1.0.10→1.0.11）：UI 阴影字面色改 `var(--shadow-lg)`。
- `cua`（1.0.7→1.0.9）：①UI 布局断点 `@media`→`@container`（窗口≠视口），去掉 body 上的页面底色/文字色；②阴影/主色按钮字色改 `var(--shadow-sm/-lg)` / `var(--color-primary-text)`。
- `ppt_studio`（1.0.0→1.0.2）：`@media`→`@container`；旧名 `page_exec` 改 `$pageExec`；打开页面写法改 `/skills/cloud/{skill_id}`。
- `video_studio`（1.0.0→1.0.2）：①删除动作从错误的 `fs.rm` 改为页面端 `exec 1host=page rm`；打开页面写法改 `/skills/cloud/{skill_id}`。②**UI 配色全部改为平台设计 token**（index/assets/inspector/scenes/stage/timeline 六个文件的 `<style>`）：硬编码深色调色板（`#0a0e16`/`#4361ee`/`#e2e8f0`/`rgba(255,255,255,·)` 等）换成 `--bg-color(-secondary/-tertiary)` / `--text-color(-secondary/-tertiary/-disabled)` / `--border-color` 风格的 `color-mix(in srgb, var(--token) N%, transparent)` / `--color-primary(-hover/-text)` / `--color-info|success|warning|danger`；去掉 body 上的页面底色。视频文档自身的颜色（`engine.js` 文档主题默认、图表调色、字幕默认、场景背景 fallback）属内容，保持不变。
- `drawio`（1.0.0→1.0.2）：①打开页面写法改 `/skills/cloud/{skill_id}`；②**编辑器 chrome 配色 token 化**（硬编码浅色 `#24292f`/`#e1e4e8`/`#fff`/`#2f6fdb` 等 → `--text-color(-secondary/-tertiary)` / `--border-color(-hover)` / `--bg-color-secondary/-tertiary` / `--color-primary` / `--color-danger` 与 `color-mix` 淡色；内联 SVG 预览图标改 `var(--text-color-secondary)`；toast/tooltip 保持反色对）。图形形状与面板里的 `fillColor/strokeColor/fontColor` 默认值属 .drawio 格式内容，保持不变。

### 仓库

- 删除误留在 `browser/` 的 `browser.zip`（会被 `//go:embed` 一并嵌入、并被 `Zip()` 打包）；`builtin_test.go` 新增「包内不得含 `*.zip`/`*.sqlite`」断言。

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
