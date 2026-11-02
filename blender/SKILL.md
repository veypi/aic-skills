---
name: blender
version: 0.3.6
description: 通过现成 Blender MCP 服务查看场景、渲染和执行 Python；包含安装、连接、权限与调用指引。
keywords: [blender, 3d, bpy, 建模, 渲染]
---

# Blender

本包直接接入现成 **Blender MCP**（https://github.com/ahujasid/blender-mcp）。
pod 只按统一 commands 机制启动 `uvx blender-mcp`，工具名、参数、结果与错误均由上游
MCP 服务提供；本仓不再维护自研 addon、TCP Provider 或协议桥接。

## 安装与连接

1. 安装 Blender 4.x/5.x GUI 与 [uv](https://docs.astral.sh/uv/)。
2. 按上游说明把仓库中的 `addon.py` 安装到 Blender，并在 Add-ons 中启用 **Blender MCP**。
3. 打开 Blender，在 BlenderMCP 面板启动/连接服务。
4. 在设备上注册本包：

```sh
commands install blender
```

manifest 使用 PATH 中的 `uvx`，不需要在本仓编译 `bin/blender`。首次运行会由 uv 获取上游
`blender-mcp` 包，因此需要网络与 uv 缓存目录可写。平台 exec 沙箱不满足这些条件时，由设备
owner 显式授予：

```sh
# 提权项：平台会话需人工批准，本机 owner 直接执行不需要
commands config blender --no-sandbox
```

`AIC_BLENDER_EXE`、`AIC_BLENDER_TOKEN` 等旧桥接配置已删除，不再使用。上游地址、addon 安装和
连接细节以 Blender MCP 当前文档为准。

## 调用

```sh
blender                              # 实际上游工具目录
blender get_scene_info --json
blender execute_blender_code --code "import bpy; print(len(bpy.data.objects))" --json
blender <tool> --help                # 任一工具的实时参数表
```

调用门是命令别名本身（拒绝时按提示 `grant cmd blender`）。标量参数映射为同名 flag；复杂
对象走 `--input JSON` 或 `--input -`。不要假定上面的示例就是完整工具面，其他渲染、素材和
场景能力以 `blender`、`blender <tool> --help` 以及 `commands info blender --schema` 的实时
上游 schema 为准。工具失败按 MCP `isError` 返回非零退出，不自动重放有副作用的动作。

## 文件与脚本工作流

长脚本先写到设备已授权的位置，再按上游工具的实际文件参数或执行入口调用；不要通过多层
shell 引号拼接大段 Python。需要 AI 新建文件时先授权目标目录，例如：

```sh
grant fs <设备上的绝对工作目录>
```

渲染输出、视口截图和普通工作文件都应放在明确授权的工作目录。读取图片使用 fs 工具，不要把
大段 base64 当作长期文件格式。

## 故障排查

- `uvx` 不存在：先安装 uv，并确保 pod 的 PATH 能找到它。
- 首次启动失败：检查网络、代理、uv 缓存权限以及 `blender-mcp` 是否能由 owner 终端直接运行。
- MCP 已启动但调用失败：确认 Blender GUI 中的官方 addon 已启用并处于连接状态。
- 工具或参数不同：以当前上游工具目录为准，不使用旧版自研桥接的 `doctor/launch/install`
  或 `AIC_BLENDER_*` 指引。

## 验收

- `commands list --json` 中 `blender` 为 MCP 命令。
- `blender` 能列出上游工具，`blender get_scene_info --json` 能读取真实场景。
- 一个失败的上游工具调用返回非零退出；GUI 重启后可在下一次调用时重新建立连接。
