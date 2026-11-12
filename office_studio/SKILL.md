---
name: office_studio
version: 1.0.8
nickname: Office Studio
description: Office 文档工作台：打开、编辑、保存真实 office 文件（docx/xlsx/pptx），AI 与用户共用同一编辑器协作。当前已接入 Excel（xlsx 编辑）与 Word（docx 审阅/表格编辑/插图，红字修订），含统一首页（打开/新建 + 共享历史）
keywords: [office, excel, xlsx, word, docx, 表格, 文档, 电子表格, 编辑器, 工作簿, 审阅, 修订, 新建, 首页, 历史, 契约]
icon: fa-solid fa-file-lines
---

# Office Studio

Office 文件工作台：在平台窗口里打开真实 office 文件（**零复制**，直接读写 `/fs` 路径的文件本体），
用户经界面编辑/审阅；AI 在 `exec _host=page` 的 async JS 函数体里经 `win(id).command(data)` 读写**同一份文件**并保存回原路径——AI 的每次操作，用户屏幕上实时可见。页面 handler 接收 `(data, ctx)`，直接返回业务对象，失败抛出明确错误；用 `return await commands()` 发现函数。

当前支持：

- **统一首页**（`ui/index.html`）：打开 docx/xlsx 与「新建表格 / 新建文档」的统一入口；共享「最近打开」历史（任一编辑器打开的文件都进同一列表，可逐条移除 / 清空）
- **Excel（.xlsx）**：`ui/excel.html` —— 完整编辑（Univer 引擎）
- **Word（.docx）**：`ui/word.html` —— **审阅工作台**（docx-core 引擎：AI 产出红字修订，人类审阅/接受/拒绝）

## 页面与导航

- 首页 → 点击文件（或新建）→ **同窗导航**进入对应编辑器（`excel?url=...` / `word?url=...`）；编辑器顶部「首页」按钮返回
- 文件管理器双击 xls/xlsx/doc/docx → 根 manifest 的 `ui.openers` 直达对应编辑器（已有窗口则复用；打开统一经 `?url=< /fs 完整路径>` 传参）
- **窗口复用（AI 操作默认）**：打开文件前先 `await list()` 查已有 Office 窗口（title 含“Office Studio”或 url 含 `/excel`、`/word`）——已有对应编辑器 → **在该窗口内** `await win(id).open({url: '/fs/.../文件'})` 切换，不新开；没有 → 用 `await open({url: '/fs/.../文件'})` 新开**一个**并持续复用；除非用户明确要求（如并排对比），不为新文件新建窗口
- 打开的文件 = 一个 `/fs/...` 路径（cloud / page / host 任意端，应用不区分），读写全走平台 `$fs`
- 保存 = 把文档导出 docx/xlsx **写回打开时的路径**（覆盖原文件）

## 新建文件

首页「新建表格 / 新建文档」→ 平台另存为对话框选目录 + 文件名（默认 `未命名.xlsx` / `未命名.docx`）→
进入编辑器（空白工作簿 / 空白文档），**首次「保存」时才把文件写到所选路径**（中途关闭不产生文件）。
空白 Word 文档来自模板 `ui/vendor/blank.docx`（docx-core 生成的标准空文档）。

## 首页（index.html）指令表

| 指令 | 说明 | 参数 |
| --- | --- | --- |
| `status` | 返回共享「最近打开」列表 `{ok, recent:[{path,name,kind}]}` | 无 |

## Excel（.xlsx）指令表

页面：`ui/excel.html`。打开方式：`await open({url: '/fs/.../xxx.xlsx'})`（**优先复用已有窗口**，见「页面与导航」；或首页点击 / 文件管理器双击）。

