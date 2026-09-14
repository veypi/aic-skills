# 图形类型与布局套路

按请求的图形类型选择下面的套路。合成语法（id/geometry/样式/转义）见 `xml-authoring.md`。

## 流程图（Flowchart）

- 起点/终点用 `ellipse;`，步骤用 `rounded=1;`，判断用 `rhombus;`，输入/输出可用 `shape=parallelogram;`
- 自上而下排布：每行 y 递增（行距 100~140），判断分支向两侧展开再汇合
- 样式加 `whiteSpace=wrap;html=1;`，文字太长用 `&#xa;` 折行

```xml
<mxCell id="2" value="开始" style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
  <mxGeometry x="180" y="40" width="120" height="50" as="geometry"/>
</mxCell>
<mxCell id="3" value="检查依赖" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="160" y="150" width="160" height="60" as="geometry"/>
</mxCell>
<!-- 连线：见 xml-authoring.md 的边规范；垂直连线钉 exitX=0.5;exitY=1;entryX=0.5;entryY=0 -->
```

## 分层架构 / 数据流（Architecture / Pipeline）

- 按层/阶段分行（或分列），每行节点等距；层间距 ≥80px 留走线走廊
- 服务 `rounded=1`（蓝/紫），数据库 `shape=cylinder3`（绿/灰），网关/队列用橙/黄
- 相邻层之间连正交边；跨层连线走外侧走廊
- 3 种以上语义色时在角落加图例（见 `xml-authoring.md` 的 Legend 段）

## C4 风格（简化：Context / Container）

- 人 → `shape=actor;`；系统 → `rounded=1` 大框 + 标题加粗 `fontStyle=1;fontSize=14;`
- 外部系统用 `dashed=1` 或灰色；连线带文字说明（协议/关系）
- 系统容器内放子容器（`swimlane;startSize=30;`），子元素坐标相对容器

## 思维导图 / 树（Mindmap / Tree）

- 根节点居中（圆角矩形/椭圆，字号加大），一级分支环绕或左右分布
- 分支连线用 `edgeStyle=entityRelationEdgeStyle;curved=1;endArrow=none;startArrow=none;`（弧线无箭头）
- 同级节点等距；层级越深字号越小（根 16 / 一级 14 / 二级 12）
- 节点多时按象限规划（右上、右下、左上、左下各一组）

## 泳道流程（Cross-Functional Swimlane）

- 用 `swimlane;startSize=30;` 作横向/纵向泳道容器；子元素坐标**相对泳道**
- 泳道内步骤为普通圆角矩形；跨泳道的连线直接以 source/target 引用两侧形状
- 泳道宽度取内容行高 + 边距；标题横向 `horizontal=1;`（默认）

## 时序图（简化版）

- 顶部用圆角矩形放参与者名；每列下方一条细长矩形（宽 2px，`fillColor=#666666;strokeColor=none;`）作生命线
- 消息箭头为水平连线：`endArrow=classic;html=1;`（返回虚线上加 `dashed=1;endArrow=open;`）
- 自调用画一个小回环（source=target 相同的边，给 `<Array as="points">` 折点）
- 激活条：生命线上叠一个白色窄矩形（宽 10px、`fillColor=none;` 视需要）

## ER 图（简化版）

- 实体用 `swimlane;startSize=26;`（标题=表名），字段行为其子元素：`text;html=1;align=left;verticalAlign=middle;` 一行一个
- 关系连线 `edgeStyle=entityRelationEdgeStyle;html=1;endArrow=none;startArrow=none;`，标注 `1:N` 等
- 实体间距 ≥120px；连线出入点钉在实体两侧

## 网络拓扑（简化）

- 互联网 `shape=cloud;`、终端/人 `shape=actor;`、服务器/设备用矩形或圆柱
- 分区用 `group;pointerEvents=0;` 或虚框容器（`rounded=0;dashed=1;fillColor=none;`）
- 连线标注链路/带宽；同层设备水平排列

## 通用收尾检查

- 所有坐标 10 的整数倍；行/列对齐
- 每个形状都能被一条连线路径"看见"：先连线后检查是否有线穿过无关形状
- 图尺寸与 pageWidth/pageHeight 相称（默认 850×1100；宽图可在 mxGraphModel 上调大 pageWidth 或去掉 page 属性让画布自由）
