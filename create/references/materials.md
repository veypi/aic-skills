# 可用材料（共享服务与通道）

> 面向"不了解平台实现"的 AI。目标：知道扩展时能直接用平台现成的哪些能力，不必自己造。

## 1. 页面能用的共享服务

平台壳向页面注入这些服务（可直接用，也可经 `$mod` 读同名服务）：

| 服务 | 用途 |
| --- | --- |
| `$fs` | 统一文件树：`readFile(path)`、`writeFile(path, content)`、`list(path)`、`stat(path)`、`mkdir(path)`、`remove(path)`、`move(src, dst)`；`pickFiles(options)` 弹选择器、`pickSavePath(options)` 只选路径（再自己 writeFile）、`resolve(path)` 取媒体 lease（用完 `close()`）、`transfer(src, dst)` 跨端复制 |
| `$auth` | 用户/会话身份：`$auth.users.get(id)`（同步返回响应式对象）、`$auth.user` |
| `$ai` | agent 与会话：`$ai.agents.get(id)`、`await $ai.agents.load(id, {force:true})`、`$ai.open({agentId})` |
| `$hosts` | 设备连接：`await $hosts.openTools(hostId)` 得到连接句柄，`execCall(script, {stdin})` 调设备命令，用完 `close()`；设备停用抛 `permission_denied`，离线抛 `unreachable` |
| `$os` | 窗口与打开协议：`$mod.$os.open(url)` 打开应用或 `/fs/...` 文件；不要直接用包内绝对链接跳出去 |
| `$skills` | 技能目录（查自己的/广场的技能） |
| `$account` | 账户概况（`$account.get()` / `load(options)`） |
| `$catalog` | 只读目录（`tools` / `modelSchemas` / `quotaProviders`） |
| `$pageExec` | 页面指令通道（AI 在 page exec JS 中经 `win(id).command(data)` 调用页面） |
| `$message` | 平台通知与确认：`info/success/warning/error/confirm`；技能不自造 toast |
| `<widgets-*>` | 平台公共组件（全局别名 `/widgets`，页面直接写标签，不手拼前缀）：`<widgets-host-connector>` 设备选择器、`<widgets-fs-picker>`/`<widgets-fs-browser>` 文件选择与浏览、`<widgets-viewer-md>`/`<widgets-viewer-json>`/`<widgets-viewer-preview>` 文件预览；契约见 [ui-component.md](ui-component.md) |

**路径形态**：`$fs` 用完整树路径——`/cloud/...`（云端）、`/page/...`（页面本地）、
`/{host_id}/...`（设备）。相对路径会被判非法。用户与页面指令使用 `/fs/...` 引用形态，进入 `$fs`
前去掉 `/fs` 前缀。UI 文档、项目与素材默认都走这里，不另建私有项目库；首页、存档和相对资源契约见
[ui-storage.md](ui-storage.md)。

## 2. 资源的统一读法

普通资源统一：`get(id)`（同步）、`peek(id)`、`state(id)`、`await load(id, options)`、
`query(params)`（自动首载，模板读 `items` / `loading`）。

- `get` 不返回 Promise，不需要预载整表。
- **页面要释放自己的句柄**：`$scope.addCleanup(() => handle.dispose())`。
- 查询条件相同的请求会共享，但**每个页面各自释放自己的 handle**。
- 表单草稿保持局部，**不要直接改共享实体**。

## 3. 三个通道（谁能对谁说话）

| 通道 | 方向 | 载体 | 例子 |
|---|---|---|---|
| 技能 HTTP API | Page/Host/Pod ↔ 云端 | 页面同源请求；exec/vsh 内建 curl 请求 `{url_prefix}/api/...` | `$fetch('api/todos')`、设备脚本批量 POST |
| 平台管理 HTTP | 页面 ↔ 云端 | 同源请求（cookie 身份） | page exec 中 `fetch('/api/skills')`，检查 `res.ok` |
| 页面指令 | AI ↔ 页面 | 页面声明 `pageDesc.commands`，AI 在 page exec JS 中调用 | `win(id).command(data)` |
| 设备命令 | AI/页面 ↔ 设备 | vsh 服务命令（MCP/TCP 等），复杂参数走 stdin | `browser snapshot --json` |

**身份**：来自已认证连接，**不能通过工具参数覆盖** user_id、owner 或审批事实；
云端 API 的 user_id/skill_id 由服务端重写。Page 使用 cookie；Host 使用设备连接身份，Cloud/Pod 使用
exec 会话身份。自动身份注入只承诺 `/skills/cloud/{skill_id}/api/...`，其它路径或外部 origin 不自动带凭证。

**取消**：UI 与 AI 都用原生 exec 取消；设备侧按 Provider 能力传递取消，写入不自动重放。

## 4. 页面指令的发现与投递

- 页面在 `<script setup>` 里声明 `pageDesc`（`desc` + `commands[]`）。
- AI 用 `return await commands()` 发现业务函数，用 `await win(id).command(data)` 调用；handler 签名为 `(data, ctx)`，直接返回对象、数组或字符串。
- 同页重复注册由后注册者覆盖；同 session 多标签用 queue 单次投递；子会话沿用父会话通道。
- 页面/云端/UI **都不接入 MCP 协议**——MCP 只在设备侧。

## 5. 文件与导出（页面常用）

```js
// 文本读取统一处理 string | Blob；不要在非字符串时回退成空串
readText = async (path) => {
  const r = await $mod.$fs.readFile(path)
  if (typeof r.content === 'string') return r.content
  if (r.content && typeof r.content.text === 'function') return await r.content.text()
  throw new Error('unsupported text content: ' + path)
}

// 打开文件（平台选择器）
const pick = await $mod.$fs.pickFiles({ accept: ['.md', '.txt'], multiple: false, start: dir })
if (pick) { text = await readText(pick.path) }

// 另存为（只返回目标路径，自行写入）
const target = await $mod.$fs.pickSavePath({ name: current || 'a.md', ext: 'md', start: dir })
if (target) await $mod.$fs.writeFile(target.path, text)

// 导出为浏览器下载
saveBlob = (name, blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
```

图片/媒体：`const lease = await $mod.$fs.resolve(path)`，使用 `lease.url`，用完 `lease.close()`。

## 6. 安全边界

- 设备服务命令使用别名本身的命令权限（`grant cmd <alias>`），拒绝时按现有 grant 流程申请。
- 官方 browser/CUA 以设备权限运行；**原生 fs 规则不隔离浏览器/桌面操作**。
- 第三方服务默认运行在设备沙箱内；`no_sandbox` 只能由设备所有者在配置中显式设置，技能或工具参数不能借此提权。
- 页面/云端都不接入 MCP 协议；MCP 仅在 Pod 内部。设备脚本批量调技能 API 走 HTTP，不需要为此增加 MCP。

## 7. 调试

- 技能 API 三端连通：同一身份在 Host/Pod 用内建 curl 读；有写接口时再做批量写入与读回。
- 页面挂载失败 → 红色 `[vhtml] ... failed` 占位（不是白屏）。
- 错误登记：`window.__vhtml_dev.errors`（含代码预览）。
- 刷新窗口：AI 侧 `reload [win_id]`；详细日志：`localStorage.debug = 1`。
