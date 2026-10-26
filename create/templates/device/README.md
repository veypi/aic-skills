# 设备 MCP 服务模板

这是一个**真实可运行的 MCP stdio 服务**：官方 Go SDK 负责 initialize、tools/list 和 tools/call；
`cli/manifest.json` 描述 Pod 如何解析程序并注册服务。它不是一次性 stdin JSON CLI。

## 构建

```sh
cd cli
# 独立复制到没有父 go.mod 的目录时，先执行：
# cp go.mod.example go.mod && GOWORK=off go mod tidy
GOWORK=off go build -o ../mytool .
cd ..
```

本仓由根 go.mod 统一提供 SDK 依赖；不要在技能目录里放嵌套 go.mod（go:embed 会跳过该目录）。

## 注册与调用（设备上下文）

```sh
# 首次注册需要设备策略允许 mcp；路径必须是设备上的绝对路径
mcp add mytool /absolute/path/to/mytool

# 正式服务命令面
mytool
mytool ping --help
mytool ping --json
```

服务授权仍走 `mcp.<alias>`（本例 `mcp.mytool`）；是否需 `grant cmd` 取决于设备策略。

## 边界

- `cli/` 只入库源码与清单，不放 `cli/bin/`、二进制、压缩包或构建产物。
- 自动读取包内清单目前只对官方内嵌包生效；普通用户包用上面的 `mcp add` 或设备配置注册。
- 本例是普通 MCP Provider，**没有实现 `vtools.Streamer`，所以不能声明 `stream.channel`**。
  RTC 流要求真实 Streamer 实现；长任务输出仍走 exec 日志与 `bg`。
- 需要普通原生 CLI 时看根技能 `hello`，不要把一次性 stdin JSON 程序声明成 MCP 服务。
