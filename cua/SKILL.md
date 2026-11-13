---
name: cua
version: 1.3.5
description: 通过设备上的官方 CuaDriver MCP 操作应用、原生窗口和浏览器。
---

# CUA

Pod 经统一 commands 机制拉起本包自带启动器（`src/`，Go）：`cua` 负责定位官方
`cua-driver` 并以 `mcp` 运行（stdio 直通），独立的 `cua_cast` 负责主桌面 H.264 画面流。
工具名、描述、参数、结果全部来自上游；pod 对 cua 没有任何专属代码与配置——本包与
普通第三方包同一 manifest 契约，只是作为官方包随发行预装。

## 安装与构建

Desktop 与 CLI 发行包**预装本包并附带预编译的 `bin/cua` 与 `bin/cua_cast`**：pod 启动时自动定版到
`~/.aic/packages/cua`，无需 `commands install` 与 Go 工具链；包随 pod 版本整体更新，
不可 `commands install/update/uninstall`。

源码运行 pod（没有随包二进制的环境）才需要手动构建：

```sh
# 平台 exec 先允许写设备包目录（本机 owner 终端按本机权限执行）
grant fs <设备用户 home 的绝对路径>/.aic/packages/cua

cd ~/.aic/packages/cua/src
cp go.mod.example go.mod
go mod tidy
mkdir -p ../bin
go build -o ../bin/cua .
go build -o ../bin/cua_cast ./cua_cast
```

## 免沙箱

服务默认在 pod 沙箱里运行，而桌面自动化需要设备级权限（辅助功能/屏幕录制
身份、CuaDriver 自己的状态目录），需要设备 owner 授予免沙箱：

```sh
# 提权项：平台会话需人工批准（未批准会被明确拒绝），本机 owner 直接执行不需要
commands config cua --no-sandbox
commands config cua_cast --no-sandbox
```

Desktop 随包提供 CuaDriver 0.47.19 运行资源；预装定版后即注册 `cua`，第一次调用时启动。CLI 可安装官方 CuaDriver，或通过 `AIC_CUA_DRIVER_PATH` 指定可执行文件。macOS 按上游安装布局把官方 CuaDriver.app 安装到 `/Applications/CuaDriver.app`（可复制 Desktop 的 resources/cua/darwin/CuaDriver.app）；仅把 app 放在资源目录不会完成系统安装。官方 MCP 会按应用名启动 daemon，客户端与安装的驱动版本应一致。升级后先用 `cua-driver stop` 停止旧 daemon。macOS 使用 CuaDriver.app 的辅助功能和屏幕录制授权身份；使用 `cua-driver permissions grant` 引导授权，`cua-driver doctor` 诊断。

调用设备在 exec 外层通过 `_host` 选择。默认 `exec_policy:"open"` 下 `cua` 与 `cua_cast`
可直接使用，无需手动 grant；仅设备改为 `exec_policy:"deny"` 或存在对应 deny 规则时，
才需要 `grant cmd <alias>`。工具内部的权限与路径限制由 CuaDriver 执行。原生 fs 的路径规则
不等同于对桌面自动化的隔离。

```sh
cua                              # 工具目录
cua check_permissions --json
cua list_apps --json
cua list_windows --input '{"pid":123}' --json
cua get_window_state --pid 123 --window_id 456 --session work --json
cua get_window_state --help      # 按 inputSchema 渲染参数表
```

标量参数自动映射为同名 flag（如 `--pid 123`）；复杂对象走 `--input JSON`。工具目录用 `cua`（无参），原始 schema 用 `commands info cua --schema`。

`pid`、`window_id` 使用上游枚举结果。动作使用最新观察返回的 `element_token`；同一工作过程沿用同一 `session`。引用失效后重新观察，不能重放可能已执行的动作。参数以当前 `cua <tool> --help` 渲染的官方 schema 为准，不传入自定义 `locator`、`ref` 或 `view_id`。