| 指令 | 说明 | 参数 |
| --- | --- | --- |
| `open` | 打开 /fs 路径的 xlsx（OS opener 入口） | `{url, paths?}` |
| `status` | 页面状态（未就绪也可调） | 无 |
| `diag` | 调试诊断 | 无 |
| `read_range` | 读范围值与公式 | `{range: 'A1:D5'}` |
| `cell_info` | 单格内部结构 | `{cell: 'D2'}` |
| `set_range` | 写范围（二维数组） | `{range: 'A1:B2', values: [[1,2],[3,4]]}` |
| `set_cell` | 写单格（值或公式） | `{cell: 'B2', value: 42}` / `{cell: 'D2', formula: '=B2*C2'}` |
| `save` | 写回原文件 | `{path?}` 另存 |

## Word（.docx）指令表

页面：`ui/word.html`。打开方式：`await open({url: '/fs/.../xxx.docx'})`（**优先复用已有窗口**，见「页面与导航」；或首页点击 / 文件管理器双击）。

**核心机制（人机同工具）**：AI 的每次编辑默认产生**红字修订**（word 原生 track changes，
作者署名 `AI`）；人类在同一页面上实时看到红色删除线/绿色插入，并随时「接受 AI 修订 / 接受全部 / 拒绝全部」。
人类的修改（作者 `Human Reviewer`）同样以修订形式留存，与 AI 修订互不混淆（选择性接受按作者隔离）。

页面右侧为**审阅队列**：逐条列出修订与批注（按文档顺序；点击条目跳转定位），每条可直接「接受 / 拒绝」，批注可删除（二次确认）；顶部提供「接受 AI 修订 / 接受全部 / 拒绝全部」批量操作。底部「选区操作」：在文档中选中文字后替换 / 加批注（各自独立输入，回车提交）。

| 指令 | 说明 | 参数 |
| --- | --- | --- |
| `open` | 打开 /fs 路径的 docx；同文件有未保存修改时拒绝静默重载 | `{url, paths?, reload?}`；reload:true 从磁盘强制重载 |
| `status` | 页面/文档状态（未就绪也可调） | 无 |
| `read_text` | 读段落索引 `[{id,text}]`；单段 / 分页 / 空段 | `{para?}` / `{offset, limit}` / `{empty: true}` / `{ids: ['_bk_a', '_bk_b']}` |
| `list_revisions` | 列出待处理修订与批注 | 无参。返回 `{ok, revisions:[{id,type,author,text,paraId}], comments:[...]}` |
| `search_text` | 按子串搜索段落 | `{q: '条款'}` |
| `replace_text` | 替换段落内文本（唯一匹配；默认 AI 红字） | `{para, find, replace, author?, plain?}` |
| `replace_range` | 按字符范围替换（默认 AI 红字） | `{para, start: 5, end: 18, replace, author?}` |
| `insert_paragraph` | 插入新段落（默认 AI 红字）；anchor 为 @start/@end 时插入文档首/末；from 指定格式源 | `{anchor, text, pos?, from?, author?}`（text 中 `\n\n` 可分多段） |
| `comment` | 加批注（按文本或范围锚定） | `{para, find, text, author?}` 或 `{para, start, end, text, author?}` |
| `read_tables` | 读全部表格结构（行列、单元格文本、段落 id、空单元格标记） | `{index?}` |
| `set_cell_text` | 填/改单元格文本（默认 AI 红字；空单元格写入，非空替换首段） | `{table, row, col, text, mode?, plain?, author?}` |
| `add_table_row` | 表格加行（默认 AI 行修订：接受=行保留，拒绝=删行） | `{table, at?, cells?: ['A','B','C'], plain?, author?}` |
| `add_table_col` | 表格加列（默认 AI 单元格修订：接受=列保留，拒绝=删列） | `{table, at?, plain?, author?}` |
| `insert_table` | 插入新表格（直接插入；可带二维初始数据）；返回表内首/末段与表后锚点 id | `{anchor?, pos?, rows?, cols?, data?: [['a','b'],['c','d']]}`；返回 `firstParagraphId` / `lastParagraphId` / `afterParagraphId` |
| `insert_image` | 在段落前/后插入图片（png/jpg/gif/bmp；默认 AI 红字修订）；from 指定新段落格式源；图片段不继承直接编号（numPr） | `{src, anchor?, pos?, from?, width?, height?, alt?, plain?, author?}` |
| `delete_paragraph` | 删除段落（默认 AI 红字修订：接受=删段，拒绝=恢复） | `{para, plain?, author?}` |
| `move_paragraph` | 移动段落（默认修订式：目标处插入+原处删除；接受=移动生效，拒绝=原位保留） | `{para, anchor, pos?, plain?, author?}` |
| `style_report` | 样式与标题结构报告（只读）：段落样式统计 + 标题大纲（`number`=解析后的自动编号） | 无参 |
| `accept_ai` | 接受 AI 修订（其他作者修订保留） | `{author?}` |
| `reject_ai` | 拒绝 AI 修订（恢复 AI 改动前） | `{author?}` |
| `accept_all` / `reject_all` | 接受 / 拒绝全部修订 | 无 |
| `save` | 写回打开时的 /fs 路径；磁盘被外部修改时拒绝覆盖 | `{path?, force?}`；force:true 跳过外部修改检测 |

