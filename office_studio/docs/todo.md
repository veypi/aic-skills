# Office Studio 路线图（2026-09-12）

## 战略定位

目标：让 AI 与用户在**同一份真实 office 文件**上协作——不是"导入-编辑-导出"的沙盒编辑器，
而是**文件本体的直接工作台**（文件 = 一个 `/fs` 路径，零复制，改完写回原处）。

三个不做妥协的维度（相对 WPS / Office Online / 各类网页编辑器）：

1. **AI 原生操作面**：一切编辑能力暴露为窗口指令（结构化 JSON 进/出），AI 是"隐形的手"，
   与人共用同一个编辑器实例——AI 写一格，用户屏幕上立即变化。
2. **文件即路径**：cloud / page（浏览器 OPFS）/ host（本机磁盘）统一走平台 `$fs`，
   应用层不区分端；文件管理器双击即打开（filebind 协议）。
3. **与平台深集成**：ask AI 联动（AI 读到的是用户正看的同一工作簿）、/fs 原生读写、
   会话产物直落用户云盘。

策略：**不求 100% 格式保真与全功能**（复杂图表/宏/分页排版是桌面 Office 的护城河），
聚焦"AI 能闭环的高频场景"：文档理解、批量修改、数据整理、演示稿生成。

## 阶段 0：Excel（xlsx）——已上线（2026-09-11）

- [x] 打开 / 编辑 / 保存闭环：Univer presets `0.25.1`（表格 UI + 公式 + 数字格式）
      + `@mertdeveci55/univer-import-export 0.2.1`（xlsx 序列化，exceljs 底座）
- [x] 平台打开协议：filebinds 登记 `xlsx,xls` → `/skills/local/office_studio/excel`
- [x] AI 指令面：`open` / `status` / `read_range`（含公式）/ `cell_info` / `set_range` /
      `set_cell`（值或公式）/ `save`（写回或另存）——全部经真实平台验证
- [x] 引擎资源加速：bundle 16.19MB（gzip 3.67MB）经 jsDelivr（`gh/veypi/aic-skills`）分发，
      页面纯 CDN 引用（不占平台带宽）
- [x] 大文件读取：host 端 `$fs` 二进制直连整读（RTC 直连，≤64MB）

## 阶段 1：Word（docx）——已上线（2026-09-12）

- [x] 选型：docx-core（`@usejunior/docx-core`）+ docx-preview 审阅引擎（Apache/MIT 栈）；
      浏览器端可编程：红字修订 / 批注 / 接受拒绝，全部暴露为指令面
- [x] 集成闭环：打开 / 编辑 / 保存（同一 `/fs` 契约）
- [x] AI 指令面：`read_text`、`list_revisions`、`search_text`、`replace_text`、`replace_range`、
      `insert_paragraph`、`comment`、`accept_ai` / `reject_ai`、`accept_all` / `reject_all`、`save`
- [x] 审阅台重设计（2026-09-12）：右侧「审阅队列」（修订/批注列表 + 点击定位 + 逐条接受/拒绝 +
      批注删除二次确认 + 批量操作）；引擎新增 `listRevisions` / `resolveRevisions` / `deleteComment`
- [x] 验收：AI 读一份合同 → 定位并替换条款 → 用户在页面上实时看到修改 → 保存回原文件

## 阶段 1.5：统一工作台——已上线（2026-09-12）

- [x] 统一首页（`ui/index.html`）：打开 docx/xlsx + 新建入口 + 共享「最近打开」历史
      （逐条移除 / 清空；任一编辑器打开或保存成功都写入同一列表）
- [x] 多类型路由：首页按扩展名同窗导航进入 `excel.html` / `word.html` 子页面；
      filebind 直达编辑器（`xlsx,xls` → excel、`docx,doc` → word）
- [x] 新建入口：「新建表格 / 新建文档」→ 另存为对话框选路径 → 编辑器暂存，
      **首次保存时落盘**（中途关闭不产生文件）
- [x] 审阅引擎扩展：`insert_paragraph` 支持虚拟锚点 `@start` / `@end`
      （空文档写首段 / 文末追加；`@start`/`@end` 解析为顶层首末段落锚点，复用底层插入与书签分配）
