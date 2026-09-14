---
name: drawio
nickname: DrawIO 绘图台
description: 浏览器内 drawio 图表绘制与编辑工作台：形状/连线/样式编辑、.drawio 文件读写（统一文件视图）、PNG/SVG 导出；AI 可直接编写 .drawio XML 并用页面指令打开编辑
keywords: [drawio, 绘图, 画图, 图表, 流程图, 架构图, 思维导图, uml, erd, diagram]
icon: fa-solid fa-diagram-project
ui:
  - path: index.html
    desc: 绘图工作台（工具栏 + 形状面板 + 画布 + 属性面板 + 文件对话框）
---

# DrawIO 绘图台

## 是什么

零后端的浏览器绘图工作台：drawio 文件格式（`.drawio` XML）双向兼容，离线可用（内核为
maxgraph——drawio 上游 mxGraph 的官方现代版）。文件经**统一 $fs 文件视图**读写
（云端 UFS / 浏览器本地 / 主机三端），支持绘制、编辑、样式、撤销重做、缩放平移、
网格吸附、导出（.drawio / PNG / SVG）。

能力边界（v1）：

- 官方 stencil 图标集（AWS/K8s/UML 成套图标）**不渲染**——退化为矩形（文件不损坏）
- 多页 `.drawio` 只编辑第一页，其余页面保存时原样保留
- 渲染形状集、样式键、边标记的准确清单见 `references/shapes.md`

## 什么时候用

- 用户要「画个图」（流程图 / 架构图 / 思维导图 / 网络图 / ER / 时序图…）→ **你直接写
  `.drawio` XML 文件**，再 `drawio_open` 打开展示给用户
- 用户给了现成 `.drawio` 文件要看/改 → `drawio_open`；或用户改完后你 fs 读同一文件
- 用户想自己画 → 把页面打开给他

## 操作方式（AI 标准流程）

1. 打开页面：`open {url_prefix}/index`（`url_prefix` = skill 列表返回的包前缀，形如
   `/skills/local/drawio`；随部署可变，**勿硬编码**）
2. 探测指令：`exec 1host=page {win_id}.list`（返回全部 `drawio_*` 指令清单）
3. 出图：fs 工具直接写 `.drawio` 文件（默认目录 `/u/{uid}/drawio/`；**先读
   `references/xml-authoring.md`**，本文末尾有快速骨架）
4. 展示/刷新：`drawio_open --path <文件路径>`——写完文件页面**不会自动感知**，必须调它
   （用户手动改过文件的场景同理）
5. 导出成图：`drawio_export --format png|svg --path <输出路径>`
6. 页面是用户的编辑舞台：用户可随时改图并保存；你 fs 读文件即拿到最新内容

典型流程（用户说「画一个 XX 架构图」）：

1. 读 `references/diagram-types.md` 选图形套路 + 本文速记规则
2. fs 写 `/u/{uid}/drawio/xx-架构图.drawio`（JSON 无关；就是 XML 文本，2 空格缩进）
3. `drawio_open --path ...` 打开给用户看
4. 一两句话总结；后续用户说「改成 YY」→ fs 读 → 改 → 写回 → `drawio_open` 刷新

## 指令表

返回统一为 `{content: "<JSON 字符串>"}`：成功 `{ok: true, ...}`，失败 `{ok: false, error}`。
argv 形如 `["--path", "/u/admin/drawio/x.drawio"]`（`--key val` 成对）。

