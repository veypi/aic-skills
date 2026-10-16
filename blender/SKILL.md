---
name: blender
version: 0.3.0
description: 用 vsh 的 blender 命令直连设备上的 GUI Blender——看场景/渲染出图/执行 Python；未安装或未运行时给分级指引，agent 可自助完成安装与拉起。
keywords: [blender, 3d, bpy, 建模, 渲染]
---

# Blender

设备上的 Blender 直连通道。`blender` 是 pod 内置服务（vtools 注册）：addon
`cli/aic_blender_bridge.py` 在 Blender GUI 内起一个 127.0.0.1:9866 的
vtools/tcp v1 服务（强制认证首行），pod 侧零中转进程。

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
blender ping --json                         # 握手 + 渲染环境（引擎/分辨率/相机/当前文件）
blender get_scene_info --json               # 场景概要（对象/材质/集合计数 + 清单）
blender get_object_info --name Cube --json  # 单对象详情
blender execute_code --code "import bpy; print(len(bpy.data.objects))" --json
blender execute_code --file <设备脚本路径> --json          # 载入脚本（不自动执行）
blender execute_code --file <设备脚本路径> --entry build_all --json   # 载入并调入口（推荐）
blender get_viewport_screenshot --max_size 560 --json      # 视口帧（回 base64）
blender get_viewport_screenshot --max_size 960 --out <设备路径>/v.png --json
                                                           # 视口落盘，随后 fs read 看图
blender render --path <设备路径>/r.png --res 1280x720 --samples 24 --json
                                                           # 渲染落盘，随后 fs read 看图
blender render --path <设备路径>/r.png --input '{"camera":{"location":[8,-8,6],"target":[0,0,0],"lens":50}}' --json
```

调用门是 exec 规则 `mcp.blender`（拒绝时按提示 `grant cmd mcp.blender`）。
标量参数直接映射为 flag，**用 schema 原名**（`--max_size`、`--path`，**不是**
`--max-size`；写错的报错会给出可映射名字）；复杂参数（`camera`/`clip`）走
`--input JSON`。

## 脚本工作流（长脚本的正确姿势）

`--code` 只适合一行两行：长代码要同时跟 shell 引号与 JSON 转义搏斗——`--input`
里出现裸单引号会被 shell 吃掉（`to_track_quat('-Z','Y')` 会变成
`NameError: name 'Z' is not defined`），改一行还得重发整段。正规做法是脚本落盘 +
入口调用：

1. `fs write <设备路径>/build.py`（一次写全量脚本，**顶层只定义函数、不干活**）
2. `blender execute_code --file <设备路径>/build.py --entry build_all --json`

`--entry` 就是"这次跑哪一段"：把动作拆成 `build_all()` / `render_all()` /
`fix_lights()`，改哪段跑哪段，不必重跑全量；不带 `--entry` 只载入（查 import
副作用、探接口、确认脚本语法）。注意 `--file` 载入时 `__name__` 是
`__aic_exec__`，`if __name__ == "__main__"` 守护块**不会**触发——想跑就写进 `--entry`。

脚本留在设备上可复查、可交接。路径选设备已授权可写处（mbp
`/Users/veypi/workspace/`、win `C:/Users/v/aic/`）。

## 看图：视口截图 vs 渲染

- **视口截图**（`get_viewport_screenshot`）看的是"用户屏幕上有什么"——视角、布局、
  模态框都是用户的，适合确认"我有没有把界面搞乱"。
- **渲染**（`render`）看的是"模型本身长什么样"——相机、分辨率、采样都由你定，适合
  迭代几何/材质/灯光。

两者都走"落盘 → `fs read` 那张 PNG"进视觉通道（host 端图片 read 转 image_data）：
base64 只有程序调用方用得上，agent 看不见画面。

迭代闭环：`render` 出小图（`--res 1280x720 --samples 24`）→ `fs read` → 改参数 →
再渲，比盲调快一个数量级。`render` 可临时改引擎/分辨率/采样/机位/裁剪面，渲完
**一律还原**用户的设置（含相机位置与裁剪面），所以它不会污染用户的工程状态。

## 坑（实测）

1. **相机裁剪面**：默认 `clip_start/clip_end = 0.1/100 m`。km 级大场景（海面/天穹）
   会被裁出硬边，但**别盲目放大**——裁剪距离越大深度精度越差，小模型反而出
   z-fighting。`render` 默认按场景尺度自适应、**只扩不缩**（小模型保持默认）；
   要精确控制就手填 `clip:{"start":..,"end":..}`（填了以它为准，填小了整块几何会被裁没）。
2. **`ColorRamp.elements` 按 `position` 排序存储**（5.2.1 实测：反序插入也会按位置
   重排）——所以**不要按"插入序"设 `color`**。正确姿势：先 `new()` 出全部色标，
   再按 `position` 回查元素设色。
3. **取 world 节点别写死名字**：不同来源的 world 可能没有 `Background` 节点（甚至
   `node_tree` 为 None）。用 `next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")`
   找，找不到就显式报错——静默失败的表现是"画面变默认灰"。（默认世界里名字通常
   就是 `Background`，5.2.1 实测可用。）
