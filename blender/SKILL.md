---
name: blender
version: 0.3.7
description: 通过现成 Blender MCP 服务查看场景、渲染和执行 Python；含可脚本化的安装连接流程、Windows 沙箱坑位与分层排查。
keywords: [blender, 3d, bpy, 建模, 渲染]
---

# Blender

本包直接接入现成 **Blender MCP**（https://github.com/ahujasid/blender-mcp，上游已更名
**mcp-for-blender**，`blender-mcp` 现为兼容包装，行为不变）。pod 只按统一 commands 机制启动
`uvx blender-mcp`，工具名、参数、结果与错误均由上游 MCP 服务提供；本仓不维护自研 addon、
TCP Provider 或协议桥接。

链路两段，排查时先分清是哪一段：

```
pod (blender 命令) ←stdio→ uvx blender-mcp ←TCP:9876→ Blender GUI 内的 addon
```

## 安装与连接（可全程脚本化，无需人工点 GUI）

先做只读预检，缺什么补什么：Blender 4.x/5.x GUI 是否安装、`uvx` 是否在 PATH、
addon 是否已装、9876 是否已监听、`commands list` 是否已注册 blender。

1. **装 uv**：已有 Python 时 `pip install uv` 最省事。uv 只服务于 MCP 服务端
   （`uvx blender-mcp` 首次拉包及其 mcp SDK 依赖）；**addon.py 本身零第三方依赖**
   （只用 bpy + 标准库 + Blender 4.2+ 自带的 requests），不需要 uv。
2. **装 addon**：下载上游仓库的 `addon.py` 单文件，放入 Blender 用户插件目录
   （Windows: `%APPDATA%\Blender Foundation\Blender\<ver>\scripts\addons\`，
   macOS: `~/Library/Application Support/Blender/<ver>/scripts/addons/`）。
3. **启动 Blender 并自动连接**：写一个启动脚本，用 `blender --python <脚本>` 拉起 GUI：

```python
import bpy, addon_utils
addon_utils.enable("<addon模块名>", default_set=True, persistent=True)
bpy.ops.wm.save_userpref()

def _start_mcp():
    try:
        bpy.context.scene.blendermcp_auto_start_server = True
        bpy.ops.blendermcp.start_server()
    except Exception as e:
        print("BlenderMCP start failed:", e)
    return None

