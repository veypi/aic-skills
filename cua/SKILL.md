---
name: cua
version: 1.1.10
description: 通过设备上的官方 CuaDriver MCP 操作应用、原生窗口和浏览器。
---

# CUA

Pod 经统一 commands 机制拉起本包自带启动器（`src/`，Go）：启动器负责定位官方
`cua-driver` 并以 `mcp` 运行（stdio 直通）。工具名、描述、参数、结果全部来自上游；
pod 对 cua 没有任何专属代码与配置——本包与普通第三方包同一 manifest 契约，只是作为官方包随发行预装。

## 安装与构建

Desktop 与 CLI 发行包**预装本包并附带预编译的 `bin/cua`**：pod 启动时自动定版到
`~/.aic/packages/cua`，无需 `commands install` 与 Go 工具链；包随 pod 版本整体更新，
不可 `commands install/update/uninstall`。

源码运行 pod（没有随包二进制的环境）才需要手动构建：

```sh
# 平台 exec 先允许写设备包目录（本机 owner 终端按本机权限执行）
grant fs <设备用户 home 的绝对路径>/.aic/packages/cua

cd ~/.aic/packages/cua/src
cp go.mod.example go.mod
go mod tidy
mkdir -p ../bin
go build -o ../bin/cua .
```

## 免沙箱

服务默认在 pod 沙箱里运行，而桌面自动化需要设备级权限（辅助功能/屏幕录制
身份、CuaDriver 自己的状态目录），需要设备 owner 授予免沙箱：

```sh
# 提权项：平台会话需人工批准（未批准会被明确拒绝），本机 owner 直接执行不需要
commands config cua --no-sandbox
```

Desktop 随包提供 CuaDriver 0.33.2 运行资源；预装定版后即注册 `cua`，第一次调用时启动。CLI 可安装官方 CuaDriver，或通过 `AIC_CUA_DRIVER_PATH` 指定可执行文件。macOS 按上游安装布局把官方 CuaDriver.app 安装到 `/Applications/CuaDriver.app`（可复制 Desktop 的 resources/cua/darwin/CuaDriver.app）；仅把 app 放在资源目录不会完成系统安装。官方 MCP 会按应用名启动 daemon，客户端与安装的驱动版本应一致。升级后先用 `cua-driver stop` 停止旧 daemon。macOS 使用 CuaDriver.app 的辅助功能和屏幕录制授权身份；使用 `cua-driver permissions grant` 引导授权，`cua-driver doctor` 诊断。

调用设备在 exec 外层通过 `_host` 选择。命令别名 `cua` 的授权（`grant cmd cua`）允许使用该设备服务；工具内部的权限与路径限制由 CuaDriver 执行。原生 fs 的路径规则不等同于对桌面自动化的隔离。

```sh
cua                              # 工具目录
cua check_permissions --json
cua list_apps --json
cua list_windows --input '{"pid":123}' --json
cua get_window_state --pid 123 --window_id 456 --session work --json
cua get_window_state --help      # 按 inputSchema 渲染参数表
```

标量参数自动映射为同名 flag（如 `--pid 123`）；复杂对象走 `--input JSON`。工具目录用 `cua`（无参），原始 schema 用 `commands info cua --schema`。

`pid`、`window_id` 使用上游枚举结果。动作使用最新观察返回的 `element_token`；同一工作过程沿用同一 `session`。引用失效后重新观察，不能重放可能已执行的动作。参数以当前 `cua <tool> --help` 渲染的官方 schema 为准，不传入自定义 `locator`、`ref` 或 `view_id`。

`--input -` 从 stdin 读取 JSON。命令输出标准 MCP 结果，包含上游 `content`、可选 `structuredContent` 和 `isError`。图片保留为 MCP image 内容，不转换为自定义观察对象。

UI `/skills/cloud/cua` 经 `$hosts.openTools(hostId)` 的 `execCall` 调用同一命令面（`cua <tool> --json`），支持选择设备、主显示器桌面或应用窗口。截图调用添加 `--image-preview 1280x720`，Pod 在输出前等比缩入 1280×720，转为不超过 600 KiB 的 JPEG，小图不放大；普通 MCP 调用默认保留原图。工具调用使用正式 `cua <tool>`；仅 schema/能力探测使用 `commands info cua --schema`。空闲时每次完成后间隔 1 秒刷新，窗口截图关闭辅助功能树遍历；这不是连续视频流。查看端使用独立随机 `session`，不会覆盖 AI 工作会话中的观察引用。

窗口列表只保留可见、非最小化且有有效尺寸的候选，不逐个截图探测。若选中后发现窗口已最小化或没有渲染内容，移出列表、清空画面并暂停刷新；恢复窗口后可刷新列表或重试，不自动激活或恢复窗口。桌面截图参数读取当前设备 `cua get_desktop_state --help` 的实际 schema，只有明确支持时才传 `max_image_dimension`，每次重连重新读取。

默认只读，切到控制后支持点击、双击、右键、拖动、滚轮、文字及快捷键。窗口默认后台输入，应用不支持时可手动选择前台输入（激活窗口）；macOS 窗口拖动需要前台模式。Pod 保留上游 structuredContent 与 capture_id，图片 `_meta["aic.dev/image-preview"]` 记录 `source_width/source_height/width/height`；预览坐标先映射回上游截图像素，不重复换算 DPI。文字与按键按序发送，操作与预览失败均不自动重放；切换目标、隐藏或离开页面时停止输入与截图刷新，退出时结束查看会话。权限诊断读取当前设备 `check_permissions` 的实际 schema，仅向声明了 `prompt` 的驱动传 `{prompt:false}`（Windows 等无此参数的驱动不传），页面不自动触发系统授权。

截图经 RTC 工具响应分块传输，总上限保持 16 MiB；预览能力需同步更新 AIC 前端及 Pod，技能升级通过 AIC 后端内置包发布。UI 不维护 MCP 连接或工具注册，不提供音频、任意显示器选择或浏览器以外的连续视频推流。

设备所有者可用 `commands config cua` 调整运行配置（环境变量、`--no-sandbox` 等）。技能包不维护本地安装状态。

官方说明：https://cua.ai/docs/cua-driver
