# Office Studio 路线图（2026-09-12）

## 战略定位

目标：让 AI 与用户在**同一份真实 office 文件**上协作——不是"导入-编辑-导出"的沙盒编辑器，
而是**文件本体的直接工作台**（文件 = 一个 `/fs` 路径，零复制，改完写回原处）。

三个不做妥协的维度（相对 WPS / Office Online / 各类网页编辑器）：

1. **AI 原生操作面**：一切编辑能力暴露为窗口指令（结构化 JSON 进/出），AI 是"隐形的手"，
   与人共用同一个编辑器实例——AI 写一格，用户屏幕上立即变化。
2. **文件即路径**：cloud / page（浏览器 OPFS）/ host（本机磁盘）统一走平台 `$fs`，
   应用层不区分端；文件管理器双击即打开（filebinds 协议）。
3. **与平台深集成**：ask AI 联动（AI 读到的是用户正看的同一工作簿）、/fs 原生读写、
   会话产物直落用户云盘。

策略：**不求 100% 格式保真与全功能**（复杂图表/宏/分页排版是桌面 Office 的护城河），
聚焦"AI 能闭环的高频场景"：文档理解、批量修改、数据整理、演示稿生成。

## 阶段 0：Excel（xlsx）——已上线（2026-09-11）

- [x] 打开 / 编辑 / 保存闭环：Univer presets `0.25.1`（表格 UI + 公式 + 数字格式）
      + `@mertdeveci55/univer-import-export 0.2.1`（xlsx 序列化，exceljs 底座）
- [x] 平台打开协议：filebinds 登记 `xlsx,xls` → `/skills/local/office_studio/index`
- [x] 首页：最近打开列表（localStorage）+ 文件列表视图
- [x] AI 指令面：`open` / `status` / `read_range`（含公式）/ `cell_info` / `set_range` /
      `set_cell`（值或公式）/ `save`（写回或另存）——全部经真实平台验证
- [x] 引擎资源加速：bundle 16.19MB（gzip 3.67MB）经 jsDelivr（`gh/veypi/aic-skills`）分发，
      页面纯 CDN 引用（不占平台带宽；平台 vigo 已补 gzip 中间件作全局兜底）
- [x] 大文件读取：host 端 `$fs` 二进制直连整读（RTC 直连，≤64MB，hfs.js 2026-09-11 改造）

实现形态（2026-09-11 档案）：

- 构建：vite lib 模式（ES2020 目标；注意需显式 `define process.env.NODE_ENV`），
  产物 = 单 ESM `univer-excel.bundle.js` + 单 CSS
- 页面：vhtml 组件（`ui/index.html`）——首页/编辑器视图切换（`#app` 常驻不重建）、
  引擎懒启动 + 后台 prefetch、样式 fetch 后内联注入
- 资源更新流程：本地构建 → cp 到仓库 `ui/vendor/` → push → purge jsDelivr → 页面 reload
  （purge：`https://purge.jsdelivr.net/gh/veypi/aic-skills@main/office_studio/ui/vendor/univer-excel.bundle.js`）

## 阶段 1：Word（docx）接入（下一步）

- [ ] 选型确认：SuperDoc 优先（候选），对照评估 docx.js 路线与 OnlyOffice 集成成本；
      要求：浏览器端可编辑、能接受/产出真实 docx、可编程 API（AI 指令面）
- [ ] 集成闭环：打开 / 编辑 / 保存（同一 `/fs` 契约）
- [ ] AI 指令面（草）：`read_text`（段落与样式）、`search_text`、`replace_text`、
      `insert_paragraph`、`append_section`、`save`
- [ ] 多类型路由：同一 office_studio 页面按扩展名分流（xlsx→Excel 引擎 / docx→Word 引擎），
      各引擎按需懒加载（避免首屏加载全部引擎包）
- [ ] 验收：AI 读一份合同 → 定位并替换条款 → 用户在页面上实时看到修改 → 保存回原文件

## 阶段 2：PPT（pptx）接入

- [ ] 选型调研（PPTist 等候选；同样按"浏览器可编辑 + 真实 pptx + 可编程"三条件评估）
- [ ] 集成闭环 + AI 指令面（页级读写：`list_slides` / `read_slide` / `write_slide` /
      `add_slide` / `save`）
- [ ] 验收：AI 根据提纲生成一套演示稿，用户在界面上精修后保存

## 功能增强（Excel 后续）

- [ ] **新建空工作簿**（当前仅能打开已有文件——首页需加"新建"入口）
- [ ] 图表 / 批注 / 条件格式：评估 Univer 能力暴露面（按需开放为指令）
- [ ] 大文件性能：10MB+ xlsx 的加载/保存体验（懒 sheet、进度提示）
- [ ] 系统剪贴板交互：从剪贴板粘贴一个表格区域 / 复制区域到剪贴板
- [ ] 导出 PDF / 打印排版（评估 Univer 导出能力）

## 发布与运维

- 资源引用原则：**只引 CDN 绝对地址，不引平台相对路径**——正式环境相对路径会解析成
  `https://ivec.ai/skills/...`（平台服务器），违背带宽外移目标
- 仓库文件 `<skill>/ui/vendor/` 保留（jsDelivr 的内容源），页面不引用它；
  安装包是否携带 vendor 与页面行为无关
- 版本策略：`@main` 滚动 + purge 即时生效；重大变更时打 tag 并 pin

## 已知问题 / 技术债

- [ ] 多端并发写同一文件：当前后写覆盖（无冲突检测）——至少做"保存前检测外部修改"
- [ ] 引擎包体积（16MB / gzip 3.67MB）：首访依赖 CDN；未来按需拆包（仅编辑器内核 + 用到时加载插件）
- [ ] filebind / picker 链路的回归清单需固化（双击打开、选择器、最近文件）

## 测试资产

- `/u/admin/office-test/sample.xlsx`、`sample2.xlsx`（含真公式）
- 回归清单（页面）：打开 → read_range（对公式）→ set_cell → save → 重开校验

## 不做清单（明确放弃，保住定位）

- 多人实时协同编辑（OT/CRDT）——平台场景是"一人 + AI"，非在线文档竞品
- 100% 格式保真（复杂图表、分页排版、宏/VBA）——超纲需求引导去桌面 Office
- 公式/图表的完整复刻——按实际需求逐步暴露，不做全集覆盖
