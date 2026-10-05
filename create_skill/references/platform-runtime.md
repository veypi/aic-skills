# UI、cloud、pod 的运行边界

- cloud 保存技能静态内容、发布信息和数据；业务通过 HTTP API 调用。
- UI 加载云端内容；用 `$hosts.openTools(hostId)` 获取 RTC 连接，通过 `execCall(script, {stdin})` 调设备 command。
- Pod 执行 CLI/script。MCP 只是 Pod 的一个 command，内部维护官方 browser/CUA 和显式配置的第三方服务连接；共享服务 cwd/env 来自设备配置。

AI 设置 exec.1host=设备ID 后，通过设备 vsh 调用：

```sh
mcp tools browser
mcp describe browser take_snapshot
mcp call browser take_snapshot --input '{"pageId":1}'
mcp tools cua
```

UI 调用同一个 command，例如：

```js
const connection = await $hosts.openTools(hostId);
const out = await connection.execCall('mcp call browser list_pages --input - --json', {stdin: '{}'});
// 检查 out.attrs.exit_code，然后读取 JSON.parse(out.content)。
await connection.close();
```

参数经 stdin 传 JSON，不将业务字符串拼进脚本。mcp command 的 JSON stdout 保留 content、structuredContent、isError；工具报错时退出非零。大输出遵循现有 exec 日志和截断规则，不能把截断预览当成完整 JSON。

`exec.1host` 唯一选择执行端。page 只解析单条字面命令，按名称调用 pageDesc.commands 的 handler(argv, ctx)；`commands` 和 `<cmd> --help` 提供发现。page 通道按 session 订阅，窗口命令使用既有窗口 ID。同页重复注册由后注册者覆盖；同 session 多标签使用 queue 单次投递，子会话沿用父会话通道并保留自己的调用身份。文件接口直接调用 PageFS。page/cloud/UI 都不接入 MCP 协议。

身份来自已认证连接，不能通过工具参数覆盖 user_id、owner 或审批事实。Cloud API 的 user_id/skill_id 由服务端重写。

设备服务使用 `mcp.<alias>` 命令权限，拒绝时按现有 grant 流程申请。官方 browser/CUA 以设备权限运行，该授权允许访问相应设备资源；原生 fs 规则不会隔离浏览器/桌面操作。browser 显式文件参数由上游 filesystem-root 检查。第三方服务默认使用设备沙箱。UI 与 AI 都用原生 exec 取消；Pod SDK 将上下文取消传给 MCP 服务，保留共享连接，写入不自动重放。

browser/CUA 工具名、schema 和结果原样来自上游，不实现工具别名或 ID 映射。Browser UI 提供上游页面列表、导航、快照和截图，CUA UI 显示官方权限诊断；没有实时接管或媒体协议。
