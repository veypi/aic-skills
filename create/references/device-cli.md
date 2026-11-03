# 设备侧命令（host CLI）

> 面向"不了解平台实现"的 AI。目标：让设备多一条命令，或让包里声明一个常驻服务。

## 1. 先选形态

| 形态 | 什么时候用 | 谁负责安装/运行 |
| --- | --- | --- |
| **普通脚本** | 一次性执行、无状态 | 用户自己跑（包内 `scripts/` 只是附件，平台不安装不扫描） |
| **原生 CLI** | 用户能自己装的独立程序 | 用户按正文安装；正文写清安装方式、依赖、固定路径、调用示例 |
| **包内常驻服务** | 需要保持连接、窗口、快照等状态 | 包根 `manifest.json` + 包内服务程序（`src/`）；`commands install` 注册 |
| **独立 MCP 服务** | 第三方现成服务 | 用户安装并用 `commands add` 或设备 `commands` 配置段注册；技能写清安装与配置步骤 |

判据：**需要跨调用保持状态 → 服务；否则脚本/CLI。** 一次性 stdin JSON CLI 不是 MCP 服务。

**唯一契约**：包根 `manifest.json`（`schema` / `host`）是所有设备包的统一写法，
官方包与第三方包同等待遇；`commands install <id>` 拉取并注册，运行期生效，无需重启 pod。
旧的 `cli/manifest.json` 维度（内嵌 packs 注册）已删除，不要再用。

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

包根 `manifest.json`（与 `templates/device` 的真实 MCP SDK 程序配套）：

```json
{
  "schema": 1,
  "host": {
    "mytool": {
      "run": ["bin/mytool"],
      "protocol": "mcp",
      "idle_timeout": "30m"
    }
  }
}
```

字段：

| 字段 | 含义 |
| --- | --- |
| `schema` | 固定 `1`；其它值拒绝 |
| `host.<alias>` | 服务别名 = 注册后的 vsh 根命令名（调用门就是这个别名，`grant cmd <alias>`） |
| `run` | 启动程序与参数；包内相对路径（如 `bin/mytool`）解析到包安装目录，设备侧构建产物 |
| `url` | 远程 MCP 服务端点（http/https；与 `run` 二选一，必须 `protocol: "mcp"`） |
| `protocol` | `mcp`（stdio 或远程 MCP 服务）；空 = 普通进程命令 |
| `idle_timeout` | 空闲回收时限（如 `30m`）；仅常驻服务可配，必须是正 duration |
| `host.<alias>.streams` | 可选：内嵌于所属服务的 RTC 流声明（见 §6） |

校验规则（aic 与 pod 同一契约，违反即拒）：

- `alias` 必须匹配 `^[a-z][a-z0-9_-]{0,63}$`。
- `run` 与 `url` 必须且只能配置一个；`run[0]` 非空白。
- `url` 只能是 http/https，禁 userinfo 与 fragment；URL 服务不能声明 `streams`。
- `idle_timeout` 仅常驻服务（MCP 或带 streams）可配，且必须是正 duration；一次性命令配置即拒。
- `streams` 的流名与 `address_env` 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，同一服务内 `address_env` 不得重复。

**服务里不要写其它字段**：manifest 解析是严格模式（未知字段报错）；`cwd` / `env` / `no_sandbox`
是设备 owner 的设置，写进 manifest 会被显式拒绝——运行配置只能由 owner 用
`commands config <alias>` 给（含 `--no-sandbox` 免沙箱，平台会话需人工批准）。

**源码入库，产物不入库**：`src/` 只放源码、模块声明与测试，**不放** `bin/`、二进制、压缩包、构建输出。
MCP stdio 服务必须真正实现 initialize、tools/list、tools/call；示例使用官方 Go SDK，不用 `io.ReadAll` 等 EOF 冒充协议。
本仓由根 go.mod 提供测试依赖，示例用 `go.mod.example` 供独立复制后生成模块文件；**不要在技能目录里放嵌套 go.mod**，否则 go:embed 会跳过整段示例。

安装与设备侧构建（写进包的 SKILL.md，照 browser/blender/cua 的「安装与构建」小节）：

