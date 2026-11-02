# 设备 MCP 服务模板

这是一个**真实可运行的 MCP stdio 服务**：官方 Go SDK 负责 initialize、tools/list 和 tools/call；
包根 `manifest.json` 的 `host` 声明服务命令，经统一 commands 机制注册。它不是一次性 stdin JSON CLI。

## 构建

```sh
cd src
# 独立复制到没有父 go.mod 的目录时，先执行：
# cp go.mod.example go.mod && GOWORK=off go mod tidy
GOWORK=off go build -o ../bin/mytool .
cd ..
```

本仓由根 go.mod 统一提供 SDK 依赖；不要在技能目录里放嵌套 go.mod（go:embed 会跳过该目录）。

## 安装与调用（设备上下文）

```sh
# 下载、解包并注册，运行期生效，无需重启 pod/aic
commands install mytool

# 云端包只保存源码：在设备安装目录编译出 bin/mytool
cd ~/.aic/packages/mytool/src
cp go.mod.example go.mod && go mod tidy
mkdir -p ../bin && go build -o ../bin/mytool .

# 正式服务命令面
mytool
mytool ping --help
mytool ping --json
```

服务调用门是命令别名本身（本例 `grant cmd mytool`）；是否需 `grant cmd` 取决于设备策略。
运行配置（环境变量、免沙箱）由设备 owner 用 `commands config mytool` 调整，manifest 里不许声明。

## 边界

- `src/` 只入库源码与模块声明，不放 `bin/`、二进制、压缩包或构建产物。
- 官方与第三方包同权：包根 `manifest.json` 的 `host` 声明经 `commands install` 注册，不需要另外用 `commands add` 登记。
- 本例是普通 MCP Provider，**不声明 RTC 流**。流能力要求服务真实监听流地址并实现流协议，
  在 `host.<alias>.streams.<name>.address_env` 声明（参考 browser 包）；长任务输出仍走 exec 日志与 `bg`。
- 需要普通原生 CLI 时看根技能 `hello`，不要把一次性 stdin JSON 程序声明成 MCP 服务。
