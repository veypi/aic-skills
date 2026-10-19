# Changelog

版本号见 [VERSION](VERSION)，遵循 SemVer：破坏性变更进位 minor。

两个版本面：**模块版本**（本文件 / tag `vX.Y.Z`，Go 依赖面）与**技能版本**（各 `SKILL.md` frontmatter 的 `version:`，平台定版按它决定是否覆盖）。内容更新 bump 技能版本；契约或结构变化 bump 模块版本。

## 0.2.1 — 2026-10-19

仅技能内容更新（模块契约不变）：blender 0.2.0→0.3.0（`render` 工具、`execute_code --file/--entry`、`get_viewport_screenshot out` 落盘、手册重构）。发此版是为 aic-pod v0.9.2 内嵌集取到新内容（pod 经 Go module 嵌入技能包，未发版则 CI 只能拿到旧内容）。

### 技能版本

- `blender`（0.2.0→0.2.1）：①`get_viewport_screenshot` 增可选 `out` 落盘参数——给了就只回 `{path, mime, bytes, max_size, ms}`（不再回 base64），调用方（agent）随后用 fs read 读该 PNG，host 端图片 read 走 `image_data` 进视觉通道（原 base64 形态只有程序调用方用得上，agent 看不见画面）；addon `ADDON_VERSION` 同步 0.2.1。②手册修正示例参数名（`--max_size`，命令面按 schema 原名映射，原 `--max-size` 示例实际被拒）并补「看图」一节 + `cli/selftest.py` 断言 `out` 在 schema 里。

- `blender`（0.2.1→0.3.0）：
  ①**新工具 `render`**：渲一帧 PNG 落盘（只回 `{path,bytes,res,samples,engine,clip,camera,ms}`，不回图，调用方 fs read 就看）；
  支持临时 `camera{location,target,lens}` / `engine` / `res` / `samples` / `clip{start,end}`，渲完**一律还原**用户设置；
  相机裁剪默认按场景尺度**自适应、只扩不缩**（小模型保持默认 100m，km 级大场景自动盖住）。真机验证：临时机位渲染/显式 clip 裁切/渲完还原全通过。
  ②`execute_code` 增 `file`/`entry` 参数（读设备脚本执行；`entry` 指定载入后调用哪个入口函数，不传则只载入）——长脚本落盘后“改哪段跑哪段”，彻底避开 shell 引号；回执增 `source`/`entry`。
  ③`ping` 补 `engine/resolution/camera`（判断渲染环境）。
  ④手册重构：「脚本工作流」「看图：视口截图 vs 渲染」「坑（实测）」三节 + busy 措辞订正（busy 的调用已被丢弃、不会补执行）+ 无头选择表；
  坑条目全部在 5.2.1 真机核过（相机 clip 实测 0.1/100m、ColorRamp 按 position 排序、按 type 取 world 节点等）。

## 0.2.0 — 2026-10-16

**契约变更（结构级）**：技能包新增 `cli/` 执行端维度——`cli/manifest.json` 声明设备服务（协议 kind/别名/程序解析/stream 通道），源码随包入库；aic-pod 对内嵌集的 cli 清单注册 vsh 服务（vtools），二进制与构建产物仍不入库（契约测试收窄为拒 `provider/`、`cli/bin/` 与二进制扩展名）。

### 技能版本

- `blender`（新增 0.1.0）：设备上的 GUI Blender 直连服务——`blender` vsh 命令（doctor/launch/install 生命周期动词 + ping/get_scene_info/get_object_info/execute_code/get_viewport_screenshot 五工具）；addon `cli/aic_blender_bridge.py` 说 vtools/tcp v1（纯 stdlib，主线程 timer 泵），`cli/selftest.py` 免 Blender 自测。
- `browser`（1.0.11→1.1.0）：新增 `cli/manifest.json`（pod 内置默认项数据化，含 `aic-browser` stream 通道声明）；手册用法改直调（`browser <tool> --json`、标量参数自动成 flag）。
- `cua`（1.0.9→1.1.0）：同上（无 stream）。

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
