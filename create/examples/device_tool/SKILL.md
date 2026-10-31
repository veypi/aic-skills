---
name: device_tool
version: 0.1.2
description: 示例：真实 MCP stdio 设备服务——官方 SDK 实现 ping，含 manifest、构建、注册与正式服务命令调用。
keywords: [device, cli, mcp, 命令, 设备, 示例]
icon: fa-solid fa-terminal
---

# 设备 MCP 服务示例

这个包演示设备常驻服务在技能包里长什么样：**说明书与源码在云端，程序在设备上运行**。
`src/main.go` 使用官方 MCP Go SDK 实现 `ping`，不是一次性 stdin JSON CLI。

## 适用场景

需要在用户设备上注册一个可发现、可保持连接的工具服务。只跑一次性命令时，改用普通原生 CLI（见 `hello`）。

## 构建

```sh
cd src
# 独立复制到没有父 go.mod 的目录时，先执行：
# cp go.mod.example go.mod && GOWORK=off go mod tidy
GOWORK=off go build -o ../bin/mytool .
cd ..
```

本仓由根 go.mod 统一提供 SDK 依赖；不要在技能目录里放嵌套 go.mod（go:embed 会跳过该目录）。

## 安装与调用

```sh
# 下载、解包并注册，运行期生效，无需重启 pod/aic
commands install mytool

# 云端包只保存源码：在设备安装目录编译出 bin/mytool
cd ~/.aic/packages/mytool/src
cp go.mod.example go.mod && go mod tidy
mkdir -p ../bin && go build -o ../bin/mytool .

mytool
mytool ping --help
mytool ping --json
```

`mytool` 无参列出工具，`ping` 返回 `content` 中的 `pong`。复杂参数用 `--input -` 并经 stdin 传 JSON；
页面调用使用 `$hosts.openTools(hostId)` 后的 `execCall`，不要拼接业务字符串。

## 依赖与权限

- Go 1.27+（构建期）；运行期是设备上的独立进程。
- 包根 `manifest.json` 是唯一设备契约；`commands install` 注册，运行配置（环境变量、免沙箱）由设备 owner 用 `commands config mytool` 调整。
- 调用服务走命令别名 `mytool` 的权限，按设备策略决定是否 `grant cmd`。

## 验收与边界

- 能完成 MCP initialize、`mytool` 工具发现与 `mytool ping --json` 调用。
- 本例没有实现实时流服务，**不声明 `streams`**；普通 MCP 服务不会仅凭清单获得 RTC 流。
- 长任务输出走 exec 日志与 `bg`，不要编造流通道。
