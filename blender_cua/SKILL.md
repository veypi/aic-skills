---
name: blender_cua
nickname: Blender 键鼠自动化
description: 用 cua 驱动 Blender 做 GUI 自动化的操作手册（macOS 中文界面）：键鼠投递规则、Add 菜单搜索框建对象、光标坐标标定、右侧控制台通道、渲染与保存、已知坑与规避
keywords: [blender, cua, gui自动化, 键鼠操作, 3d建模, macos, 自动化]
icon: fa-solid fa-cube
---

# Blender 键鼠自动化（cua）操作手册

环境：macOS + Blender 5.2.1 LTS（**中文界面**）+ aic-pod cua（desktop 壳 → cua-driver MCP 持久子进程）。
本手册结论以 2026-09-09 第四次复验为准（纯键鼠建成 12 部件模型 + 相机灯光 + EEVEE 渲染）。坐标基于窗口 1728×1084@0,33、截图 1568×984（Retina 2x）。

## 0. 铁律速查

1. **带修饰键一律 foreground**：`shift+a`、`shift+d`、`cmd+s`、`ctrl+v`、`cmd+z`… 全部带 `{delivery:'foreground'}`；裸键（`a/x/g/s/r/数字/enter/esc/tab/方向键`）background 可用。
2. **键盘按「指针缓存所在区域」路由**：每个操作序列前先前台 click 目标区域（点击更新缓存）；刚激活应用/刚关启动画面后的第一次 click 可能被吞——**连点两次**更稳。
3. **中文界面粘贴必须 `ctrl+v`**（`cmd+v` 无效！）；搜索词必须用界面翻译：Sun=**日光**、Point=点光、Cylinder=柱体、UV Sphere=经纬球、Cone=锥体、Camera=摄像机。
4. **多窗口歧义**：渲染窗口 / 文件浏览器等第二个顶层窗口在屏时，background 键盘被拒（`same_pid_keyboard_ambiguity`）→ 改用 foreground 投递，或先用 AX token 关窗。
5. **控制台一律开在右侧面板**（用户约定，2026-09-09）：指针移到右侧面板再按 shift+f4，不顶掉主视口（见 §3）。

## 1. 添加对象：Add 菜单搜索框（★ 推荐，取代子菜单点击）

```js
await cua.click(600,123,{delivery:'foreground'});    // 1. 重置指针缓存（落在「搜索…」行）
await cua.sleep(700);
await cua.hotkey('shift+a',{delivery:'foreground'}); // 2. 打开 Add 菜单
await cua.sleep(1000);
await cua.click(600,123,{delivery:'foreground'});    // 3. 命中「搜索…」→ 搜索框打开
await cua.sleep(1000);
await cua.clipboardWrite('立方体');                   // 4. 中文名 = 界面翻译
await cua.hotkey('ctrl+v',{delivery:'foreground'});   //    ★ ctrl+v，不是 cmd+v
await cua.sleep(900);
await cua.key('enter');                               // 5. 添加第一项
```

- 已验证中文名：`立方体` `柱体` `经纬球` `锥体` `圆环` `摄像机` `日光`（搜「太阳」返回「未找到结果」）
- 子菜单点击方案（旧）：主菜单项只能命中「高亮项」（= 指针缓存位置所在项），子菜单项按事件坐标正常命中；坐标随指针缓存漂移，不推荐

## 2. 变换与复制

- 变换：`s/g/r` + 轴 + 数值 + `enter`（裸键 background 可用）
- 负号：`key('-')` + `type('0.85')`（`type('-0.85')` 会丢负号）
- 复制对称件：`shift+d`(foreground) + `x` + 值 + `enter`（副本跟随鼠标，直接输轴+数值即移动副本）
- 批量脚本内键序连发即可（每键约 1.1s，无需额外 sleep）

## 3. 控制台通道（右侧开启，用户约定）

```js
await cua.click(1350,600,{delivery:'foreground'});    // 指针移到右侧面板（连点两次）
await cua.sleep(500);
await cua.click(1350,600,{delivery:'foreground'});
await cua.sleep(700);
await cua.hotkey('shift+f4',{delivery:'foreground'}); // 右侧面板变控制台，3D 视口完好
// 输入行点击约 (1180,925)：ctrl+a → backspace → ctrl+v → enter
```

- 恢复属性面板：控制台执行 `bpy.context.area.type='PROPERTIES'`（或点区域左上角「编辑器类型」菜单）
- 控制台占视口时输入行约 (100,890)；(400,925) 会落到时间轴（改帧）
- 控制台是多行模式：`for` / `if` 结尾需再按一次 enter（空行）才执行
- 输入行残留污染：粘贴前 `ctrl+a` + `backspace` 清空（否则旧命令文本会拼进来）
- `shift+f4` 不是开关：已是控制台时再按无效
- 独立窗口方案会触发 cua 多窗口键盘歧义；并存方案=右键区域边缘做水平分割

## 4. 渲染与保存

- 渲染：`F12`（无需 fn）；渲染结果是独立 window_id 的「Blender 渲染」窗口
- 保存工程：控制台 `bpy.ops.wm.save_as_mainfile(filepath='/abs/x.blend')`（无对话框，直接覆盖）
- 保存渲染图：控制台 `bpy.context.scene.render.filepath='/abs/x.png'; bpy.ops.render.render(write_still=True)`
- **相机对准原点**：位置 (6,-6,5)、旋转 (68°,0,45°)——用 **N 面板输入绝对值**，不要用 `R X 63`+`R Z 45`（实测得到 (101.94,-54.59,90.79)，渲染全空）
- **灯光**：日光强度默认 1.0 太暗（EEVEE 渲出剪影）→ 设 5.0；旋转与相机同向 (68°,0,45°) 即正打光
- 渲染引擎：`BLENDER_EEVEE_NEXT → BLENDER_EEVEE → CYCLES` try 链；Blender 5.2 实际生效 `BLENDER_EEVEE`