| 指令 | 说明 | 参数 | 返回 |
| --- | --- | --- | --- |
| `drawio_status` | 页面与文档状态（**唯一未就绪也可调用**） | 无 | `{ok, ready, viewport:{w,h}, path, name, dirty, vertices, edges, scale, selection}` |
| `drawio_list` | 列出目录下 `.drawio`/`.xml` 文件 | `--dir`（可选，默认当前文档目录/云端默认目录） | `{ok, dir, items:[{name, path, dir, size, mod_time}]}` |
| `drawio_open` | 打开文件到画布（有未保存改动且已有路径时先自动保存） | `--path`（必填） | `{ok, path, name}` |
| `drawio_new` | 新建空白图（丢弃当前内容） | 无 | `{ok}` |
| `drawio_save` | 保存当前图 | `--path`（可选；新文档未保存过必填） | `{ok, path, bytes}` |
| `drawio_export` | 导出 PNG/SVG **文件**（AI/自动化专用；页面按钮的导出为浏览器下载） | `--format png\|svg`、`--path`（均必填） | `{ok, format, path}` |
| `drawio_get_xml` | 当前图 XML 全文 | 无 | 内容即 mxfile XML 文本（非 JSON） |
| `drawio_fit` | 视图适应窗口 | 无 | `{ok}` |

### 页面交互（人类操作，了解即可）

形状面板点击/拖拽放置 → 拖动连接点拉线 → 双击形状改文本 → 右侧属性面板调样式；
右键拖动平移、滚轮缩放；Ctrl/Cmd+S 保存、Z 撤销、Shift+Z 重做、A 全选、C/X/V
复制剪切粘贴、Delete 删除。顶部按钮：**打开 / 另存为走平台文件选择器**（`$fs.open` /
`$fs.save_as`，与 /fs 管理器同一棵三端树），**导出 PNG/SVG 为浏览器下载**（不写入 $fs）。

**响应式**：窗口宽度变化自适应（`@container` 查询）。工具栏按钮按需自动换行；窗口较窄
（≤860px）时形状/属性面板收为左右抽屉，由工具栏右侧的两个图标按钮开合（画布占满全宽）；
画布尺寸随窗口实时重算。

## 文件与格式约定

- **位置**：默认目录 `/u/{uid}/drawio/`（约定，非强制——页面文件对话框支持统一的
  `/cloud`、`/page`、`/{host_id}` 三端路径）；文件名用中文/英文均可，建议语义化
- **格式**：`<mxfile>` 包 `<mxGraphModel>`（未压缩）；读取压缩文件
  （`compressed="true"`，raw-deflate/zlib + base64）没有问题；导出默认不压缩
- **写出规范**（必读）：`references/xml-authoring.md`。速记：
  - `id="0"`、`id="1"` 根单元格必写；形状 id 从 `"2"` 起递增；`parent="1"`
  - 边必须带 `<mxGeometry relative="1" as="geometry" />` 子元素
  - 坐标取 10 的整数倍；`html=1`；`&#xa;` 换行；XML 注释禁 `--`
- **快速骨架**：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="NDrawio" version="24">
  <diagram name="Page-1">
    <mxGraphModel grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="2" value="服务" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="160" height="60" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## references 索引（按需读取）

| 文件 | 内容 |
| --- | --- |
| `references/xml-authoring.md` | XML 编写规范：骨架、形状/容器/边、颜色表、布局规范（**出图前必读**） |
| `references/diagram-types.md` | 图形类型套路：流程图/架构/C4/思维导图/泳道/时序/ER/网络 |
| `references/shapes.md` | 形状词汇表 + 渲染边界（哪些形状稳定渲染、哪些退化） |
| `references/style-presets.md` | 5 套配色预设（default/dark/corporate/colorblind-safe/handdrawn） |
| `references/presets/*.json` | 预设的完整定义（palette/roles/shapes/edges），可 fs 直读 |

## 注意

- 页面指令仅在页面打开时就绪；`drawio_status` 的 `ready:false` 表示尚未就绪（先 `open`）
- 写完/改完文件后必须 `drawio_open` 让画布刷新
- 用户正在画布上编辑时（未保存），`drawio_new` 会丢弃其改动（UI 侧有确认，指令侧直接执行）——
  尊重用户的未保存改动，避免在用户编辑时强行重载
