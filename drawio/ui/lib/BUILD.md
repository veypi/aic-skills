# maxgraph 内核构建说明

`maxgraph.js` 是由 npm 依赖打包出的浏览器单文件 ESM 内核（约 640 KB），与两个手写
配套模块（`drawio-xml.js` 格式层、`editor.js` 编辑器核心）组成绘图台前端。

## 构成

- `@maxgraph/core@0.24.0`（Apache-2.0，drawio 上游 mxGraph 官方现代版）
- `fflate`（MIT，解码 compressed 图的 raw-deflate/zlib）
- 打包方式：esbuild，`--bundle --format=esm --minify --target=es2020 --legal-comments=none`

entry 内容：

```js
export * from '@maxgraph/core'
import * as fflate from 'fflate'
export { fflate }
```

## 重建步骤（在装有 node/npm 的机器上）

```bash
mkdir -p build && cd build
npm init -y >/dev/null
npm i @maxgraph/core esbuild fflate
printf "export * from '@maxgraph/core';\nimport * as fflate from 'fflate';\nexport { fflate };\n" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=maxgraph.js
```

产物 `maxgraph.js` 覆盖到本目录。更新 maxgraph 版本后请回归：

1. `drawio-xml.js` 解析 → maxgraph 导入 → 本模块序列化的**往返测试**（幂等：两次
   序列化字符串一致；cell 数量/id 序列一致）
2. 压缩图解码（raw-deflate 与 zlib 两种包装）
3. 编辑器在真实浏览器中的基本操作（打开/插入/连线/保存/导出）

## 备注

- 打包体积接受度：与平台其他技能（three.js 1.3MB、wasm 内核等）同级
- 内置运行时补丁：`TextShape.getTextRotation` 自递归修复（maxgraph 0.24 上游缺陷，
  见 `editor.js` 的 registerExtras；`style="text;"` 单元格渲染不再爆栈）
- 导出补丁：导出画布以 `SvgCanvas2D(svg, false)` 构造（`editor.js` 的 `buildSvgRoot`）。
  同文档游离 SVG 拿不到 maxgraph 的导出样式表（`svg{fill:none}`），style 模式下无
  fill 属性的开放路径会被 SVG 默认值填黑（带折点的连线呈黑色三角）；关闭后所有
  路径显式写出 fill/stroke 属性，SVG/PNG 导出自洽
- 导出补丁（分辨率）：`renderExportSvg` 在渲染前临时把视图缩放置 1（同步重校验、
  渲染完成后原样恢复，同帧完成无闪烁），SVG/PNG 共用该入口。导出坐标 = (模型坐标
  + 视图平移) × 视图缩放，原先导出分辨率会跟随窗口大小/画布缩放（fit 缩小时导出
  的图很小、放大时过大），现固定 1:1 输出（PNG 再按 2× 位图化）
- 导出补丁（背景）：导出默认不带背景（透明）——与页面一致，不添加背景颜色。
  `drawExportedContent` 仅在调用方显式传 `{ background: true }` 时添加白底矩形
- 插入补丁（样式对象）：`insertShape` 传样式前经 `parseStyleString` 转样式对象
  （`editor.js`）。maxgraph 0.24 仅在 mxCell 导入时做样式串→对象转换（`mxCellCodec
  .decodeAttribute`→`convertStyleFromString`），`insertVertex` 会原样存字符串；
  渲染端 `Stylesheet.getCellStyle` 按对象处理，字符串会让样式全部失效（调色板拖入
  的形状退化为默认矩形）。转换函数与 maxgraph 语义逐项一致（autosize→autoSize、
  数值转换、baseStyleNames、ignoreDefaultStyle）
- 坐标补丁（变换约定）：maxgraph 渲染约定为 render = scale × (model + translate)
  （先平移后缩放；依据 GraphView 的 state.x / transformControlPoint，本文档导出分辨率
  条目同述）。编辑器原先在 centerOfView / zoomAt / 拖放落点使用
  (screen − translate) / scale 的逆变换，导致缩放 ≠ 100% 时“添加/拖入元素”落点向鼠标
  左上（缩放<1）或右下（缩放>1）偏移，幅度 ≈ translate × (1 − scale)；滚轮缩放也会
  沿光标漂移。修复：`editor.js` 增加 `screenToModel`（screen / scale − translate），
  `centerOfView`/`zoomAt` 与页面 `onDrop`、网格相位统一走该换算
- 渲染残影修复：maxgraph 0.24 的 `GraphView.validate` 只补齐可达 cell 的 state、不清理
  已脱离（新）根树的旧 state——打开/新建（model.clear/换根）后旧图形的渲染节点会滞留
  画布（“幽灵图形”，整页刷新才消失）。修复：换文档前 `destroyAllStates()` 全量销毁现有
  state+DOM，换完后 `afterRootSwap` 追加 `pruneOrphanStates()` 兜底清理
- 若需精简体积：maxgraph 可 tree-shake（改用 BaseGraph + 按需注册），当前为开发
  便利保留全量导出
