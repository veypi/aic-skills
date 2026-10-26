# 设备侧命令（host CLI）

> 面向"不了解平台实现"的 AI。目标：让设备多一条命令，或让包里声明一个常驻服务。

## 1. 先选形态

| 形态 | 什么时候用 | 谁负责安装/运行 |
| --- | --- | --- |
| **普通脚本** | 一次性执行、无状态 | 用户自己跑（包内 `scripts/` 只是附件，平台不安装不扫描） |
| **原生 CLI** | 用户能自己装的独立程序 | 用户按正文安装；正文写清安装方式、依赖、固定路径、调用示例 |
| **包内常驻服务** | 需要保持连接、窗口、快照等状态 | 包内 `cli/manifest.json` + 真实服务程序；官方内嵌包由设备启动时注册 |
| **独立 MCP / vtools-tcp 服务** | 第三方现成服务 | 用户安装并用 `mcp add` 或设备配置注册；技能写清安装与配置步骤 |

判据：**需要跨调用保持状态 → 服务；否则脚本/CLI。** 一次性 stdin JSON CLI 不是 MCP 服务。

**重要现状**：包内 `cli/manifest.json` 的自动注册只对官方内嵌包生效。用户自己发布/安装的包，
设备端目前没有自动安装与注册链路；普通作者用 `mcp add` 或设备配置完成注册，不要写"放个 manifest 就有了"。

## 2. 普通脚本与原生 CLI

正文写清四件事：

```text
安装：<包管理器命令 / 压缩包解压 / 预置路径>
依赖：<解释器版本、系统库、网络可达性>
固定路径：<绝对路径或 PATH 约定>
调用：<命令行示例，含参数与 stdin/stdout 约定>
```

包里可附 `scripts/hello.sh` 之类的附件，但平台不自动执行它们。最小原生 CLI 示例见根技能 `hello`。

## 3. 常驻服务：包内声明

`cli/manifest.json`（与 `templates/device` / `examples/device_tool` 的真实 MCP SDK 程序配套）：

```json
{
  "alias": "mytool",
  "service": {
    "kind": "mcp-stdio",
    "args": [],
    "cwd": "{workdir}",
    "no_sandbox": true,
    "idle_timeout": "30m",
    "env": { "MYTOOL_HOME": "{home}/.mytool" }
  },
  "programs": [
    {
      "sets": "command",
      "default_command": "mytool",
      "path_env": "AIC_MYTOOL_PATH",
      "bundle_env": "AIC_MYTOOL_BUNDLE_DIR",
      "bundle_dir": "mytool",
      "binary": { "windows": "mytool.exe", "other": "mytool" }
    }
  ]
}
```

字段：

| 字段 | 含义 |
| --- | --- |
| `alias` | 服务别名（省略则用包名）；注册后的 vsh 根命令名 |
| `service.kind` | `mcp-stdio`（Pod 拉起 MCP 服务）或 `tcp`（连接 vtools/tcp 端点） |
| `service.url` | `kind: tcp` 时的 `tcp://host:port` |
| `service.args` | 启动参数；由实际服务程序决定，不要照抄无关示例 |
| `service.cwd` | 工作目录（占位符 `{workdir}`） |
| `service.env` | 环境变量（占位符 `{home}`、`{workdir}`、`{env:NAME}`） |
| `service.idle_timeout` | 空闲回收时限（如 `30m`） |
| `service.no_sandbox` | 内建服务是否脱离设备沙箱运行（谨慎开启）；第三方服务只能由设备所有者在配置中设置 |
| `programs` | 程序解析规则：从哪个环境变量/目录找可执行文件，以及各平台文件名 |

**源码入库，产物不入库**：`cli/` 只放源码、模块声明与测试，**不放** `cli/bin/`、二进制、压缩包、构建输出。
MCP stdio 服务必须真正实现 initialize、tools/list、tools/call；示例使用官方 Go SDK，不用 `io.ReadAll` 等 EOF 冒充协议。
本仓由根 go.mod 提供测试依赖，示例用 `go.mod.example` 供独立复制后生成模块文件；**不要在技能目录里放嵌套 go.mod**，否则 go:embed 会跳过整段示例。

