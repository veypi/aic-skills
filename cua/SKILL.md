---
name: cua
version: 1.0.7
description: 通过设备上的官方 CuaDriver MCP 操作应用、原生窗口和浏览器。
ui:
  - path: index.html
    desc: 远程查看和控制设备桌面、应用窗口
---

# CUA

Pod 直接连接官方 `cua-driver mcp`。工具名、描述、参数、结果全部来自上游；技能只提供静态说明与云端 UI。

Desktop 随包提供 CuaDriver 0.33.2，默认注册为 `cua`，第一次调用时启动。CLI 可安装官方 CuaDriver，或通过 `AIC_CUA_DRIVER_PATH` 指定可执行文件。macOS 按上游安装布局把官方 CuaDriver.app 安装到 `/Applications/CuaDriver.app`（可复制 Desktop 的 resources/cua/darwin/CuaDriver.app）；仅把 app 放在资源目录不会完成系统安装。官方 MCP 会按应用名启动 daemon，客户端与安装的驱动版本应一致。升级后先用 `cua-driver stop` 停止旧 daemon。macOS 使用 CuaDriver.app 的辅助功能和屏幕录制授权身份；使用 `cua-driver permissions grant` 引导授权，`cua-driver doctor` 诊断。

调用设备在 exec 外层通过 `1host` 选择。`mcp.cua` 命令授权允许使用该设备服务；工具内部的权限与路径限制由 CuaDriver 执行。原生 fs 的路径规则不等同于对桌面自动化的隔离。

```sh
mcp tools cua
mcp describe cua get_window_state
mcp call cua check_permissions --json
mcp call cua list_apps --json
mcp describe cua list_windows
mcp call cua list_windows --input '{"pid":123}' --json
mcp call cua get_window_state --input '{"pid":123,"window_id":456,"session":"work"}' --json
```

`pid`、`window_id` 使用上游枚举结果。动作使用最新观察返回的 `element_token`；同一工作过程沿用同一 `session`。引用失效后重新观察，不能重放可能已执行的动作。参数以当前 `mcp describe cua <tool>` 返回的官方 schema 为准，不传入自定义 `locator`、`ref` 或 `view_id`。

`--input -` 从 stdin 读取 JSON。命令输出标准 MCP 结果，包含上游 `content`、可选 `structuredContent` 和 `isError`。图片保留为 MCP image 内容，不转换为自定义观察对象。

UI `/skills/cua` 经 `$hosts.openTools(hostId)` 的 `execCall` 调用同一个 command，支持选择设备、主显示器桌面或应用窗口。截图调用添加 `--image-preview 1280x720`，Pod 在输出前等比缩入 1280×720，转为不超过 600 KiB 的 JPEG，小图不放大；普通 MCP 调用默认保留原图。空闲时每次完成后间隔 1 秒刷新，窗口截图关闭辅助功能树遍历；这不是连续视频流。查看端使用独立随机 `session`，不会覆盖 AI 工作会话中的观察引用。

窗口列表只保留可见、非最小化且有有效尺寸的候选，不逐个截图探测。若选中后发现窗口已最小化或没有渲染内容，移出列表、清空画面并暂停刷新；恢复窗口后可刷新列表或重试，不自动激活或恢复窗口。桌面截图参数读取当前设备 `mcp describe cua get_desktop_state` 的实际 schema，只有明确支持时才传 `max_image_dimension`，每次重连重新读取。

默认只读，切到控制后支持点击、双击、右键、拖动、滚轮、文字及快捷键。窗口默认后台输入，应用不支持时可手动选择前台输入（激活窗口）；macOS 窗口拖动需要前台模式。Pod 保留上游 structuredContent 与 capture_id，图片 `_meta["aic.dev/image-preview"]` 记录 `source_width/source_height/width/height`；预览坐标先映射回上游截图像素，不重复换算 DPI。文字与按键按序发送，操作与预览失败均不自动重放；切换目标、隐藏或离开页面时停止输入与截图刷新，退出时结束查看会话。保留 `check_permissions({prompt:false})` 诊断，页面不自动触发系统授权。

截图经 RTC 工具响应分块传输，总上限保持 16 MiB；预览能力需同步更新 AIC 前端及 Pod，技能升级通过 AIC 后端内置包发布。UI 不维护 MCP 连接或工具注册，不提供音频、任意显示器选择或浏览器以外的连续视频推流。

设备所有者可通过 `mcp.servers.cua` 完整替换默认 command/url，或设置 `disabled: true`。覆盖配置不继承内置服务的进程权限。版本随 Pod 发布固定升级，技能包不维护本地安装状态。

官方说明：https://cua.ai/docs/cua-driver
