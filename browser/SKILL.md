---
name: browser
version: 1.2.15
description: 用设备上的 Chrome 实时查看与操作网页：CDP 通道供 AI 驱动浏览器，UI 提供同一浏览器的实时画面与人工交互。
---

# Browser

设备侧是一个自带的 Chrome（`browser` 程序）：它既是 MCP 工具服务，也提供实时画面流。
UI 与 AI 共享同一个浏览器实例和同一个页面，人工与 AI 可以同时操作。

## 安装与构建

Desktop 与 CLI 发行包**预装本包并附带预编译的 `bin/browser`**：pod 启动时自动定版到
`~/.aic/packages/browser`，开箱即有 `browser` 命令，无需安装与 Go 工具链；包随 pod
版本整体更新，不可 `commands install/update/uninstall`。

源码运行 pod（没有随包二进制的环境）才需要手动构建：

```sh
# 平台 exec 先允许写设备包目录（本机 owner 终端按本机权限执行）
grant fs <设备用户 home 的绝对路径>/.aic/packages/browser

cd ~/.aic/packages/browser/src
cp go.mod.example go.mod
go mod tidy
mkdir -p ../bin
go build -o ../bin/browser .
```

## 配置：命令定义级配置（统一面）

应用配置与沙箱策略是同一张表里的同一件事——「这条命令定义的运行配置」。
写面只有 `commands config`，按**定义身份**存储（与 alias 同名替换无关）：

```sh
# 应用配置（环境变量）：AI 可直接写
commands config browser AIC_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
commands config browser BROWSER_SECURE_ORIGINS="http://localhost:4000"

# 免沙箱：Chrome 自身沙箱在 pod 沙箱里起不来（ERR_ABORTED）。
# 这是提权项——平台会话需人工批准（未批准会被明确拒绝），本机 owner 直接执行不需要。
commands config browser --no-sandbox

# 查看 / 撤销
commands config browser
commands config browser --unset BROWSER_SECURE_ORIGINS
commands config browser --sandbox
```

包也会读 `~/.aic/browser/config.env`（同名键值，仅在环境变量未设置时生效）——
那是 owner 的可选便捷项，不是平台的配置面。

**AIC Desktop 自带 Chrome**：桌面版启动后端时会注入 `AIC_BROWSER_PATH`（随包
Chrome for Testing 的**可执行文件路径**，不是目录）。换浏览器用
`commands config browser AIC_BROWSER_PATH=…` 覆盖（命令定义级配置优先于继承环境）。
独立 CLI / Docker 不带浏览器，需自装 Chrome 并同样用 `commands config` 指定。

配置后：

```sh
grant cmd browser
browser
browser navigate --input - --json
```

## 设备侧程序

源码在 `src/`（Go，只入库源码；二进制与构建产物不入库）。程序两种形态：

- **stdio（默认）**：MCP 工具服务；同时在 `BROWSER_STREAM_ADDR` 指定的地址上开一个
  TCP 流，供实时画面使用。
- **`--http <addr>`**：自带 HTTP MCP 服务（进程已在设备上、Pod 只做代理时用）。

## 工具面

MCP 工具（`browser <tool> --input '{...}' --json`，标量参数自动映射为同名 flag）：

| 工具 | 用途 |
| --- | --- |
| `cdp` | 原始 CDP 命令（任何 CDP 域都能调，AI 的主要通道） |
| `targets` | 列出浏览器目标（页面、worker）及其 id、类型、标题、URL |
| `attach` | 绑定页面目标为后续命令的会话（重复 attach 复用 session） |
| `eval` | 在目标页面执行 JavaScript |
| `navigate` | 导航到 URL（默认等待文档加载完成；`wait:false` 只发起导航） |
| `snapshot` | 无障碍树 + 元素引用（`e1`、`e2`…），供 click/fill 用 |
| `click` / `fill` | 按引用点击 / 填值 |
| `screenshot` | 截图（PNG） |
| `dialog_status` / `dialog_answer` | 页面上 JS 对话框（alert/confirm/prompt）的查询与应答 |
| `cast_stats` | 画面链路只读自检（会话、订阅者数、收/发帧数、页面 ack 数、ack 失败数、丢弃帧数、停止喂帧的订阅者数） |

页面级工具接受可选 `target_id`；UI 始终显式传递，避免并行操作抢改共享 session。
AI 可先 `attach` 选定当前页后省略。attach 使用页面级 WebSocket 直连并缓存连接，不经过会激活可见 Chrome 的 `Target.attachToTarget`。页面级命令不会激活标签页或抢占系统窗口焦点；原始 CDP 入口也禁止 `Target.activateTarget`、`Page.bringToFront` 和 `Browser.setWindowBounds`，新建标签强制后台创建。元素引用取自最近一次快照；先看 schema 再传参。

复杂参数走 stdin：

```sh
echo '{"url":"https://example.com/"}' | browser navigate --input - --json
```

## 实时画面

- **推帧**：CDP `Page.startScreencast`，Chrome 合成器出帧即推；页面静止时不产帧（正常语义）。
- **背压**：页面画完才回 ack，设备再 ack Chrome，Chrome 才推下一帧 → 端到端只有一帧在途，
  缓冲不会堆积；页面慢就掉帧，不会拖垮链路。实测动画页面 60fps、每帧约 6KB。