```sh
commands install mytool
# 平台 exec 先允许写设备包目录（本机 owner 终端按本机权限执行）
grant fs <设备用户 home 的绝对路径>/.aic/packages/mytool
# 云端包只保存源码：在设备安装目录编译出 bin/mytool
cd ~/.aic/packages/mytool/src
cp go.mod.example go.mod && go mod tidy
mkdir -p ../bin && go build -o ../bin/mytool .
```

## 4. 第三方服务注册

技能不代管第三方软件的安装与运行状态。正文写清安装、版本、设备注册与授权：

```sh
commands add mytool -- /absolute/path/to/mytool
# 已有 MCP HTTP 端点也可用 commands add --protocol mcp --url；按当前 commands --help 为准
```

`commands add/remove` 改能力配置；服务命令的调用门是别名本身（`grant cmd <alias>`）。是否需 `grant cmd` 取决于设备策略。
技能包服务默认受沙箱约束；免沙箱只能由设备 owner 用 `commands config <alias> --no-sandbox` 授予，不能由技能或工具参数提权。

## 5. AI 与页面怎么调用

正式调用面是 **`<alias> <tool>` 服务根命令**：

```sh
exec _host=<设备ID>
mytool                         # 工具目录
mytool ping --help             # 参数表
mytool ping --json             # 无参调用
mytool other_tool --input - --json   # 复杂 JSON 经 stdin
```

调试直通已随统一命令面下线；工具目录用 `<alias>`（无参），参数表用 `<alias> <tool> --help`，原始 inputSchema 用 `commands info <alias> --schema`。

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

包根 `manifest.json` 在所属 `host.<alias>` 服务内用 `streams` 声明实时流，command hub 落地为 `<alias>:<stream>` 标签的
RTC DataChannel（如 `mytool:view`）：

```json
"host": {
  "mytool": {
    "run": ["bin/mytool"],
    "protocol": "mcp",
    "streams": {
      "view": { "address_env": "MYTOOL_STREAM_ADDR" }
    }
  }
}
```

（片段含完整服务声明：`run`/`url` 二选一的要求对带流服务同样生效，只写 `streams` 会被拒。）

- 流内嵌于所属服务，不再单独写 `command`；`address_env` 是服务进程读取流监听地址的
  环境变量名。参考实现：`browser` 包（`host.browser.streams.view` + 包内 Go 服务推帧 + 技能自带 UI）。
- 它**只声明路由，不制造流能力**：包内服务必须真正监听并实现流协议，前端使用同一个
  `<alias>:<stream>` 标签。
- 通道名为空/非法、撞名或使用保留的 `aic-tools`，都会显式拒绝登记。

本例普通 MCP `mytool` **不应声明 `streams`**。长任务输出继续走 exec 日志与 `bg`，不要编造流通道。

## 7. 验收

- 包内只有源码、模块声明与测试；没有二进制、压缩包、构建产物。
- 服务能完成协议握手、工具发现和一次真实调用：`mytool`、`mytool ping --json`。
- 页面侧调用后关闭连接句柄；错误与截断不被当作成功。
- 声明 `streams` 前，已有真实流服务、前端协议和通道冲突测试，而不只是 JSON 字段。

## 8. 高频坑

1. 把一次性 stdin JSON CLI 声明成 `mcp-stdio` → initialize 无法完成。
2. 以为平台会执行 `scripts/` 里的脚本 → 不会，平台不安装不扫描。
3. 正文只写"已安装某某软件"而不写安装方式 → 用户装不了。
4. 服务声明里写死本机绝对路径 → 换设备就废；`run` 用包内相对路径，设备差异由 owner 的 `commands config` 承担。
5. 业务字符串拼进 `execCall` 脚本 → 引号/转义事故；一律走 stdin。
6. 忘了 `conn.close()` → 设备连接泄漏。
7. 把"大输出被截断"当成程序 bug → 先检查日志与截断规则。
8. 还在写 `cli/manifest.json` → 旧维度已删，唯一契约是包根 `manifest.json` + `commands install`。
9. 把 `streams` 当长任务输出开关 → 它是需要真实流服务的 RTC 路由。
