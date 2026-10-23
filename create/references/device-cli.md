# 设备侧命令（host CLI）

> 面向"不了解平台实现"的 AI。目标：让设备多一条命令，或让包里声明一个常驻服务。

## 1. 三种形态，先选对

| 形态 | 什么时候用 | 谁负责安装/运行 |
| --- | --- | --- |
| **普通脚本** | 一次性执行、无状态 | 用户自己跑（包内 `scripts/` 只是附件，平台不安装不扫描） |
| **原生 CLI** | 用户能自己装的独立程序 | 用户按正文安装；正文写清安装方式、依赖、固定路径、调用示例 |
| **常驻服务** | 需要保持连接、窗口、快照等状态 | 包内 `cli/manifest.json` 声明；设备启动时注册成命令 |
| **MCP 服务**（独立软件） | 第三方现成服务 | 用户安装 + 设备配置注册；技能只写安装与配置步骤 |

判据：**需要跨调用保持状态 → 服务；否则脚本/CLI。**

**重要现状**：包内 `cli/manifest.json` 的**自动注册只对官方内建包生效**（设备端启动时读取内嵌
技能集）。用户自己发布/安装的包，设备端目前**没有自动安装与注册链路**——所以对普通作者来说，
"给设备加命令"的正确做法是 **写清安装说明 + 附上源码**，而不是"放个 manifest 就有了"。

## 2. 普通脚本与原生 CLI

正文里写清四件事，缺一不可：

```text
安装：<包管理器命令 / 压缩包解压 / 预置路径>
依赖：<解释器版本、系统库、网络可达性>
固定路径：<绝对路径或 PATH 约定>
调用：<命令行示例，含参数与 stdin/stdout 约定>
```

包里可附 `scripts/hello.sh` 之类的附件，但**平台不执行它们**——不要写"平台会自动跑脚本"。

## 3. 常驻服务：包内声明

`cli/manifest.json`：

```json
{
  "alias": "mytool",
  "service": {
    "kind": "mcp-stdio",
    "args": ["mcp", "--tools", "core"],
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
  ],
  "stream": { "channel": "aic-mytool" }
}
```

字段：

| 字段 | 含义 |
| --- | --- |
| `alias` | 服务别名（省略则用包名）；注册后命令名相关 |
| `service.kind` | 服务类型（`mcp-stdio` = 以 stdio 方式拉起的 MCP 服务） |
| `service.args` | 启动参数 |
| `service.cwd` | 工作目录（占位符 `{workdir}`） |
| `service.env` | 环境变量（占位符 `{home}`、`{workdir}`、`{env:NAME}`） |
| `service.idle_timeout` | 空闲回收时限（如 `30m`） |
| `service.no_sandbox` | 是否脱离设备沙箱运行（谨慎开启） |
| `programs` | 程序解析规则：从哪个环境变量/目录找可执行文件，以及各平台文件名 |
| `stream.channel` | 流通道名（长任务输出走这里） |

**源码入库，产物不入库**：`cli/` 里只放源码（`main.go`、`py/main.py`…），
**不放** `cli/bin/`、二进制、压缩包、构建输出。构建产物由设备侧构建流程产出。

## 4. 第三方 MCP 服务

技能不代管第三方软件的安装与运行状态。正文写清：

- 安装方式与版本要求；
- 设备侧注册方式（设备 `mcp.servers` 配置，或 `mcp add` 命令）；
- 授权提示（设备服务命令按权限申请，拒绝时走授权流程）；
- 调用示例。

平台内置的官方服务（浏览器、桌面控制）由平台自己提供，技能只需写用法。

## 5. AI 与页面怎么调用设备命令

**AI**（把执行端切成设备）：

```sh
exec 1host=<设备ID>
mcp tools mytool
mcp describe mytool take_snapshot
mcp call mytool take_snapshot --input '{"pageId":1}'
```

**页面**（通过设备连接句柄）：

```js
const conn = await $hosts.openTools(hostId)
const out = await conn.execCall('mcp call mytool list_pages --input - --json', { stdin: '{}' })
// 检查 out.attrs.exit_code，再解析 JSON.parse(out.content)
await conn.close()
```

- 参数经 stdin 传 JSON，**不要把业务字符串拼进脚本**。
- MCP 命令的 JSON stdout 保留 `content` / `structuredContent` / `isError`；工具报错时退出码非零。
- 大输出会被截断——**不要把截断预览当完整 JSON**。

## 6. 验收

- 包内只有源码；没有二进制、压缩包、构建产物。
- 正文写全了：安装、依赖、固定路径、调用示例。
- 设备上按正文能装好并跑通（能执行一次真实调用）。
- 服务类：注册后命令可被发现（`mcp tools <alias>`），参数经 stdin 传参正常。
- 页面侧调用后记得关闭连接句柄。

## 7. 高频坑

1. 把二进制塞进包 → 违反契约且体积超限。
2. 以为平台会执行 `scripts/` 里的脚本 → 不会，平台不安装不扫描。
3. 正文只写"已安装某某软件"而不写安装方式 → 用户装不了。
4. 服务声明里写死本机绝对路径 → 换设备就废；用占位符与程序解析规则。
5. 业务字符串拼进 `execCall` 脚本 → 引号/转义事故；一律走 stdin。
6. 忘了 `conn.close()` → 设备连接泄漏。
7. 把"大输出被截断"当成程序 bug → 是日志与截断规则。
8. 以为用户包的 `cli/` 会被设备自动注册 → 目前只有官方内建包会。
