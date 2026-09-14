# drawio XML 编写规范（AI 出图手册）

适用：直接用 fs 工具编写 `.drawio` 文件，交给 DrawIO 绘图台渲染展示。先读本文件；
形状词汇表见 `shapes.md`，图形类型与布局套路见 `diagram-types.md`，配色预设见 `style-presets.md`。

## 文件骨架（推荐不压缩）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="NDrawio" version="24">
  <diagram name="Page-1">
    <mxGraphModel grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- 用户形状从 id="2" 起，逐个递增 -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

规则：

- `id="0"` 与 `id="1"` 是必需的根/层单元格，**不可省略**
- 形状 id 从 `"2"` 起递增（数字字符串即可；根因：新建单元格的自动 id 也对齐最大数字 id）
- 普通形状 `parent="1"`；容器子元素 `parent="<容器id>"`
- 文本须带 `html=1`；值内换行用 `&#xa;`；属性值转义 `&amp;` `&lt;` `&gt;` `&quot;`
- XML 注释内**禁用 `--`**（非法字符，会解析失败）
- 本绘图台保存默认**不压缩**；读取压缩文件（`compressed="true"`）没有问题

## 顶点（形状）

```xml
<!-- 矩形 / 圆角矩形 -->
<mxCell id="2" value="服务" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="160" height="60" as="geometry" />
</mxCell>

<!-- 数据库圆柱 -->
<mxCell id="3" value="DB" style="shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;" vertex="1" parent="1">
  <mxGeometry x="350" y="100" width="120" height="80" as="geometry" />
</mxCell>

<!-- 判断菱形 -->
<mxCell id="4" value="检查?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
  <mxGeometry x="100" y="220" width="160" height="80" as="geometry" />
</mxCell>
```

常用样式键：`fillColor` `strokeColor` `strokeWidth` `dashed=1` `rounded=1` `arcSize` `fontColor`
`fontSize` `fontStyle`（1 粗 2 斜 4 下划线，可相加）`align` `verticalAlign` `shadow=1`。
能稳定渲染的形状集（**本绘图台**）：矩形/圆角矩形、`ellipse`、`rhombus`、`triangle`、
`hexagon`、`shape=cylinder3`、`shape=cloud`、`shape=actor`、`shape=parallelogram`、
`shape=note`、`text`、`swimlane`、`line`。其余 `shape=mxgraph.*` 等 stencil 名称在本绘图台
**退化为矩形**（文件仍可打开、可编辑，只是无图标）——见 `shapes.md` 的边界说明。

## 容器 / 泳道 / 分组

嵌套结构用 drawio 父子包含（不要用大矩形叠小矩形冒充）：

| 类型 | 样式 | 用途 |
| --- | --- | --- |
| 泳道（带标题栏） | `swimlane;startSize=30;` | 有可见标题的容器 |
| 分组（不可见） | `group;pointerEvents=0;` | 无边框的逻辑分组 |
| 自定义容器 | 任意形状加 `container=1;pointerEvents=0;` | 形状本身兼作容器 |

```xml
<mxCell id="svc1" value="用户服务" style="swimlane;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<!-- 子元素坐标相对容器 -->
<mxCell id="api1" value="REST API" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="svc1">
  <mxGeometry x="20" y="40" width="120" height="60" as="geometry"/>
</mxCell>
```

## 连线（边）

**必须带** `<mxGeometry relative="1" as="geometry" />`——自闭合的边单元格不渲染。

```xml
<!-- 常规带箭头连线（推荐样式串，路由更干净） -->
<mxCell id="10" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="2" target="3">
  <mxGeometry relative="1" as="geometry" />
</mxCell>

<!-- 带标注 + 显式出入点控制方向 -->
<mxCell id="11" value="HTTP" style="edgeStyle=orthogonalEdgeStyle;rounded=1;jettySize=auto;html=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="2" target="4">
  <mxGeometry relative="1" as="geometry" />
</mxCell>

<!-- 绕行折点 -->
<mxCell id="12" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;jettySize=auto;html=1;" edge="1" parent="1" source="3" target="5">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="500" y="50" />
    </Array>
  </mxGeometry>
</mxCell>
```

要点：

- 无箭头：`endArrow=none;`；起点箭头：`startArrow=classic;`（可选值 `classic/open/block/oval/diamond/none`）
- 同一形状有 2 条以上连线时，**必须**钉出/入点分摊（exitX/exitY、entryX/entryY，取值 0~1）
- 箭头末端直线段留 ≥20px，否则箭头与折点重叠
- 需要绕开中间形状时加 `<Array as="points">` 折点
- 折线样式：`edgeStyle=orthogonalEdgeStyle`（正交）/ `entityRelationEdgeStyle`（ER 无箭头）/ `elbowEdgeStyle` / 缺省直线

## 颜色（语义配色）

| 语义 | fillColor | strokeColor | 用途 |
| --- | --- | --- | --- |
| 蓝 | `#dae8fc` | `#6c8ebf` | 服务、客户端 |
| 绿 | `#d5e8d4` | `#82b366` | 成功、数据库 |
| 黄 | `#fff2cc` | `#d6b656` | 队列、决策 |
| 橙 | `#ffe6cc` | `#d79b00` | 网关、API |
| 红 | `#f8cecc` | `#b85450` | 错误、告警 |
| 灰 | `#f5f5f5` | `#666666` | 外部、中性 |
| 紫 | `#e1d5e7` | `#9673a6` | 安全、认证 |

## 布局规范

- **网格对齐**：x/y/width/height 取 10 的整数倍
- **间距随复杂度**：≤5 节点 200×150；6–10 节点 280×200；>10 节点 350×250
- 行/列之间留 ~80px 走线走廊，走廊内不放形状
- 先排网格再落坐标：分层图按行分层、只连相邻层；星形图 hub 居中、卫星环绕
- 高连接度节点放中心，减少交叉；同层水平连线（exitX=1 / exitX=0）不易交叉
- 直线垂直连线：`exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0`

## 与本绘图台的约定

- 文件默认放 `/u/{uid}/drawio/`（约定目录，非强制；任意 `$fs` 路径均可）
- 写完文件后调用 `drawio_open --path <路径>` 让页面加载展示；用户可直接在画布上继续编辑
- 多页文件：页面只编辑第一页，其余页原样保留
- 品牌图标（AWS/K8s 等）本版不渲染为图标；如需品牌视觉，可用 `image=<图片URL>;imageAspect=0;` 引用外部图片（注意目标环境需能访问该 URL）