## 5. 光标坐标（两种空间，勿混用）

| 路由 | 触发方式 | 坐标空间 |
| --- | --- | --- |
| 窗口本地指针（虚拟） | `cua.click([x,y])` 默认 | **窗口截图坐标**（主窗口 1568×984 基准） |
| 物理光标 | `cua.move/click(..., {scope:'desktop'})` | **桌面物理像素**（NS 逻辑 ×2） |

- mbp 换算：**物理 X = 截图 x × 2.204；物理 Y = 截图 y × 2.203 + 66**
- 物理 move（CGWarp）不产生 mouseMoved 事件 → 悬停高亮/tooltip 不更新，「move 悬停→截图核对」对菜单无效
- 换设备必做两点标定（见旧笔记 §11）：窗口 bounds + 截图比例 + 两物理点解 scale/offset

## 6. 子窗口（文件浏览器 / 渲染窗口）

- 这类窗口的**像素坐标不可靠**：get_window_state 截图坐标与窗口 bounds 不成线性对应，窗口本地指针点击会偏到列表/主窗口（实测偏 ~100 截图px），`scope:desktop` 同样偏
- 关闭它们：用 snapshot 返回的 `element_token` 直接 click（AXPress 零偏差）
- 文件浏览器内键盘输入不可靠（焦点问题）→ **保存一律走控制台**，不要走文件浏览器

## 7. 已知坑清单

| 坑 | 表现 | 规避 |
| --- | --- | --- |
| Python API 节点名本地化 | `nodes.get("Principled BSDF")` 返回 None | 按类型找：`next(n for n in nodes if n.type=='BSDF_PRINCIPLED')`；World 用 `type=='BACKGROUND'` |
| `a` 键第二次不取消选择 | 全选后再按 a 无效（前后台均如此） | 控制台 `bpy.ops.object.select_all(action='DESELECT')` 或点大纲空白 |
| `cua run` 无 `require` | `require is not defined` | 脚本内不要 require |
| `cua run` 超时 | ~150s+ 时 exec 返回 `context deadline exceeded`，但脚本仍在 host 跑完 | 查 `.cua/run-*.jsonl` 尾部确认；单脚本控制 ~120s 内或拆批 |
| 批量脚本污染 | 某步 add 未命中 → 后续 s/g/r 作用在上一选中对象（曾把躯干改形） | 批量后核对 `print([o.name for o in bpy.data.objects])`，按名删改重建 |
| `R` 旋转不可预测 | `R X 63`+`R Z 45` ≠ (63,0,45) | 用 N 面板输入绝对值 |
| 控制台输入行污染 | 残留文本拼进新命令 | 粘贴前 ctrl+a + backspace |
| `type` 丢负号 | `-0.42` → `0.42` | `key('-')` + `type('0.42')` |
| numpad 键名不认 | `numpad1` Unknown key name | 用菜单或 N 面板替代 |
| 小对象像素点击落空 | 肩球/大纲行约 20px | 用大纲行点击或 N 面板；必要时先放大视口 |
| F3 搜索英文无结果 | 中文界面搜 "object mode"/"array" 无命中 | 用中文关键词或 Add 菜单搜索框 |
| 自发光过曝 | Emission Strength 12 发白 | 降到 4 |
| `view3d.view_all` 报错 | 控制台上下文缺区域 | `space.region_3d.view_perspective='CAMERA'` 或 temp_override |
| 新建文件确认框 | Cmd+N 后弹保存询问 | 先保存或用脚本清场 |

## 8. 实战案例：12 部件机甲机器人（2026-09-09）

- 流程：清场（`a`+`x`+`enter`）→ 躯干（立方体 s x0.6 / y0.4 / z0.9、g z1.6）→ 头（立方体 s0.28、g z2.8）→ 天线（锥体 s0.06、s z4、g z3.32）→ 双肩（经纬球 s0.22、g x∓0.85、g z2.2）→ 双臂（柱体 s0.09、s z3.9、r y90、g x∓1.4、g z2.2）→ 双腿（柱体 s0.12、s z2.9、g x∓0.3、g z0.42）→ 双脚（立方体 s0.18/y1.67/z0.39、g x∓0.3、g y-0.15、g z0.07）→ 核心（经纬球 s0.12、g y-0.45、g z2.0）
- 对称件用 `shift+d` + `x` 偏移复制；每部件 5 步菜单 + 7~19 键变换
- 相机 (6,-6,5) 旋转 (68,0,45)、日光强度 5.0 → F12 渲染
- 产出：`/Users/veypi/ivec/temps/gui_robot.blend`、`gui_robot_render.png`
- 完整复验历史（含被推翻的旧结论、坐标标定过程）：见会话笔记 `blender_cua_notes.md`

## 9. 参考资产

- 脚本式建模参考：`/Users/veypi/ivec/temps/mech_robot.py`（55 部件机甲，材质+灯光+渲染）
- 官方契约源：`aic/docs/skill.md`（skill 机制）、`vhtml` skill（页面写法）