### Word 典型协作流程（AI 修订 → 人类审阅）

1. 用户/文件管理器打开一份 docx（或 AI `open({url: '/fs/.../合同.docx'})`）
2. AI `win(id).read_text()` / `win(id).search_text({q})` 定位目标段落
3. AI `win(id).replace_text({para: '<id>', find: '...', replace: '...'})` → 页面上出现**红字修订**（用户实时可见）
4. AI `comment` 在关键处加批注
5. 用户在页面上审阅：逐条「接受 AI 修订」/「拒绝全部」，或直接用手工工具修改（同等产生修订）
6. AI 或用户 `save` 写回原文件

### Word 注意

- `read_text` 返回的段落 id（`_bk_...`）在一份文档的打开周期内稳定——用它做后续所有操作的锚点
- **空文档（新建的空白文档、清空后的文档）没有任何可见段落**：写首段用 `insert_paragraph({anchor: '@end', text: '...'})`（`@start` 插到文首）；支持 `\n\n` 一次写入多段。写入后段落即获得 `_bk_` id，后续操作照常锚定
- `replace_text` 要求**唯一匹配**（同段落内多处相同文本会报 ambiguous，请用 `replace_range` 带范围或更长的 find 文本）
- 若文档有未接受的修订，`read_text` 读到的是**含修订后的当前文本**（与页面所见一致）
- AI 每次编辑产生红字修订（除非 `plain:true`）；红字是给人审的，批量自动场景可直接 `accept_all()` 收尾
- 插入段落的修订在队列中只显示内容条目（段落标记不单列；2026-09-13 起）
- **表格操作**：先用 `read_tables` 拿表格结构（含每格段落 id 与空单元格标记）→ `set_cell_text` 填格 / `add_table_row` / `add_table_col`；行修订（`trPr/ins`）与列修订（`cellIns`）的「拒绝」= 删行/删列（引擎自实现）；`insert_table` 为直接插入（不进修订流）。可用 `read_tables` 返回的 `paragraphs[].id` 作为后续锚点（如在单元格内插图）
- **插图**：`insert_image` 支持 png/jpg/gif/bmp；自动读取原图像素尺寸（超宽自动等比缩至内容宽），`width`/`height` 可显式指定（px，96dpi）；插入为「含图新段落」，锚点段落前/后（表格单元格插图 = 锚定单元格内段落）；默认 AI 红字（`plain:true` 直接插）
- **段落定位**：页面点击/选区与 `_bk_` id 精确对应（含空段落与表格内段落）；`#docx-host` 容器按页面实例唯一（多窗口同开互不干扰）
- **同锚多次插入的堆叠方向**：`pos:'after'` 每次都插到锚点后的第一个位置——同一锚点连续插入时**后插的更靠前**；需要正序时用**链式锚定**（把上一条返回的 `paragraphId` / `newParagraphIds` 作下一条锚点）
- **删除 / 移动**：`delete_paragraph`、`move_paragraph` 默认都产生红字修订（接受=生效、拒绝=完整恢复）；`plain:true` 直改不进修订流；移动 = 目标处插入副本（ins）+ 原处删除（del）两条修订
- **保存冲突检测**：save 前比对磁盘与打开时内容（sha-256）——磁盘被外部修改时**拒绝覆盖**（`force:true` 强制）；有未保存修改时同一文件重复 `open` 会被拒绝（`open({url, reload:true})` 从磁盘强制重载）
- **编号自检**：`style_report` 返回标题大纲（`headings[].number` = 页面上渲染的自动编号）与各样式段落统计——批量填充前后各跑一次，编号错位/样式污染可即时发现