- [x] 空白模板 `ui/vendor/blank.docx`（docx-core `generateDocx` 生成的标准空文档，~10KB）
- 引擎源码：`temps/review-spike`（`src/review-doc.js` + `node build.mjs` 重建 bundle）

## 阶段 1.6：Word 增强——已上线（2026-09-13，待发布）

- [x] 段落渲染映射修复：渲染定位标记（`_aicpm_`）→ 复杂文档（表格内/空段）点击与选区精确（此前复杂文档映射错位）
- [x] 表格指令：`read_tables`（读结构，含空单元格）/ `set_cell_text`（填格，红字）/ `add_table_row`（行修订：拒绝=删行）/ `add_table_col`（单元格修订：拒绝=删列）/ `insert_table`（直接插入，可带初始数据）
- [x] 插图：`insert_image`（png/jpg/gif/bmp；自动尺寸/超宽等比缩；media+rels+drawing）+ 页内「插入图片」按钮
- [x] 引擎自实现行/格修订的拒绝（`trPr/ins` 删行、`cellIns` 删列 + tblGrid 同步——docx-core 不处理）
- [x] 修复「多窗口只有一个显示」：页面容器改按实例唯一 id（`word.html` / `excel.html`）
- [ ] 发布：同步 aic-skills 仓库（CDN 源）+ purge —— 2026-09-13 工作台/引擎文件已更新完毕，待 push 后 purge

## 阶段 1.7：样式可控性（待开发）

源于 2026-09-13《软件质量安全检测子系统-概要设计说明书》样式事故：批量填充时未考虑“格式继承”（插入继承锚点、替换保留原格式），产出的正文大面积被套标题样式（黑体+抢编号）与斜体，事后靠外部脚本改 `document.xml` 修复。SKILL.md 已补「样式与格式」警示节；引擎侧增强：

- [x] `insert_paragraph` / `insert_image` 增加 `--from <段落id>`：显式指定**格式源段落**（默认仍取锚点）——**已上线 2026-09-13**（引擎透传 docx-core `styleSourceId`；无效 id 直接报错；返回携带 `styleFrom`）
- [ ] `set_paragraph_format --para <id> --from <模板段id>`：把目标段落格式整体对齐模板段（pStyle/字体/字号/斜体/缩进），批量修样式用（本次事故的“引擎内修复”路径）
- [x] `style_report`（只读）：返回段落样式统计（各 `pStyle` 的段落数 + 每类抽样文本）＋标题大纲（含解析后的自动编号）——**已上线 2026-09-13**，批量填充前后自查用
- [x] 指令返回里回显“继承的样式来源”：`insert_paragraph` / `insert_image` 返回 `styleFrom`；`insert_image` 另返回 `numPrRemoved`（图片段不再继承直接编号）——**已上线 2026-09-13**

## 阶段 1.8：工作台加固（2026-09-13，已完成）

源于 Word 工作台作业 bug 清单（批量指令乱序已由平台侧串行化修复，其余落地如下）：

- [x] `delete_paragraph` / `move_paragraph`：修订式删除与移动（内容+段落标记双修订；拒绝=完整恢复；`--plain` 直改不进修订流）
- [x] `read_text` 扩展：`--offset/--limit` 分页、`--empty` 空段寻址（空段 id 可作 `--from`/`--anchor`）、`--ids` 批量读取
- [x] `style_report`：样式统计 + 标题大纲（`number` = 解析后的自动编号）——编号自检
- [x] `insert_image` 图片段不继承直接编号（numPr）——防抢占编号序列 / 渲染多余编号行
- [x] `insert_table` 返回 `firstParagraphId` / `lastParagraphId` / `afterParagraphId` 锚点
- [x] `insert_table --data` 支持 JSON 二维数组与 `\|` `\;` 转义
- [x] `insert_paragraph` 插入文本自动清理 ASCII 首尾空白（保留全角缩进）
- [x] save 外部修改冲突检测（sha-256 基线；`--force` 覆盖）；同文件重复打开防重载（`--reload` 强制）
- [x] 首页未保存修改二次确认；`status` 增加 dirty/loads/saves 诊断