4. **EEVEE 的屏幕空间反射/折射不看 `visible_glossy/visible_diffuse`**（实战结论：
   水下船体被反射到水面，整条船像悬空）——不想进画面的东西只能"干脆不生成"。
5. **Base Color 是线性值**：把 sRGB 观感数字直接填进去整体发白，要按 sRGB→线性换算。
6. **`bpy.ops.wm.read_factory_settings(use_empty=True)` 会连渲染设置一起重置**
   （加载的是 factory startup）——清场景建议按 datablock 删
   （`bpy.data.objects.remove(obj, do_unlink=True)`）。
7. **批量渲染会占死主线程**：拆成每批 2–4 张、单批压在几分钟内，否则后续工具调用
   撞 `main-thread-busy`。
8. **`execute_code` 跑在用户当前的 Blender 会话里**：清场景、`save_as_mainfile`
   都会动用户正在编辑的文件。动手前先看 `blender ping` 的 `file` 字段（或
   `get_scene_info`），必要时先另存。
9. **5.x 的 `use_nodes` DeprecationWarning 忽略即可**，不是错误。
10. **引号**：`--input` 的 JSON 内统一用 `\"`；长代码一律走脚本文件（见上）。

## 排错

| 现象 | 含义 | 处置 |
|---|---|---|
| `blender_not_installed` | 找不到 Blender 可执行文件 | 按文案安装，或 `AIC_BLENDER_EXE` 指定 |
| `blender_not_running` | 9866 不通 | `blender launch`，或人工启动 Blender 后用 `blender install` + 启用 addon |
| `addon_not_connected` | 端口通但握手失败 | addon 版本不匹配——`blender launch` 重挂（pod 升级后） |
| `main-thread-busy` | 主线程被渲染/模态占住；**这次调用已被丢弃、不会补执行** | 先验产物：看输出文件的 mtime 或 `get_scene_info`——你看到的变化来自前一个仍在跑的调用；确认没跑再重发 |
| `blender launch` 等不到端口 | addon 没在 60s 内握手 | 读回执里的 statusFile 结论；稍后再跑 `blender doctor` 复查（首次启动/冷缓存更慢） |
| 渲染出来一片纯色/灰 | clip 裁没了 / world 没接上 / 引擎设置被重置 | 看 `render` 回执里的 `clip` 与 `engine`；world 节点按 type 取 |

## 重活走无头

长渲染/批量几何不占 GUI 通道：`exec` 原生跑（沙箱生效）——

```sh
blender -b --factory-startup --python script.py    # 需 grant cmd blender
```

| | GUI addon（`execute_code` / `render`） | 无头 `blender -b --python` |
|---|---|---|
| 审批 | 免（`mcp.blender` 规则） | 需 `grant cmd blender` |
| 适合 | 迭代调试、改用户现有工程、要让用户看见 GUI | 长批渲染、批量导出、CI、不打扰用户 GUI |
| 代价 | 阻塞主线程（排队 >10s 即 busy）、占着用户 GUI | 另起进程、看不到 GUI |

超 5 分钟的任务照常由 exec 超时转后台（`bg wait/kill`）回收结果。

## 协议

addon 说 vtools/tcp v1（行分隔 JSON，≤16 MiB）：`tools` 回目录（含 inputSchema），
`call` 回 `result` / `isError` / `error`。主线程经 `bpy.app.timers` 队列泵执行；
排队 10s 未被取走报 `main-thread-busy`（该任务随之丢弃，不补执行）。端口可用
`AIC_BLENDER_PORT` 覆盖（pod 与 addon 同读）。协议自测：`python3 cli/selftest.py`
（stub bpy，不需要真 Blender）。
