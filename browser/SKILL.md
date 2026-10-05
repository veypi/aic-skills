---
name: browser
version: 1.0.7
description: 使用设备上的官方 agent-browser MCP 操作浏览器，UI 提供同一浏览器的实时画面和人工交互。
ui:
  - path: index.html
    desc: 设备窗口列表、导航与实时键鼠交互
    handles: [http, https]
---

# Browser

Pod 的 `browser` 别名直接启动官方 `agent-browser mcp --tools core,tabs`，当前发行固定 0.38.2。工具名称、参数、描述、schema 和完整结果均来自上游，以 `mcp tools/describe` 为准。技能仅包含静态说明与云端 UI。

## 运行依赖

Desktop 附带 agent-browser 原生二进制和 Chrome for Testing；首次调用由 Pod 的 MCP manager 启动服务，AI 与 UI 共享上游 daemon 和浏览器。无需 Browser 专用 Node 运行时。

独立 CLI 按 [agent-browser 安装说明](https://github.com/vercel-labs/agent-browser#installation) 安装 0.38.2 和 Chrome。可用 `AIC_AGENT_BROWSER_PATH`、`AIC_BROWSER_PATH` 指定程序位置。运行目录固定为 `$HOME/.aic/browser/runtime`，浏览器资料位于 `$HOME/.aic/browser/profile`，不跟随单次 shell 的 cwd/env 改变。

默认以设备权限启动；MCP 调用和实时流都经过 `mcp.browser` 命令权限门。浏览器可访问的设备资源由上游及操作系统管理。

设备所有者可在 `~/.aic/config.yaml` 的 `mcp.servers.browser` 设置 `disabled: true`，或用完整 command/url 配置替换默认项。替换项不继承默认启动参数和权限；内建实时 UI 仅连接默认 agent-browser 实例。

## 使用

在目标设备的 exec 中：

```sh
mcp tools browser
mcp describe browser agent_browser_open
mcp call browser agent_browser_open --input '{"url":"https://example.com"}' --json
mcp call browser agent_browser_tab_list --json
mcp call browser agent_browser_snapshot --json
mcp describe browser agent_browser_click
```

切换标签页使用上游返回的 `tabId`，例如：

```sh
mcp call browser agent_browser_tab_switch --input '{"tab":"t1"}' --json
mcp call browser agent_browser_click --input '{"selector":"@e1"}' --json
```

元素引用取自最新快照；先查看实际 schema 再填参数。工具作用于上游当前活动标签页，人工与 AI 共享该选择。上游提供什么工具，命令就透传什么工具，不另外注册别名或平台 fs/exec 工具。

外层 `exec.1host` 选择设备，mcp 命令只选择服务。`--input -` 从 stdin 读取 JSON；`--json` 返回完整 MCP 结果，包含 `content`、`structuredContent`、`isError` 等字段。大截图可用上游 `agent_browser_screenshot.path` 保存，再通过原生 fs 读取。

## UI 和实时交互

UI 通过 `$hosts.openTools(hostId)` 的 RTC 连接执行 `execCall("mcp call browser <tool> --input - --json", {stdin: JSON.stringify(args)})`，调用上游标签页、导航和弹窗工具。界面沿用单行导航栏、按设备分组的可折叠窗口列表、窗口旁的新建/关闭、空白页入口和居中的实时画面；快照和截图仍可由 AI 使用上游 MCP 调用。

上游不允许直接关闭最后一个标签页。UI 关闭最后一页时，先调用 `agent_browser_tab_new` 创建空白页，再用 `agent_browser_tab_close` 关闭原页；其余标签页正常关闭。AI 直接调用 MCP 时仍遵循上游限制。

实时画面和人工输入走同一 RTC 连接上的内建 Browser 通道。Pod 只把 agent-browser 原生 WebSocket 消息双向转发，UI 绘制完帧再回传上游 ACK；不新增 CDP 连接、MCP 工具或页面身份。标签页标识直接使用上游 `tabId`。

画面跟随上游当前活动标签页。关闭 UI 释放观看连接，AI 仍可操作；关闭 Pod 时用上游 CLI 关闭其专用运行目录中的 daemon。重新进入 UI 或点击刷新可重连。人工和 AI 同时输入遵循上游行为，没有额外接管锁。实时画面是 JPEG 帧流，当前限制 15 fps，不包含音频；支持鼠标、滚轮、键盘、中文输入和向远端粘贴文本。远端剪贴板读取及本地文件拖放不在此 UI 中提供。
