# AIC-SKILL

AIC（[ivec.ai](https://ivec.ai)）平台的公开技能仓库。每个目录是一个可直接加载的技能（skill）：`SKILL.md` 描述规则与用法，`ui/` 提供页面组件，`api/` 提供数据接口，`tables/` 定义数据表。

## 公开技能

| 技能 | 名称 | 简介 |
| --- | --- | --- |
| [3d_maker](3d_maker/) | 3D Maker | 浏览器内专业 3D 模型设计：参数化 CAD 建模、多部件装配、打印就绪检测与 STL/OBJ/GLB/3MF 导出（内置 JS 内核 / OCCT 高性能内核） |
| [blender_cua](blender_cua/) | Blender 键鼠自动化 | 用 cua 驱动 Blender 做 GUI 自动化的操作手册（macOS 中文界面）：键鼠投递规则、菜单搜索建对象、光标标定、渲染与保存、已知坑与规避 |
| [code_review](code_review/) | 代码评审 | 通用代码评审方法论：摸清范围、精读变更、分维检查、输出带分级的评审报告 |
| [create_skill](create_skill/) | 创建 Skill 指南 | 从零创建平台动态 skill 的完整指南：分级决策 → SKILL.md 契约 → ui 页面与 pageDesc 指令 → tables/api 数据面 → 发布审核 |
| [git_commit](git_commit/) | 代码提交 | 标准 git 提交流程：盘点变更、验证检查、拆分逻辑批次、生成规范提交消息 |
| [intelligence_analysis](intelligence_analysis/) | 商业航天情报分析 | ORBITALINTEL：全产业链公司/产品/发射/融资数据库、事故案例库、监管知识库、AI 合规审查、三维地球情报舱 |
| [office_studio](office_studio/) | Office 工作台 | Excel/xlsx 表格编辑：打开、读写、保存工作簿；AI 与用户共用同一编辑器（Univer 引擎，Word/PPT 后续接入） |
| [play_with_ai](play_with_ai/) | 与 AI 对弈 | 与 AI 下棋的游乐场（当前内置五子棋）：指令绑定阵营、按回合行棋、棋盘变化自动推送 |
| [ppt_studio](ppt_studio/) | PPT 工坊 | 幻灯片工作室：以本地 /ppt/ JSON 文件驱动创建、编辑、预览与全屏演示，支持逐页语音讲解脚本 |
| [verisim](verisim/) | VeriSim · 数字电路仿真综合 | 浏览器内真实运行 Icarus Verilog 仿真与 Yosys 综合：波形 / 原理图 / 网表 / 面积报告，12+ FPGA 工艺 + ASIC Liberty |
| [video_studio](video_studio/) | 视频工坊 | 浏览器内一站式视频制作：AI 文件驱动编辑 + 可视化舞台/时间轴、真实 3D 场景、关键帧动画、素材拖拽剪辑、AI 配音、WebCodecs 导出 MP4 |
| [vhtml](vhtml/) | vhtml 框架手册 | browser-only HTML 组件框架使用手册：组件、script setup、bindings、路由、i18n、ESM import 与模块作用域概念 |
| [well-console](well-console/) | Well 微件操控台 | IDEAS 平台 Well 微件操控台：iframe 嵌入 + postMessage 指令下发 + 外部 AI 经 pageDesc 操控 |
| [well_talk](well_talk/) | 井言 · 三维井场分析 | Well3D 三维井场可视化与分析：合成演示井与构造面场景，外部 AI 查询井数据统计并联动 3D 视图 |

## 结构约定

每个技能目录遵循平台技能规范：

- `SKILL.md` —— 技能主文档（front-matter：`name` / `nickname` / `description` / `keywords` / `icon`）
- `ui/` —— 页面组件（vhtml；可含 `vendor/` 等静态资源）
- `api/` —— sqlx 数据接口（可选）
- `tables/` —— 数据表定义（可选）

## 资源加速（jsDelivr）

仓库内的大体积静态资源（如 `office_studio/ui/vendor/` 下的引擎包）随仓库发布，可通过 jsDelivr 直接引用，不占业务服务器带宽：

```
https://cdn.jsdelivr.net/gh/veypi/aic-skills@main/<技能目录>/<路径>
```

示例：

```
https://cdn.jsdelivr.net/gh/veypi/aic-skills@main/office_studio/ui/vendor/univer-excel.bundle.js
```

> 注意：jsDelivr 对单文件有大小上限（约 20 MB）；@main 分支存在 CDN 缓存（约 12 小时），需要即时生效时可使用提交号或 tag 引用。

## 许可

见 [LICENSE](LICENSE)。