bpy.app.timers.register(_start_mcp, first_interval=2.0)
```

   `blendermcp_auto_start_server` 是 scene 属性，开启后 load_post 会自动续接服务。
4. **注册命令并预热缓存**：

```sh
commands install blender
uvx blender-mcp --help        # 首次拉包；需要网络与代理时先内联 export HTTPS_PROXY/HTTP_PROXY
```

5. **关沙箱**：预热后沙箱内启动仍会失败（uv 缓存锁/写权限），这是预期路径，直接申请：

```sh
# 提权项：平台会话需 owner 批准——用 exec nosandbox=true 重发本命令触发审批，批准后生效
commands config blender --no-sandbox
```

`AIC_BLENDER_EXE`、`AIC_BLENDER_TOKEN` 等旧桥接配置已删除，不再使用。

## Windows 沙箱坑位（2026-11-08 win 实测）

- **系统 curl.exe 在沙箱内 HTTPS 必挂**：schannel 报
  `(35) AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`——受限 token 拿不到
  TLS 凭证，与代理无关。下载改用白名单内的 `python` + urllib（自带 OpenSSL）：
  `urllib.request.build_opener(ProxyHandler({'https': 'http://127.0.0.1:7897'}))`；
  或 nosandbox 提权后用系统 curl（实测 200）。
- **带空格路径的可执行文件**（如 `C:\Program Files\Git\...`）曾被 exec 身份闸以
  `not in allowlist` 结构性拒绝（aic-pod 2026-11-08 已修：open 模式跳过身份合法性闸）；
  旧版本 pod 上遇到就换 python 下载，不要纠结白名单。
- **pip 装到用户目录被拒**（`WinError 5 拒绝访问 AppData\Roaming\Python`）：
  用 exec nosandbox=true 提权重发，触发 owner 审批。
- **vsh 内建 cp 处理 `C:/...` 路径会报语法错**：跨目录拷贝用 `cmd /c copy /y`；
  `2>nul` 重定向会被 vsh 解析成路径错误，不要写。
- **`cmd /c start "" blender.exe ...` 报 `WaitDelay expired`**：子进程占着 I/O 管道
  导致，进程实际已拉起，不是失败；用 `netstat -ano | findstr :9876` 验证。
- 代理一律内联写死 `export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897`
  （exec 通道 source 配置文件不展开变量）；pip 用 `--proxy` 参数。

## 调用

```sh
blender                              # 实际上游工具目录
blender get_addon_status --json      # 开工前查一次：版本匹配、素材库/生成器开关、telemetry 状态
blender get_scene_info --json
blender execute_blender_code --code "import bpy; print(len(bpy.data.objects))" --json
blender look --json                  # 视口/相机/多角度截图，检查建模结果
blender <tool> --help                # 任一工具的实时参数表
```

调用门是命令别名本身（拒绝时按提示 `grant cmd blender`）。标量参数映射为同名 flag；复杂
对象走 `--input JSON` 或 `--input -`。工具面以 `blender`、`blender <tool> --help` 以及
`commands info blender --schema` 的实时上游 schema 为准。工具失败按 MCP `isError` 返回
非零退出，不自动重放有副作用的动作。

上游约定与注意：

- `execute_blender_code` 等工具的 `user_prompt` 参数要求**逐字引用用户原话**，多步任务
  每次调用都传同一句，不要 paraphrase 成自己的子目标。
- `generate_3d`（文本/图生 3D）**可能扣费或消耗生成额度**，调用前必须先征得用户同意；
  重复需求用复制已生成对象，不要重复生成。
- 上游默认开启 telemetry（收集 prompt/代码/截图/场景）；`disable_telemetry` 只能关不能开，
  用户要求停止收集时调用。
- 建模走 `execute_blender_code` 小步执行、每步 print 关键事实，用 `look` 目检；
  素材可用 `search_assets`/`import_asset`（polyhaven CC0 等）。

## 文件与脚本工作流

长脚本先写到设备已授权的位置，再经执行入口跑（如
`execute_blender_code --code "exec(open(r'<路径>', encoding='utf-8').read())"`）；
不要通过多层 shell 引号拼接大段 Python。需要 AI 新建文件时先授权目标目录：

```sh
grant fs <设备上的绝对工作目录>
```

渲染输出、视口截图和普通工作文件都应放在明确授权的工作目录。读取图片使用 fs 工具，不要把
大段 base64 当作长期文件格式。

## 故障排查（按链路分层）

- **addon 段**：`netstat` 查 9876 监听；再用裸 TCP 探针隔离 MCP 服务端嫌疑
  （python 一行：socket 连 127.0.0.1:9876 发 `{"type":"get_scene_info","params":{}}`）。
  探针通而 blender 命令不通 → 问题在 uvx/MCP 段；探针不通 → Blender 没起、addon 没启用
  或没点连接（用上面的启动脚本自动化）。
- **uvx/MCP 段**：`uvx` 不存在先装 uv 并确认 pod PATH；`connection closed ... EOF`
  多为沙箱拦缓存/网络——预热缓存后仍失败就上 `--no-sandbox`；首拉包检查代理。
- 工具或参数不同：以当前上游工具目录为准，不使用旧版自研桥接的 `doctor/launch/install`
  或 `AIC_BLENDER_*` 指引。

## 验收

- `commands list --json` 中 `blender` 为 MCP 命令。
- `blender` 能列出上游工具，`blender get_scene_info --json` 能读取真实场景。
- 一个失败的上游工具调用返回非零退出；GUI 重启后可在下一次调用时重新建立连接。