- **帧格式**：裸 JPEG 字节，私有协议 `browser/stream-v2` 全二进制
  （`[u8 kind][u32 payloadLen][u64 seq][payload]`），链路上没有 base64、没有 JSON。
- 人工输入与画面共用同一条流：坐标是视口归一化值 `[0,1]`，支持鼠标、滚轮、键盘、中文输入。
  页面必须自己把坐标钳在 `[0,1]`（指针被捕获时拖出画布，事件仍会发到画布上，
  越界坐标会被设备拒绝）。
- **错误分作用域**：设备的 CONTROL 消息带 `scope`——`input` = 只有这一次输入没
  派发出去（画面链路还活着，页面只提示，不拆流）；`session` = 画面会话本身
  出了问题（页面重开流）。
- **页面确认**：页面画完一帧才回确认（背压：一帧在途）；画不完时页面自己有
  1.5 秒看门狗兜底确认，否则设备会停止喂帧。
- **窗口不可见时页面自己放掉流**：看不见就断开（设备停 screencast，不烧 CPU），
  可见时自己接回来。
- 没有人观看时设备停止 screencast（避免持续合成占满 CPU）。

## 配置面

| 文件键或 env | 作用 |
| --- | --- |
| `AIC_BROWSER_PATH` | Chrome 可执行文件路径 |
| `BROWSER_SECURE_ORIGINS` | 逗号/换行分隔的 http origin，绕开 Chrome 自动 HTTPS 升级 |
| `BROWSER_WINDOW_SIZE` | 视口尺寸，默认 `1280x720`（720p）；影响截图帧的比例 |
| `BROWSER_PROFILE` | Chrome 资料目录，默认 `~/.aic/chrome-profile`（固定目录，登录态跨重启保留；`~` 会展开，目录自动创建） |
| `BROWSER_HEADLESS` | 默认 `1` = 不显示窗口；`0`/`false` = 可见窗口。macOS 用 `open -g` 启动；所有实例均带 `--no-startup-window`，启动阶段不创建窗口、不抢前台 |
| `BROWSER_CDP_URL` | 接入**已经在运行**的浏览器：`host:port` / `http://…` / `ws://…`（前两种会自动问 `/json/version` 换 WebSocket）。设了就不起本地 Chrome，关闭只断连、绝不杀对方进程；`BROWSER_PROFILE`/`BROWSER_HEADLESS` 等启动项在此模式下无效 |
| `BROWSER_PROXY` | Chrome 代理地址 |
| `BROWSER_CHROME_ARGS` | 额外 Chrome 参数 |

`BROWSER_STREAM_ADDR` 由 pod 在启动时注入，包内 UI 的流名为 `view`，无需手工配置。

## 注意

1. 内网 http 站点若被 Chrome 自动升级到 https，将 origin 写入 `BROWSER_SECURE_ORIGINS`。
2. 浏览器服务通常需要 `commands config browser --no-sandbox`，否则 Chrome 自身沙箱无法初始化。
3. 服务调用与流权限统一为 `grant cmd browser`。
4. 预装包随 pod 版本更新（启动定版为内嵌内容）；不可 `commands update/uninstall`。
5. 视口比例固定为 `BROWSER_WINDOW_SIZE`；不做移动端模拟。
6. 不做远端剪贴板读取与本地文件拖放。
8. 同一个资料目录同一时刻只能有一个 Chrome 实例：不要拿 `BROWSER_PROFILE` 指向的目录
   再手动开一个 Chrome（会被 SingletonLock 挡住，表现为 DevTools 端点一直等不到）。
   想人工操作同一个浏览器，用 `BROWSER_HEADLESS=0` 让服务自己把窗口显示出来。
9. `BROWSER_CDP_URL` 接入自己的浏览器时，那个浏览器必须是你自己带
   `--remote-debugging-port=9222` 启动的；Chrome 136+ 对**默认资料目录**直接忽略
   调试开关，必须同时给一个非默认 `--user-data-dir`（官方安全策略，防被接管盗号）。
   接入后 AI 能读到那些页面的内容并按你的登录态操作，只在你明确要这样时才配置。

## 画面链路的四个硬约束（2026-11-12 实测后定）

1. **ack Chrome 绝不能在 CDP 读循环里同步发**：CDP 响应只能由读循环读出来，
   在读循环里等响应就是自锁（每帧卡满 5 秒超时，画面从 60fps 掉到 0.2fps）。
   `ackCastFrame` 走后台 goroutine。
2. **每个订阅者只保最新一帧**（队列深度 1，满了丢旧的）：慢订阅者不拖住链路，
   画面宁可跳帧也不堆积。
3. **不确认的订阅者只停止喂帧，不断连**（2026-11-12 改）：一直给它帧、它却 30 秒
   不确认，就当它暂时画不出来（窗口不可见、解码卡住、标签页被冻结），停止喂帧、
   每 10 秒探活一张。**不能断连**：断流在页面上表现为「画面闪断 + Byte stream
   disconnected 报错」。页面补一个确认就恢复喂帧；真的走了连接自己会断。
4. **流的维护归 pod**（写超时即断流），页面重新活跃时自己新建流。
