---
name: blender
version: 0.1.0
description: 用 vsh 的 blender 命令直连设备上的 GUI Blender——看场景/视口截图/执行 Python；未安装或未运行时给分级指引，agent 可自助完成安装与拉起。
keywords: [blender, 3d, bpy, 建模]
---

# Blender

设备上的 Blender 直连通道。`blender` 是 pod 内置服务（vtools 注册）：addon
`cli/aic_blender_bridge.py` 在 Blender GUI 内起一个 127.0.0.1:9866 的
vtools/tcp v1 服务，pod 侧零中转进程。

## 运行依赖

- Blender 4.x / 5.x（GUI）。未安装时 `blender doctor` 报 `blender_not_installed`
  并给安装命令（macOS `brew install --cask blender` / Windows
  `winget install BlenderFoundation.Blender` / Linux 发行版包管理器），AI 可
  在获得 `grant cmd brew`（或对应包管理器）后自行安装；装在非标准位置时用
  `AIC_BLENDER_EXE` 指定。
- addon 由 pod 内嵌分发：`blender launch` 用 boot 脚本挂载（**不动用户 Blender
  配置**）；`blender install` 把 addon 写进 Blender addons 目录供手动启用
 （适合常驻用户自己的 Blender 会话）。

## 使用

```sh
blender doctor                              # 三级体检：装了没 → 跑了没 → addon 连上没
blender launch                              # 一键拉起 GUI Blender 并挂载 addon（幂等）
blender install                             # 把 addon 装进 Blender addons 目录（手动启用路径）

blender                                     # 工具目录
blender ping --json                         # 连通握手（addon/Blender 版本）
blender get_scene_info --json               # 场景概要（对象/材质/集合计数 + 清单）
blender get_object_info --name Cube --json  # 单对象详情
blender execute_code --code "import bpy; bpy.ops.mesh.primitive_cube_add()" --json
blender get_viewport_screenshot --max-size 560 --json   # 视口帧（base64 PNG）
```

调用门是 exec 规则 `mcp.blender`（拒绝时按提示 `grant cmd mcp.blender`）。
标量参数直接映射为 flag；复杂参数走 `--input JSON`。`execute_code` 是万能
通道——addon 只监听 loopback，请在可信环境使用。

## 排错

| 现象 | 含义 | 处置 |
|---|---|---|
| `blender_not_installed` | 找不到 Blender 可执行文件 | 按文案安装，或 `AIC_BLENDER_EXE` 指定 |
| `blender_not_running` | 9866 不通 | `blender launch`，或人工启动 Blender 后用 `blender install` + 启用 addon |
| `addon_not_connected` | 端口通但握手失败 | addon 版本不匹配——`blender launch` 重挂（pod 升级后） |
| `main-thread-busy` | Blender 主线程被渲染/模态占住 | 等它空下来再发；不排队重发 |
| `blender launch` 等不到端口 | addon 挂载失败 | 读回执里的 statusFile 结论 |

## 重活走无头

长渲染/批量几何不占 GUI 通道：`exec` 原生跑（沙箱生效）——

```sh
blender -b --factory-startup --python script.py    # 需 grant cmd blender
```

超 5 分钟的任务照常由 exec 超时转后台（`bg wait/kill`）回收结果。

## 协议

addon 说 vtools/tcp v1（行分隔 JSON，≤16 MiB）：`tools` 回目录（含
inputSchema），`call` 回 `result` / `isError` / `error`。主线程经
`bpy.app.timers` 队列泵执行；排队 10s 未被取走报 `main-thread-busy`。
端口可用 `AIC_BLENDER_PORT` 覆盖（pod 与 addon 同读）。协议自测：
`python3 cli/selftest.py`（stub bpy，不需要真 Blender）。
