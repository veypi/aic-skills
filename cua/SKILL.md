---
name: cua
version: 1.0.3
description: 通过设备上的官方 CuaDriver MCP 操作应用、原生窗口和浏览器。
ui:
  - path: index.html
    desc: CuaDriver 系统授权诊断
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

UI 经 `$hosts.openTools(hostId)` 的 `execCall` 调用同一个 command；只渲染官方 `check_permissions` 的结果，不维护 MCP 连接或工具注册。

设备所有者可通过 `mcp.servers.cua` 完整替换默认 command/url，或设置 `disabled: true`。覆盖配置不继承内置服务的进程权限。版本随 Pod 发布固定升级，技能包不维护本地安装状态。

官方说明：https://cua.ai/docs/cua-driver