## 阶段 2：PPT（pptx）接入

- [ ] 选型调研（PPTist 等候选；同样按"浏览器可编辑 + 真实 pptx + 可编程"三条件评估）
- [ ] 集成闭环 + AI 指令面（页级读写：`list_slides` / `read_slide` / `write_slide` /
      `add_slide` / `save`）
- [ ] 验收：AI 根据提纲生成一套演示稿，用户在界面上精修后保存

## 功能增强（Excel 后续）

- [ ] 图表 / 批注 / 条件格式：评估 Univer 能力暴露面（按需开放为指令）
- [ ] 大文件性能：10MB+ xlsx 的加载/保存体验（懒 sheet、进度提示）
- [ ] 系统剪贴板交互：从剪贴板粘贴一个表格区域 / 复制区域到剪贴板
- [ ] 导出 PDF / 打印排版（评估 Univer 导出能力）
- [x] 新建空工作簿（2026-09-12：首页「新建表格」→ 另存为 → 保存落盘）

## 发布与运维

- 资源引用原则：**只引 CDN 绝对地址，不引平台相对路径**——正式环境相对路径会解析成
  `https://ivec.ai/skills/...`（平台服务器），违背带宽外移目标
- 仓库文件 `<skill>/ui/vendor/` 保留（jsDelivr 的内容源）；安装包是否携带 vendor 与页面行为无关
- 版本策略：`@main` 滚动 + purge 即时生效；重大变更时打 tag 并 pin
- Word 页面以 `?v=<ENGINE_V>` 破浏览器缓存（更新 vendor 资源后同步递增；CDN 侧靠 purge）
- **引擎/模板变更发布清单**：spike 重建 bundle → cp `ui/vendor/`（`docx-review.bundle.js`、
  `blank.docx`）→ 同步 aic-skills 仓库（CDN 内容源）→ push + purge → 页面 reload

## 已知问题 / 技术债

- [x] 多端并发写同一文件（2026-09-13）：save 前 sha-256 冲突检测（不一致拒绝覆盖，`--force` 强制）——跨窗口实时同步仍不在范围
- [ ] 引擎包体积（16MB / gzip 3.67MB）：首访依赖 CDN；未来按需拆包（仅编辑器内核 + 用到时加载插件）
- [x] 切换首页/编辑器销毁页面（2026-09-13）：首页二次确认 + 同文件重开防重载已加；窗口被直接关闭/销毁时仍无自动快照（如需再加）
- [ ] filebind / picker 链路的回归清单需固化（双击打开、选择器、最近文件、新建）
- [x] 样式继承对调用方“隐形”（2026-09-13 事故根因）：插入类已回显 `styleFrom` / `numPrRemoved`（见阶段 1.7/1.8）；替换“保留原格式”仍为文档约定，可用 `style_report` 自查

## 测试资产

- `/u/admin/office-test/sample.xlsx`、`sample2.xlsx`（含真公式）、`sample.docx`
- Word 增强测试产物：`/tmp/test-output.docx`（含插图×2 + 新表 + 修订，2026-09-13）
- 回归清单（页面）：打开 → read_range（对公式）→ set_cell → save → 重开校验
- 回归清单（Word）：打开 → read_text → replace_text（红字）→ 队列逐条处置 → save；
  新建空白 → `insert_paragraph --anchor @end` 写首段 → save → 重开
- 加固回归（2026-09-13）：delete_paragraph / move_paragraph 的接受与拒绝；read_text --empty；style_report；insert_table 锚点返回；save 冲突拒绝与 --force；引擎脚本 `temps/review-spike/ttmp/check-fixes.mjs`

## 不做清单（明确放弃，保住定位）

- 多人实时协同编辑（OT/CRDT）——平台场景是"一人 + AI"，非在线文档竞品
- 100% 格式保真（复杂图表、分页排版、宏/VBA）——超纲需求引导去桌面 Office
- 公式/图表的完整复刻——按实际需求逐步暴露，不做全集覆盖
