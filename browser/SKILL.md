---
name: browser
version: 1.2.0
description: 用设备上的 Chrome 实时查看与操作网页：CDP 通道供 AI 驱动浏览器，UI 提供同一浏览器的实时画面与人工交互。
ui:
  - path: index.html
    desc: 设备窗口列表、导航与实时键鼠交互
    handles: [http, https]
---

# Browser

设备侧是一个自带的 Chrome（`browser` 程序）：它既是 MCP 工具服务，也提供实时画面流。
UI 与 AI 共享同一个浏览器实例和同一个页面，人工与 AI 可以同时操作。

## 安装与构建

```sh
# 下载、解包并注册，运行期生效，无需重启 pod/aic
commands install browser

# 在设备安装目录编译（云端包只保存源码，不保存二进制）
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
| `cast_stats` | 画面链路只读自检（会话、订阅者数、收/发帧数） |

页面级工具接受可选 `target_id`；UI 始终显式传递，避免并行操作抢改共享 session。
AI 可先 `attach` 选定当前页后省略。元素引用取自最近一次快照；先看 schema 再传参。

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
- 没有人观看时设备停止 screencast（避免持续合成占满 CPU）。

## 配置面

| 文件键或 env | 作用 |
| --- | --- |
| `AIC_BROWSER_PATH` | Chrome 可执行文件路径（兼容 `AGENT_BROWSER_EXECUTABLE_PATH`） |
| `BROWSER_SECURE_ORIGINS` | 逗号/换行分隔的 http origin，绕开 Chrome 自动 HTTPS 升级 |
| `BROWSER_WINDOW_SIZE` | 视口尺寸，默认 `1280x720`（720p）；影响截图帧的比例 |
| `BROWSER_PROFILE` | Chrome 资料目录 |
| `BROWSER_HEADLESS` | `0`/`false` = 有头 |
| `BROWSER_PROXY` | Chrome 代理地址 |
| `BROWSER_CHROME_ARGS` | 额外 Chrome 参数 |

`BROWSER_STREAM_ADDR` 由 pod 在启动时注入，包内 UI 的流名为 `view`，无需手工配置。

## 注意

1. 内网 http 站点若被 Chrome 自动升级到 https，将 origin 写入 `BROWSER_SECURE_ORIGINS`。
2. 浏览器服务通常需要 `commands config browser --no-sandbox`，否则 Chrome 自身沙箱无法初始化。
3. 服务调用与流权限统一为 `grant cmd browser`。
4. 更新设备包：`commands update browser`；更新后按本文重新构建。
5. 移除设备包：`commands uninstall browser`（该包的命令定义级配置随包清除）。
6. 视口比例固定为 `BROWSER_WINDOW_SIZE`；不做移动端模拟。
7. 不做远端剪贴板读取与本地文件拖放。