## 4. 第三方服务注册

技能不代管第三方软件的安装与运行状态。正文写清安装、版本、设备注册与授权：

```sh
mcp add mytool /absolute/path/to/mytool
# 已有 MCP HTTP / vtools-tcp 端点也可用 mcp add --url / --tcp；按当前 mcp --help 为准
```

`mcp add/remove` 改能力配置，调用门是 `mcp`；服务调用门是 `mcp.<alias>`。是否需 `grant cmd` 取决于设备策略。
内置 browser/CUA 以设备权限运行；第三方服务默认受沙箱约束，`no_sandbox` 不能由技能或工具参数提权。

## 5. AI 与页面怎么调用

正式调用面是 **`<alias> <tool>` 服务根命令**：

```sh
exec 1host=<设备ID>
mytool                         # 工具目录
mytool ping --help             # 参数表
mytool ping --json             # 无参调用
mytool other_tool --input - --json   # 复杂 JSON 经 stdin
```

`mcp tools|describe|call` 仍保留为**调试直通**，不是作者文档的默认调用面。

**页面**：

```js
const conn = await $hosts.openTools(hostId)
const out = await conn.execCall('mytool ping --input - --json', { stdin: '{}' })
// 检查 out.attrs.exit_code，再解析 JSON.parse(out.content)
await conn.close()
```

- 参数经 stdin 传 JSON，**不要把业务字符串拼进脚本**。
- 服务命令的 JSON stdout 保留 `content` / `structuredContent` / `isError`；工具报错时退出码非零。
- 大输出会被截断——不要把截断预览当完整 JSON。

## 6. RTC 实时流（不是长任务日志）

`stream.channel` 现在是内建 pack 的真实 RTC DataChannel 路由配置：

```json
"stream": { "channel": "aic-example" }
```

但它**只声明路由，不制造流能力**：

- Provider 必须真正实现 `vtools.Streamer`；普通 MCP/TCP 适配器不会仅凭这段 JSON 获得流。
- 目前这条 manifest 装配链面向官方内嵌 pack；Browser 使用 Pod 明确的 `streamBrowser` 适配器。
- 未实现 Streamer、通道名为空/非法、撞名或使用保留的 `aic-tools`，都会显式拒绝登记。
- 所有者覆盖内置同名服务时不继承内置流；前端也必须使用同一个 channel。
- 上游流端点发现与消息协议仍由具体 Streamer 实现负责，当前没有通用 URL/端口文件/env 配置格式。

本例普通 MCP `mytool` **不应声明 `stream`**。长任务输出继续走 exec 日志与 `bg`，不要编造流通道。

## 7. 验收

- 包内只有源码、模块声明与测试；没有二进制、压缩包、构建产物。
- 服务能完成协议握手、工具发现和一次真实调用：`mytool`、`mytool ping --json`。
- 页面侧调用后关闭连接句柄；错误与截断不被当作成功。
- 声明 `stream` 前，已有真实 Streamer、前端协议和通道冲突测试，而不只是 JSON 字段。

## 8. 高频坑

1. 把一次性 stdin JSON CLI 声明成 `mcp-stdio` → initialize 无法完成。
2. 以为平台会执行 `scripts/` 里的脚本 → 不会，平台不安装不扫描。
3. 正文只写"已安装某某软件"而不写安装方式 → 用户装不了。
4. 服务声明里写死本机绝对路径 → 换设备就废；用占位符与程序解析规则。
5. 业务字符串拼进 `execCall` 脚本 → 引号/转义事故；一律走 stdin。
6. 忘了 `conn.close()` → 设备连接泄漏。
7. 把"大输出被截断"当成程序 bug → 先检查日志与截断规则。
8. 以为用户包的 `cli/` 会被设备自动注册 → 目前只有官方内嵌包会。
9. 把 `stream.channel` 当长任务输出开关 → 它是需要真实 Streamer 的 RTC 路由。
