---
name: well_talk
nickname: 井言 · 三维井场分析
description: Well3D 三维井场可视化与分析：12+2 口合成演示井 + 构造面三维场景，外部 AI 经 pageDesc 查询井数据统计并联动 3D 视图（选中/深度定位）
keywords: [well, 3d, 井场, 轨迹, 套管, 完井, 地层, 射孔, 防碰, 三维可视化]
icon: fa-solid fa-cube
ui:
  - path: index.html
    desc: Well3D 三维井场分析页面（3D 场景 + 井位图 + 数据查询/视图联动指令）
---

# 井言 · 三维井场分析

Well3D 三维井场分析页面：左侧 Well Map 井位图 + 3D 井场（井轨迹 + 构造面 +
可选的套管/完井/地层/射孔等图层），顶部图层开关。**AI 不内嵌**——操控面 = 页面
setup 块声明的 `pageDesc` 指令集，由平台 OS/page 通道自动采集；页面数据为
boot 时生成的合成演示数据（井 `F-01`…`F-12` + 侧钻井 `F-03 T2`、`F-07 T2`，
构造面 `hugin-base`，深度单位米 MD Msl，坐标 Easting/Northing/TVD Msl）。

## 外部 AI 操作方式

1. **打开页面**：`open {url_prefix}/index.html`（`url_prefix` = skill 列表返回的包前缀，形如 `/skills/{skill_id}`；随部署/平台可变，**勿硬编码**）
   （用户亦可从 agent 详情「关联技能」点击开窗）。
2. **查看 page 事件**：`exec 1host=page commands` 或 `list` 实时探测——窗口事件为
   `{win_id}.well_*` / `{win_id}.surface_*` 命名空间，指令清单以 pageDesc 声明为准，不要凭记忆调用。
3. **调用指令**：`exec 1host=page {win_id}.well_list`，argv 传参（`--key val`，字符串数组）。
4. 页面未打开时指令无响应：先 `open`，`list` 确认窗口与事件后再调用；
   首开建议先 `{win_id}.well_status` 确认 `ready: true`（三维引擎为异步加载）。

## pageDesc 指令表

### 数据查询

| 指令 | argv | 返回内容 | 典型用途 |
|---|---|---|---|
| `well_status` | 无 | `{ready, selectedId, wellCount, wellIds, surfaceIds, layers}` | 场景就绪探测、当前选中井、图层开关状态 |
| `well_list` | 无 | 全部井 `[{id, status, tdMsl, parent}]` | 开场导览、确认有效井 ID |
| `well_info` | `--id` | 井头完整信息（状态/总深/造斜点/井口坐标/补心海拔/父井） | 井基本信息卡片 |
| `well_trajectory_stats` | `--id` | `{wellType, tdMsl, tvdAtTd, kopMd, maxInclDeg, maxInclMd, avgDoglegPer30m, maxDoglegPer30m, maxDoglegMd, horizontalSectionLen, totalDisplacement, displacementAzimuth, stationCount}` | 井型判断、轨迹形态/狗腿度解读（高频） |
| `well_casings` | `--id` | 套管清单 `[{mdTopMsl, mdBottomMsl, outerDiameter, innerDiameter, type, isShoe, properties}]` | 套管程序表格 |
| `well_completion` | `--id` | 完井工具 `[{name, category, mdTopMsl, mdBottomMsl, length, diameterMax, ...}]` | 完井方式归纳、工具定位 |
| `well_perforations` | `--id` | 射孔段 `[{mdTopMsl, mdBottomMsl, status, density, phase}]` | 射孔层段清单 |
| `well_formations` | `--id` | 地层分层 `[{name, color, level, mdTopMsl, mdBottomMsl}]` | 穿层史、层位归属 |
| `well_at_depth` | `--id --md` | 该深度联合定位：`{position, casingsHere, toolsHere, toolsBelowWithin100m, formation, perforationsHere}` | 「X 米有什么」反向查询（高频，所有深度必过此接口） |
| `well_formation_at` | `--id --md` | 该深度所在地层 `{name, mdTopMsl, mdBottomMsl}` | 单一层位查询 |
| `well_distance` | `--id-a --md-a --id-b --md-b` | 两井指定深度点空间距离与坐标 | 点对点距离 |
| `well_closest_approach` | `--id-a --id-b [--step]` | 两井最近距离 `{distance, mdA, mdB, note}`（默认步长 50m） | 邻井防碰初判（演示级算法） |
| `surface_list` | 无 | 构造面 `[{id, name, minDepth, maxDepth, nx, ny, projection}]` | 构造背景 |
| `well_qc` | `--id` | 数据体检 `{issueCount, issues:[{type, md?, severity, detail}]}` | 数据质量问题清单 |

### 视图联动（驱动 3D 场景）

| 指令 | argv | 效果 |
|---|---|---|
| `well_select` | `--id` | 3D 与井位图中选中该井（金色高亮）并相机聚焦 |
| `well_locate` | `--id --md` | 红色探针定位到该深度点并聚焦相机，同时选中该井 |
| `well_selected` | 无 | 返回用户当前在图中选中的井 ID `{id}` |

## 事件契约（page 通道）

- 调用：`exec 1host=page {win_id}.{指令名}`，argv 为字符串数组，参数风格 `--key value`
  （如 `["--id", "F-03", "--md", "2840"]`；侧钻井 ID 含空格，原样传 `"F-03 T2"`）。
- 返回统一 `{content: "<JSON 字符串>"}`，JSON 反序列化后为
  `{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": "原因" }`。
- 视图联动指令（`well_select`/`well_locate`）返回前已完成场景变更；`well_locate`
  同时返回该深度绝对坐标 `{position: {easting, northing, tvdMsl}}`。
- 参数缺失/井 ID 不存在/深度超界均返回 `ok: false` + 中文错误原因，可原样转述给用户。

## 工作规则

1. **先取数，再回答**：涉及任何井的数值、结构、层位信息，必须先调用对应指令获取，禁止凭印象编造数值。井 ID 不确定时先 `well_list`。
2. **摘要优先**：原始轨迹点串、构造面网格已由页面聚合为统计值，你只消费摘要；引用数值以指令返回为准。
3. **判定靠代码，解读靠你**：狗腿度是否超标、数据是否异常等布尔结论以 `well_trajectory_stats` / `well_qc` 返回值为准；你的价值在于把统计值翻译成工程语言（对照行业经验区间说明含义）。
4. **深度必落图**：回答中出现具体深度时，调用 `well_at_depth` 说明该处的套管/工具/地层归属，并用 `well_locate` 在 3D 中定位，让用户"看"到答案。
5. **主动联动视图**：讲解某口井时调用 `well_select` 高亮聚焦，使讲解与画面同步。
6. **对比类问题**：对每口井分别取数后用 markdown 表格对比，并总结差异点。
7. **边界声明**：`well_closest_approach` 是采样近似，防碰结论必须声明精度边界；当前数据为合成演示数据，用户问到真实性时应说明；界面中套管径向尺寸有约 15 倍视觉夸张，分析以数据字段为准。
8. 用中文回答，术语规范（MD/TVD/KOP/狗腿度/造斜率等）；清单类信息用 markdown 表格；回答末尾可附 1-2 个推荐追问。
