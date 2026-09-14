# 配色预设（Style Presets）

出图时选一套预设，把语义角色映射到颜色，全图保持一致。预设完整定义（palette /
roles / shapes / edges / font）在同目录 `presets/<name>.json`，可直接 fs 读取。
未指定时用 `default`（即 `xml-authoring.md` 中的颜色表）。

## 怎么应用

1. 为每个形状确定**语义角色**：service / database / queue / gateway / error / external / security
2. 按该角色的 `fillColor` / `strokeColor` 写进 `style=`
3. 边颜色统一（通常 `strokeColor` 深灰/对应主题）；文本色遵循预设的 `fontColor`
4. 角色 ≥3 种时加图例（见 `xml-authoring.md` Legend 段）

## default（默认，浅色）

| 角色 | fill | stroke |
| --- | --- | --- |
| service | `#dae8fc` | `#6c8ebf` |
| database | `#d5e8d4` | `#82b366` |
| queue | `#fff2cc` | `#d6b656` |
| gateway | `#ffe6cc` | `#d79b00` |
| error | `#f8cecc` | `#b85450` |
| external | `#f5f5f5` | `#666666` |
| security | `#e1d5e7` | `#9673a6` |

字体 Helvetica 12（标题 14 加粗）；边 `orthogonalEdgeStyle`；strokeWidth 1。

## dark（深色背景）

适用：深色底图（背景 `#1e1e1e`，字色 `#f0f0f0`，边色 `#bbbbbb`）。fill 用深色、stroke 用亮色：

| 角色 | fill | stroke |
| --- | --- | --- |
| service | `#004870` | `#33b6ff` |
| database | `#007052` | `#33ffc7` |
| queue | `#5a4916` | `#d7b85b` |
| gateway | `#705100` | `#ffc633` |
| error | `#502220` | `#c4716e` |
| external | `#383838` | `#999999` |
| security | `#3d2c45` | `#a182b0` |

注意：绘图台画布是浅色网格，dark 预设用于"交付深色效果"的图（或自行导出后使用）；
在画布内仍按深色填充渲染。

## corporate（企业风）

浅底高对比、直角（`rounded=0`）、Arial 11：

| 角色 | fill | stroke |
| --- | --- | --- |
| service | `#e3f2fd` | `#1565c0` |
| database | `#e8f5e9` | `#2e7d32` |
| queue | `#fff9c4` | `#f57c00` |
| gateway | `#fff3e0` | `#e65100` |
| error | `#ffebee` | `#c62828` |
| external | `#eceff1` | `#455a64` |
| security | `#f3e5f5` | `#6a1b9a` |

## colorblind-safe（色盲友好，Okabe-Ito 系）

strokeWidth 2，蓝色系为主，避免红绿对比歧义：

| 角色 | fill | stroke |
| --- | --- | --- |
| service | `#ccedff` | `#0072b2` |
| database | `#ccfff1` | `#009e73` |
| queue | `#fff8cc` | `#8f7c00` |
| gateway | `#ffefcc` | `#e69f00` |
| error | `#ffe3cc` | `#d55e00` |
| external | `#e6e6e6` | `#555555` |
| security | `#f1dae7` | `#cc79a7` |

## handdrawn（暖色素描）

暖色系、边 `curved=1`（弧线）。注意 `sketch=1` 的"手绘抖动"在本绘图台不生效，
仅颜色/线型生效：

| 角色 | fill | stroke |
| --- | --- | --- |
| service | `#ffe4b5` | `#b8651e` |
| database | `#def0dc` | `#5c8a49` |
| queue | `#fff4cc` | `#b8901a` |
| gateway | `#ffd9b3` | `#c25100` |
| error | `#ffcdbf` | `#a53d3d` |
| external | `#f5e6d3` | `#8b7355` |
| security | `#e6d7e8` | `#7b4397` |