### 样式与格式（批量编写 / 填充文档时必读）

**两条格式继承规则**——2026-09 批量填充《…概要设计说明书》时因忽视它们，出现过成片样式错乱（正文被套标题样式 + 抢占章节编号、全篇正文变斜体、图片段吃编号），事后靠外部脚本修 XML 才恢复：

1. **插入段落继承锚点格式**：`insert_paragraph` / `insert_image`（及 `set_cell_text({mode: 'append', ...})`）生成的新段落，格式**整体取自锚点段落**——包括段落样式（`pStyle`，如 heading 各层）、自动编号（`numPr`）、行距/缩进，以及字体/字号/**斜体**/加粗等文字属性。（`insert_table` 例外：新表格单元格是干净默认格式——表格文字可能与正文样式不一致，插入后注意目检。）
   - 正文内容用**正文锚点**：拿标题当锚点插正文 → 正文变黑体大标题、还会**抢走章节编号**（现象：正文行首冒出“7.7”式错位编号，后续整篇编号错位）。
   - 图片用**正文锚点**：图片段会继承锚点样式（2026-09-13 起不再继承直接编号 numPr，但仍可能继承标题字体/缩进等——锚点仍用正文）。
   - 插标题前先找**同层级**的现存标题作锚点，保证层级一致。
   - **要显式控制格式源时用 `from`**：`insert_paragraph({anchor: '<标题id>', pos: 'after', from: '<正文段落id>', text: '...'})`——新段落格式取自 from 指定段落（**在标题后插正文的推荐做法**）；`insert_image` 同字段。
2. **替换文字不改变格式**：`replace_text` / `replace_range` / `set_cell_text` 只替换文字、**保留原段落全部格式**。
   - 模板的“占位/说明”文字常带特殊格式（斜体、方括号）——替换成正式内容后，**正式内容会带着占位格式**（“正文全变斜体”即由此而来）。
   - 若被替换的占位本身是标题（如“模块1”），替换成正文内容后就成了“正文套标题样式”。

**批量填充建议流程**

1. 先 `read_text` 通读文档，为每个待填区域确定**目标样式**（以已完成的同类段落为参照系）；
2. 小块试做：先插 1-2 段 / 替换 1-2 处 → 页面目检字体、编号、行距；
3. 确认无误再批量执行，**同一区域保持一致的锚点选择**；
4. 收尾整篇目检：正文应为常规字体（非黑体/非斜体）、节标题编号连贯、图片独立成段不占编号；
5. 发现成片异常 = 几乎必然出自同一批操作的错锚点/错占位——先定位那批操作，整体修正后再继续。

**易错现象速查**

| 现象 | 根因 | 预防 |
| --- | --- | --- |
| 正文渲染成黑体大号字、行首带错位编号 | 插入时用了标题段落做锚点 | 正文操作只用正文锚点 |
| 正文变斜体 / 字体异常 | 替换了“斜体说明”占位，格式被保留 | 替换后目检样式 |
| 图片套上标题样式 / 进编号序列 | 图片插入锚点是标题 | 图片用正文锚点（图片段已不继承直接编号 numPr） |
| 章节编号跳号 / 错位 | 有非标题段落占用了标题样式 | 目检编号序列，发现即修 |

