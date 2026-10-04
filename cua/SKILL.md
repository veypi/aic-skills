---
name: cua
version: 0.3.2
description: 设备原生桌面自动化（Computer Use）：窗口/应用枚举与激活、原生控件观察（无障碍树+截图）、点击/输入/拖拽/菜单/剪贴板操作。驱动本机 CuaDriver（macOS 辅助功能 API），供 AI 操作桌面应用。
ui:
  - path: index.html
    desc: CUA 状态与授权诊断（驱动状态 + macOS 辅助功能/屏幕录制授权指引）
---

# cua

设备原生桌面自动化。根命令 `cua`，全部操作走子命令；驱动 = 本机 CuaDriver（MCP over stdio + darwin daemon），设备级单会话——同设备所有调用共享同一份窗口绑定与快照令牌。

## 用法

```
cua <subcommand> [args] [--json]
```

输出契约：stdout 只放约定 JSON（`--json` 紧凑单行，默认缩进）；诊断写 stderr。非零退出不能当成功数据使用。

### 子命令

| 命令 | 说明 |
| --- | --- |
| `status` | 驱动状态（state=ready/stopped/unavailable + 驱动路径） |
| `app.list` / `app.open <app>` | 列出 / 打开应用 |
| `window.list [--app A] [--pid N]` | 列出窗口（返回 `window_id`） |
| `window.observe <window_id> [--query Q] [--depth N] [--image]` | 观察窗口：无障碍元素树（含 `ref`）+ 可选截图 |
| `window.activate <window_id>` | 激活窗口（不需审批，由 rules 决定） |
| `window.menu <window_id> --path a,b,c` | 触发菜单路径（≤16 段） |
| `window.bounds <window_id> --x N --y N --width N --height N` | 调整窗口位置尺寸 |
| `window.wait <window_id> [--text T \| --role R --name N --state S]` | 等待文本出现或语义 locator 状态 |
| `window.<click\|fill\|type\|press\|scroll\|set\|move> <window_id> <locator-flags> [选项]` | 窗口动作：`--text T` `--key K` `--value V` `--button left\|right\|middle` `--count 2` `--delivery background\|foreground` `--after none\|observation\|image` |
| `window.scroll <window_id> <locator-flags> --dx N --dy N [--after ...]` | 至少一个位移非零；右/下为正，左/上为负；40 逻辑像素约一行，每轴最多 20000 逻辑像素 |
| `window.drag <window_id> --snapshot S --from_at x,y --to_at x,y [--delivery ...]` | 基于截图坐标拖拽；delivery 是否可用由驱动平台决定 |
| `clipboard.read` / `clipboard.write <text>` | 剪贴板 |
| `cursor.state` / `cursor.set --enabled[=false]` | 光标状态/显隐 |
| `observation.image.read <window_id> <image_id> [--offset N] [--limit N]` | 分块读取观察截图（≤32KB/次，传输原语） |
| `observation.image.export <window_id> <image_id> <path>` | **截图整文件导出（推荐）**：写到设备文件，目标不存在才写，相对路径按调用方 cwd 解析 |

locator flags：`--ref R`（observe 返回的元素引用；窗口变化/新快照即失效）| `--role R --name N` | `--label L` | `--snapshot S --at x,y`（截图坐标）。

`--at x,y` 和 `--at=x,y` 均可。坐标原点为 `window.observe --image` 返回图片的左上角，单位为该图片的像素，以返回的 `image.width/height` 为界（`0 ≤ x < width`，`0 ≤ y < height`）。包装器可能缩放图片，并自动将操作坐标换算回驱动截图；不要再乘 Retina / `screenshot_scale` 或根据窗口逻辑尺寸换算。`--x/--y` 只用于 `window.bounds`，不是动作 locator；滚动位移使用 `--dx/--dy`，与 `--at` 指定的落点分开。

`fill/set` 要求可访问的无障碍元素，不支持纯坐标；自绘控件可用 `type --snapshot S --at x,y --text T`。`move` 只接受截图坐标，移动的是代理光标覆盖层，不合成应用 hover。

快照生命周期：动作调用后，旧 snapshot、ref 和 image 均失效，部分失败路径也会清除它们；新的 observe 会替换同一窗口旧快照。同设备所有调用共享状态，其他调用对该窗口的观察或动作也会使旧引用失效。下一次操作前重新 observe，或在动作上加 `--after observation` / `--after image` 获取后续快照；坐标操作需使用带图片的快照。`observation.image.read/export` 可重复读取，不会消费快照。遇到 `stale_ref` 应重新观察，不要重试旧引用。

实证契约：press 的 `--key` 修饰键用 `Meta/Control/Alt/Shift`（如 `Meta+q`；`cmd+q` 报 invalid key modifier），且 press 必须带 locator；click/press 后台投递返回 `effect=unverifiable` 属常态（不回读），效果靠 observe/截图核验。

### 典型流程

1. `cua status --json` 确认驱动 ready（unavailable = 未装/未授权，见下）。
2. `cua app.open Safari` → `cua window.list --app Safari` 拿 `window_id`。
3. `cua window.observe <window_id>` 拿元素 `ref`；`window.click/fill/type --ref ...` 操作。
4. 需要截图观察时 `window.observe --image` → `observation.image.export <window_id> <image_id> ./shot.png` 直接拿完整图片文件（不要用手拼分块的 image.read——那是传输原语）。

错误语义：`session_expired`（驱动会话断了，下一条命令自动恢复，需重新枚举绑定目标）；`stale_ref`（ref 属于旧快照，重新 observe）；`unavailable`（驱动缺失或未授权）。

### 授权（macOS）

CuaDriver 使用辅助功能（Accessibility）与屏幕录制（Screen Recording）权限，授权身份归 `com.trycua.driver`（签名/公证原样随桌面端发行）。首次操作被系统拒绝时：系统设置 → 隐私与安全性 → 辅助功能 / 屏幕录制 → 启用 CuaDriver；或命令行 `cua-driver doctor` 诊断、`cua-driver permissions grant` 引导授权。诊断 UI 见包页面（状态与授权指引）。

驱动探测链：`AIC_CUA_DRIVER_PATH`（显式覆盖）→ `AIC_CUA_BUNDLE_DIR`（桌面端内置发行物目录提示）→ PATH → 系统安装路径（`~/.local/bin`、`/Applications/CuaDriver.app`、`/usr/local/bin`、`/opt/homebrew/bin`）。