`--input -` 从 stdin 读取 JSON。命令输出标准 MCP 结果，包含上游 `content`、可选 `structuredContent` 和 `isError`。图片保留为 MCP image 内容，不转换为自定义观察对象。

## 主桌面 H.264 UI

UI `/skills/cloud/cua` 只提供**主显示器桌面的 H.264 实时画面与控制**，没有应用窗口列表、
截图轮询、图像预览或其他旧画面路径。它通过
`connection.openStream({command:'cua_cast',name:'view'})` 接收视频，CUA MCP 仅用于权限诊断
和输入动作；页面不会调用 `get_desktop_state` / `get_window_state`，也不补抓 `capture_id`。

旧 Pod、没有 WebCodecs、推流失败或持续无帧都直接进入错误状态，**没有任何 fallback**。
只有手动重试才重新开流。无帧错误附带接收、提交解码、实际解码、跳过计数及最后解码错误。
首个 IDR 后会显式 `flush()` 一次，解码器仍无输出或 flush 失败会立即报错。

`cua_cast` 只在有订阅者时启动 FFmpeg，最后一个订阅者断开后停止。macOS 使用
`avfoundation + h264_videotoolbox`，Windows 使用 `ddagrab + h264_mf`（DXGI Desktop Duplication）；默认 30fps、
4Mbps、GOP 15、无 B 帧、最大编码边长 1920。可用 `CUA_FFMPEG_PATH`、
`CUA_CAST_FPS`、`CUA_CAST_BITRATE`、`CUA_CAST_MAX_DIMENSION`、`CUA_CAST_ENCODER`
调整。NVIDIA Windows 设备可设置 `CUA_CAST_ENCODER=h264_nvenc`，自动启用超低延迟参数。测试期要求 FFmpeg 在 PATH 中，不随包捆绑。

流协议 `cua/stream-v1` 使用 `[u8 kind][u32 payloadLen][u64 seq][payload]` 二进制包头；
FRAME 携带 IDR 标记、编码尺寸、时间戳和 Annex B access unit，CONTROL 携带编码参数
（含原始桌面尺寸）及会话错误。浏览器用 WebCodecs 以 `prefer-hardware` 解码到 canvas，
首个 IDR 后显式 flush 保证首帧交付；硬解已用同一份 Annex B 码流验证首帧与连续 60 帧，
页面确认画完或丢弃的帧；
发送端不按 ACK 排队等待，慢订阅者跳到下一个 IDR，不积累 GOP 延迟。传输断开同样直接暴露错误，只有手动重试
才重新开流。

点击、拖动、滚轮、文字与快捷键仍走 `cua` MCP，直接绑定当前视频帧的本地 frameId/epoch；
坐标输入显式使用 `delivery_mode:"foreground"`（用户主动控制即同意交出真实指针），
不使用截图或 `capture_id`；单击与滚轮立即发送，不增加双击识别或滚动批处理等待。后续视频帧不会让已经排队的输入过期，但设备切换、目标 epoch
变化与旧观察显式重放仍会拒绝。页面或平台窗口隐藏时关闭流，恢复可见后重连。工具栏显示
实际解码并绘制的帧率。

`cua_cast` 使用独立命令授权与免沙箱配置。macOS 屏幕录制按 responsible process 归属：
终端/exec 中的 FFmpeg 通常继承终端（如 WezTerm）的既有授权，不会单独弹窗或新增
权限条目；Desktop 发行中则归属其宿主应用。只有宿主尚无屏幕录制权限时才需要授权，
CuaDriver.app 的独立条目不决定这个权限。设备 owner 执行：

```sh
commands config cua_cast --no-sandbox
```

设备所有者可用 `commands config cua` 调整运行配置（环境变量、`--no-sandbox` 等）。技能包不维护本地安装状态。

官方说明：https://cua.ai/docs/cua-driver