> **插入时**可用 `from` 指定格式源；`style_report()` 可做样式与编号自检；格式的**事后整体修正**（`set_paragraph_format`）仍待后续增强，见 [docs/todo.md](docs/todo.md)。

## 开发状态

- Phase 0：Excel 打开 / 编辑 / 导出 / 写回闭环已上线（2026-09-11；引擎经 jsDelivr 分发）
- Phase 1：Word 审阅工作台上线（2026-09-12；docx-core + docx-preview 全 Apache/MIT 许可栈）
- Phase 1 增强（2026-09-12）：审阅台重设计 —— 右侧面板改为「审阅队列」（修订/批注列表 + 定位跳转 + 逐条接受/拒绝 + 批注删除 + 批量操作）；引擎 bundle 新增 `listRevisions` / `resolveRevisions` / `deleteComment`
- Phase 1.5（2026-09-12）：**统一首页 + 新建 + 多类型分流** —— `ui/index.html` 重写为统一首页（打开 docx/xlsx、共享最近打开历史、逐条移除/清空）；Excel 编辑器拆出 `ui/excel.html`，Word 编辑器去掉内置首页；「新建表格 / 新建文档」（另存为选路径，保存时落盘）；审阅引擎新增 `insert_paragraph` 虚拟锚点 `@start/@end`（空文档写入），空白模板 `ui/vendor/blank.docx`
- Phase 1.6（2026-09-13）：**Word 增强** —— 段落渲染映射修复（复杂文档的点击/选区精确到段，含表格内与空段）；新指令 `read_tables` / `set_cell_text` / `add_table_row` / `add_table_col` / `insert_table` / `insert_image`（表格读写、行列编辑、新表与插图）；页内「插入图片」按钮；修复「多窗口只有一个显示」（页面容器改按实例唯一 id）
- Phase 1.6.1（2026-09-13）：**样式经验文档化** —— 新增「样式与格式（批量编写/填充文档时必读）」节（两条格式继承规则 + 批量填充流程 + 易错现象速查表）——源于《软件质量安全检测子系统-概要设计说明书》批量填充样式事故的复盘
- Phase 1.7（2026-09-13，部分）：**插入格式源可指定** —— `insert_paragraph` / `insert_image` 支持 `from` 字段（显式指定新段落格式源；引擎透传 docx-core `styleSourceId`；无效 id 报错；返回携带 `styleFrom`）
- Phase 1.8（2026-09-13）：**工作台加固（审阅 bug 清单修复）** —— `delete_paragraph` / `move_paragraph`（修订式删/移，拒绝即恢复）；`read_text` 分页 / 空段 / 批量寻址；`style_report` 样式与标题编号自检；`insert_image` 图片段不再继承直接编号（防抢编号序列）；`insert_table` 返回表内首/末段与表后锚点；`data` 使用二维数组；插入文本自动清理 ASCII 首尾空白；save 外部修改冲突检测（`force:true` 覆盖）；同文件重复打开防重载 + 首页未保存二次确认；status 增加 dirty/loads/saves 诊断
- 路线图与待办详见 **[docs/todo.md](docs/todo.md)**

## 资源分发

引擎与模板资源经 jsDelivr（`gh/veypi/aic-skills`）分发（不占平台带宽）：

- Excel 引擎：`univer-excel.bundle.js`（16MB → gzip 3.7MB）——大文件走**独立资产分支** `office_assets`（`https://cdn.jsdelivr.net/gh/veypi/aic-skills@office_assets/`），页面直接引用；样式 `univer-excel.css` 在 `ui/vendor/`
- Word：`ui/vendor/docx-review.bundle.js`（本地优先、CDN 回退；2026-09-13 版：精确定位映射 + 表格读写/行列编辑 + 插图 + 段落删除/移动 + 样式编号报告）
- 空白模板：`ui/vendor/blank.docx`（~10KB；新建 Word 用）
- Word 页面以 `?v=<ENGINE_V>` 查询参数破缓存（更新 vendor 资源后同步递增）

