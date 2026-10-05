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

## 页面共享服务

平台壳向技能页面注入 `$auth/$ai/$hosts/$skills/$account/$catalog/$fs/$pageExec`；经 `$mod` 读取同名服务也可。技能自己的 `$fetch` 用于包内 API，公共元数据通过资源服务读取。

```js
// 同步返回同一个响应式对象，首次读取才异步拉取，DOM 自动补齐。
owner = $auth.users.get(ownerId)
agent = $ai.agents.get(agentId)
// 必须等待结果的操作使用 load；peek 只检查现有缓存。
await $ai.agents.load(agentId, { force: true })

skills = $skills.query({ scope: 'mine' })
// query 自动首载，模板绑定 skills.items / skills.loading。
$scope.addCleanup(() => skills.dispose())
```

普通资源统一 `get(id)/peek(id)/state(id)/load(id, options)/query(params)`，支持写入的资源提供 `create(input)/update(id, patch)/remove(id)`；嵌套资源使用 `{agentId, sessionId}` 等引用对象。`get` 不返回 Promise，不需要全量预载用户。查询条件相同会共享请求，但页面须分别释放自己的 handle。表单草稿保持局部，不直接修改共享实体。

`$account.get()/load(options)` 读取当前账户概况；`$catalog.tools/modelSchemas/quotaProviders` 是低频只读目录。聊天通过 `$ai.open({agentId})` 创建独立客户端。设备操作通过 `openFiles/openTools` 获取句柄并在不用时关闭。

`$fs` 使用完整树路径：`readFile(path)`、`writeFile(path, content, options)`、`list(path, options)`、`stat(path)`、`mkdir(path, options)`、`remove(path, options)`、`move(source, target, options)`；读取文件不兼作列目录。`pickFiles(options)` 返回选择结果，`pickSavePath(options)` 只选择保存路径，调用方随后执行 writeFile。媒体 `resolve(path)` 返回需在不用时 close 的 lease。详情见平台 `docs/agentos.md`。

JS 控制参数使用 camelCase，后端 DTO 及工具协议字段保留 snake_case。旧 `$auth.User`、`$fs.get/put/ls/rm/mv/open/save_as`、`$page_exec` 不再提供兼容别名，新页面使用上述入口。
