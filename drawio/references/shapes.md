# 形状词汇表与渲染边界

本绘图台能稳定渲染下列形状。写 `style=` 时**只用本表内的形状名**；表中之外的
`shape=mxgraph.*` 等 stencil 名称不会报错，但会**退化为矩形**（文件仍可打开/编辑）。

## 顶点形状（可直接写）

| 形状 | 样式串 | 备注 |
| --- | --- | --- |
| 矩形 | `rounded=0;whiteSpace=wrap;html=1;` | 默认形状 |
| 圆角矩形 | `rounded=1;whiteSpace=wrap;html=1;` | 可加 `arcSize=12` 控制圆角 |
| 椭圆/圆 | `ellipse;whiteSpace=wrap;html=1;` | 起点终点、圆 |
| 菱形 | `rhombus;whiteSpace=wrap;html=1;` | 判断点 |
| 三角形 | `triangle;whiteSpace=wrap;html=1;` | |
| 六边形 | `shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;` | |
| 圆柱（数据库） | `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;` | `size` 控制顶面高度 |
| 云 | `shape=cloud;whiteSpace=wrap;html=1;` | 互联网/外部 |
| 角色 | `shape=actor;whiteSpace=wrap;html=1;` | 人/角色 |
| 平行四边形 | `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;` | 输入/输出、数据 |
| 便签 | `shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=16;` | 注解 |
| 文本（无边框） | `text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;` | 纯文字标注 |
| 泳道 | `swimlane;fontStyle=1;align=center;verticalAlign=top;startSize=26;html=1;` | 容器（见下） |
| 直线 | `line;html=1;` | 罕见，一般用边 |
| 图片 | `image=<URL>;imageAspect=0;` | 外部图片，需目标环境可访问 |

## 容器

- 泳道：`swimlane;startSize=30;`（带标题栏）
- 不可见分组：`group;pointerEvents=0;`
- 任意形状作容器：加 `container=1;pointerEvents=0;`
- 子元素 `parent="<容器id>"`，坐标**相对容器**

## 边（连线）标记与样式

| 项 | 值 |
| --- | --- |
| 终点箭头 `endArrow` | `classic`（默认实心）/ `none` / `open` / `block` / `oval` / `diamond` |
| 起点箭头 `startArrow` | 同上；默认 `none` |
| 折线路由 `edgeStyle` | `orthogonalEdgeStyle` / `entityRelationEdgeStyle` / `elbowEdgeStyle` / 缺省=直线 |
| 其他 | `dashed=1` 虚线 / `strokeWidth=2` 加粗 / `strokeColor=#...` / `rounded=1` 圆角折点 |
| 出入点 | `exitX/exitY/exitDx/exitDy`、`entryX/entryY/entryDx/entryDy`（0~1） |
| 折点 | `<Array as="points"><mxPoint x=".." y=".."/></Array>` |

推荐边样式串：
`edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;`

## 渲染边界（重要）

- **不支持**：`shape=mxgraph.aws4.*`、`shape=mxgraph.kubernetes.*`、`shape=mxgraph.uml.*`
  等成套 stencil 图标 → 渲染为矩形。不要依赖品牌图标出图。
- 未知 `edgeStyle` 值 → 回退为直线路由（不报错）
- `sketch=1`（手绘风格）不生效，样式按普通渲染
- 文件里出现上述内容**不会损坏**：打开、编辑、另存均正常，只是显示退化

## 需要"图标感"时的替代方案

1. 语义色 + 文字标注（推荐）：用调色板区分角色（见 `xml-authoring.md` 颜色表）
2. `shape=note`/`shape=cylinder3`/`shape=cloud`/`shape=actor` 等拟物形状表达常见概念
3. `image=<URL>;imageAspect=0;` 引用外部图片（用户在有网环境可见；离线导出时可能空白）