更新流程：spike 构建（`temps/review-spike`，`node build.mjs`）→ univer 产物提交到 `office_assets` 分支、docx/blank cp 到 `ui/vendor/` → push → purge jsDelivr → 页面 reload。

## 给用户演示（引导脚本）

用户问「这个怎么用」时，在 page exec 里跑下面这段：单窗口先讲首页，再依次导航到 Excel / Word。
窗口 id 必须从 `open()` 返回值取（`win_id`）。

```js
const sleep = ms => new Promise(r => setTimeout(r, ms))
const demo = (await open({url: '/skills/cloud/office_studio'})).win_id
// 窄窗口下审阅栏靠顶栏「面板」按钮开合；宽窗口里它常驻，click 报错忽略
const sideToggle = async () => {
  try { await click({win_id: demo, selector: '.topbar .panel-toggle'}); await sleep(350) } catch (_) {}
}
// 首页「新建」按钮会弹保存路径选择器（需要用户选路径），脚本改用等价的
// ?url=<fs 路径>&new=1 直开新建态，不卡模态框
const XLSX = '/skills/cloud/office_studio/excel?url=' + encodeURIComponent('/fs/cloud/u/<uid>/guide.xlsx') + '&new=1'
const DOCX = '/skills/cloud/office_studio/word?url=' + encodeURIComponent('/fs/cloud/u/<uid>/guide.docx') + '&new=1'
const steps = [
  {sel: '.homebar', title: '首页',     desc: '打开文件 / 新建表格 / 新建文档'},
  {sel: '.shelf',   title: '共享历史', desc: 'AI 与你看同一份最近列表，点进去就是同一个编辑器'},
  {goto: XLSX, wait: 2500, sel: '.topbar', title: '新建表格', desc: '新开一个 xlsx，直接开始编辑'},
  {sel: '.app', title: '表格区', desc: '单元格网格；AI 经窗口指令直接读写'},
  {goto: DOCX, wait: 2000, sel: '.topbar', title: '新建文档', desc: '新开一个 docx'},
  {sel: '.doc-wrap', title: '正文区', desc: 'AI 改完以红字修订呈现，直接在这里过'},
  {before: sideToggle, after: sideToggle, sel: '.side', title: '审阅栏', desc: '评注与修订列表，可逐条接受或拒绝'},
]
for (const s of steps) {
  if (s.goto) { await open({url: s.goto, win: demo}); await sleep(s.wait || 900) }
  if (s.before) await s.before()
  await highlight({win_id: demo, selector: s.sel, title: s.title, desc: s.desc, wait: 8000})
  await sleep(1700)
  await highlight({win_id: demo, clear: true})
  if (s.after) await s.after()
}
return {win_id: demo, steps: steps.length}
```

- 首页「打开文件 / 新建表格 / 新建文档」都会弹文件选择器（`$fs.pickFiles` / `pickSavePath`）——**引导脚本不要点它们**，会卡一个等用户的模态框；新建用 `?url=<fs 路径>&new=1` 直接打开新建态（会真的建出文件，用临时路径并事后清理）
- `.side`（审阅栏）默认 `panel_open=false` 即 `display:none`；窄窗口用 `.topbar .panel-toggle` 开合（宽窗口该按钮 `display:none`，栏常驻）
- Excel 用 `.app`、Word 用 `.doc-wrap` 作为内容区；无 `?url=` 时它们是空态（`.empty-hint` / 空白正文）
- 引擎首次加载较慢（univer 16MB / docx bundle），刚导航完给 `wait` 2-3 秒再标注
