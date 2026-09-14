// editor.js — drawio 绘图台核心：maxgraph 封装（画布/交互/样式）、文档模型（.drawio）、导出。
// 由 ui/index.html（vhtml 组件）消费；XML 编解码逻辑在 drawio-xml.js（可单测）。

import {
  Graph, InternalEvent, getDefaultPlugins, RubberBandHandler, UndoManager, Clipboard,
  ModelXmlSerializer, ImageExport, SvgCanvas2D, TextShape, Shape, ShapeRegistry, CylinderShape,
} from './maxgraph.js'
import {
  parseMxfile, serializeGraphModel, normalizeImportedModel, stringifyStyle, parseStyleString,
  buildMxfile, extractModelAttrs,
} from './drawio-xml.js'

// ---------------------------------------------------------------- 形状补充

class NoteShape extends Shape {
  paintVertexShape(c, x, y, w, h) {
    const size = Math.max(4, Math.min(shapeSize(this, 20), w * 0.5, h * 0.5))
    c.begin()
    c.moveTo(x, y)
    c.lineTo(x + w - size, y)
    c.lineTo(x + w, y + size)
    c.lineTo(x + w, y + h)
    c.lineTo(x, y + h)
    c.close()
    c.fillAndStroke()
    // 折角
    c.begin()
    c.moveTo(x + w - size, y)
    c.lineTo(x + w - size, y + size)
    c.lineTo(x + w, y + size)
    c.stroke()
  }
}

class ParallelogramShape extends Shape {
  paintVertexShape(c, x, y, w, h) {
    const size = Math.max(4, Math.min(shapeSize(this, 20), w * 0.5))
    c.begin()
    c.moveTo(x + size, y)
    c.lineTo(x + w, y)
    c.lineTo(x + w - size, y + h)
    c.lineTo(x, y + h)
    c.close()
    c.fillAndStroke()
  }
}

function shapeSize(shape, dflt) {
  const v = shape.style && shape.style.size
  return typeof v === 'number' && v > 0 ? v : dflt
}

let extrasRegistered = false
export function registerExtras() {
  if (extrasRegistered) return
  extrasRegistered = true

  // maxgraph 0.24 缺陷修复：TextShape.getTextRotation 自递归
  // 上游实现无条件委托 `this.state.shape.getTextRotation()`；当 TextShape 本身作为
  // 主形状（style="text;" 单元格）时 state.shape === this，调用即无限递归爆栈。
  // 修正：仅当 state.shape 是“别的”形状时委托，否则取自身形状旋转（=0）。
  TextShape.prototype.getTextRotation = function () {
    const s = this.state
    if (s && s.shape && s.shape !== this) return s.shape.getTextRotation()
    return this.getShapeRotation()
  }

  ShapeRegistry.add('text', TextShape)
  ShapeRegistry.add('note', NoteShape)
  ShapeRegistry.add('parallelogram', ParallelogramShape)
  ShapeRegistry.add('cylinder3', CylinderShape) // drawio 数据库形状名
}

// drawio 命名样式（baseStyleNames 解析目标，maxgraph 不内置，须自行注册）
function registerNamedStyles(sheet) {
  const named = {
    rectangle: {},
    ellipse: { shape: 'ellipse', perimeter: 'ellipsePerimeter' },
    rhombus: { shape: 'rhombus', perimeter: 'rhombusPerimeter' },
    triangle: { shape: 'triangle', perimeter: 'trianglePerimeter' },
    hexagon: { shape: 'hexagon', perimeter: 'hexagonPerimeter' },
    cylinder: { shape: 'cylinder', perimeter: 'rectanglePerimeter' },
    cloud: { shape: 'cloud' },
    actor: { shape: 'actor' },
    swimlane: { shape: 'swimlane', startSize: 26 },
    text: {
      shape: 'text',
      strokeColor: 'none',
      fillColor: 'none',
      align: 'center',
      verticalAlign: 'middle',
      verticalLabelPosition: 'middle',
      labelPosition: 'center',
    },
    note: { shape: 'note' },
    parallelogram: { shape: 'parallelogram' },
    line: { shape: 'line' },
    image: { shape: 'image' },
    label: { shape: 'label' },
    doubleEllipse: { shape: 'doubleEllipse', perimeter: 'ellipsePerimeter' },
    arrow: { shape: 'arrow' },
    connector: { shape: 'connector' },
    arrowConnector: { shape: 'arrowConnector' },
  }
  for (const [name, style] of Object.entries(named)) sheet.putCellStyle(name, style)
}

// 调色板（分组形状面板）
export const PALETTE_GROUPS = [
  {
    id: 'general',
    items: [
      { kind: 'rectangle', size: [140, 64], style: 'rounded=0;whiteSpace=wrap;html=1;' },
      { kind: 'rounded', size: [140, 64], style: 'rounded=1;whiteSpace=wrap;html=1;arcSize=14;' },
      { kind: 'ellipse', size: [130, 64], style: 'ellipse;whiteSpace=wrap;html=1;' },
      { kind: 'rhombus', size: [130, 72], style: 'rhombus;whiteSpace=wrap;html=1;' },
      { kind: 'triangle', size: [100, 84], style: 'triangle;whiteSpace=wrap;html=1;' },
      {
        kind: 'hexagon',
        size: [130, 64],
        style: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;',
      },
      {
        kind: 'cylinder',
        size: [90, 100],
        style: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
      },
      { kind: 'cloud', size: [130, 76], style: 'shape=cloud;whiteSpace=wrap;html=1;' },
      { kind: 'actor', size: [52, 92], style: 'shape=actor;whiteSpace=wrap;html=1;' },
      {
        kind: 'parallelogram',
        size: [130, 64],
        style: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
      },
      { kind: 'note', size: [130, 84], style: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=16;' },
      { kind: 'text', size: [110, 30], style: 'text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;' },
      {
        kind: 'swimlane',
        size: [220, 140],
        style: 'swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=26;horizontalStack=0;resizeParent=1;resizeParentMax=0;html=1;',
      },
    ],
  },
]

export function findPaletteItem(kind) {
  for (const g of PALETTE_GROUPS) {
    for (const it of g.items) if (it.kind === kind) return it
  }
  return null
}

// ---------------------------------------------------------------- 编辑器

const SCALE_MIN = 0.1
const SCALE_MAX = 8
const FONT_BOLD = 1
const FONT_ITALIC = 2
const FONT_UNDERLINE = 4

export function createEditor(container, opts = {}) {
  const notify = typeof opts.onChange === 'function' ? opts.onChange : () => {}
  registerExtras()

  const graph = new Graph(container, undefined, [...getDefaultPlugins(), RubberBandHandler])
  graph.setPanning(true)
  graph.setTooltips(true)
  graph.setConnectable(true)
  graph.setCellsEditable(true)
  graph.setGridSize(10)
  graph.setGridEnabled(true) // 吸附网格
  graph.setAllowDanglingEdges(true) // 允许边悬空
  InternalEvent.disableContextMenu(container)

  const model = graph.getDataModel()
  const view = graph.getView()
  const sheet = graph.getStylesheet()

  // drawio 风格默认配色（覆盖 maxgraph 内置的 mxGraph 老配色）
  Object.assign(sheet.getDefaultVertexStyle(), {
    fillColor: '#ffffff',
    strokeColor: '#000000',
    fontColor: '#000000',
    fontSize: 12,
    fontFamily: 'Helvetica, Arial, sans-serif',
  })
  Object.assign(sheet.getDefaultEdgeStyle(), {
    strokeColor: '#000000',
    fontColor: '#000000',
    fontSize: 12,
    fontFamily: 'Helvetica, Arial, sans-serif',
  })
  registerNamedStyles(sheet)

  // ---- 撤销 ----
  const undoManager = new UndoManager()
  const onUndoableEdit = (_sender, evt) => {
    const edit = evt.getProperty('edit')
    if (edit) undoManager.undoableEditHappened(edit)
  }
  model.addListener(InternalEvent.UNDO, onUndoableEdit)
  view.addListener(InternalEvent.UNDO, onUndoableEdit)

  // ---- 状态 ----
  let doc = freshDoc()
  let dirty = false
  let loading = false

  function freshDoc() {
    return { path: '', name: '', pageAttrs: {}, mxfileAttrs: {}, modelAttrs: {}, otherPages: [] }
  }

  model.addListener(InternalEvent.CHANGE, () => {
    if (!loading) {
      dirty = true
      notify('model')
    }
  })
  graph.getSelectionModel().addListener(InternalEvent.CHANGE, () => notify('selection'))
  const onViewChange = () => notify('view')
  view.addListener(InternalEvent.SCALE, onViewChange)
  view.addListener(InternalEvent.TRANSLATE, onViewChange)
  view.addListener(InternalEvent.SCALE_AND_TRANSLATE, onViewChange)

  // ---- 结构辅助 ----
  function layer() {
    const root = model.getRoot()
    return (root && root.children && root.children[0]) || root
  }

  function syncRoot() {
    view.setCurrentRoot(model.getRoot())
  }

  function isEmptyDiagram() {
    let n = 0
    const root = model.getRoot()
    const walk = (c) => {
      for (const ch of c.children || []) {
        if (ch.vertex || ch.edge) n++
        walk(ch)
      }
    }
    if (root) walk(root)
    return n === 0
  }

  function afterRootSwap() {
    syncRoot()
    graph.clearSelection()
    graph.view.validate()
    pruneOrphanStates()
    fit()
    undoManager.clear()
    dirty = false
    notify('load')
  }

  // 全量销毁现有渲染状态及其 DOM。maxgraph 0.24 的 GraphView 只负责“补齐可达
  // cell 的 state”（validate 不清理脱离根树的旧 state），换文档（model.clear/换根）后
  // 旧图形的渲染节点会滞留在画布上（渲染残影，整页刷新才消失）。替换内容前主动清空。
  function destroyAllStates() {
    const states = view.states
    if (!states || typeof states.forEach !== 'function') return
    const cells = []
    states.forEach((_state, cell) => cells.push(cell))
    for (const cell of cells) {
      try {
        view.removeState(cell)
      } catch (e) {
        // 单个清理失败不阻断
      }
    }
  }

  // 兜底清理：移除不挂在当前根树上的渲染状态（正常流程下为空操作）
  function pruneOrphanStates() {
    const states = view.states
    if (!states || typeof states.forEach !== 'function') return
    const root = model.getRoot()
    if (!root) return
    const reachable = new Set()
    const walk = (cell) => {
      reachable.add(cell)
      const n = cell.getChildCount()
      for (let i = 0; i < n; i += 1) walk(cell.getChildAt(i))
    }
    walk(root)
    const stale = []
    states.forEach((_state, cell) => {
      if (!reachable.has(cell)) stale.push(cell)
    })
    for (const cell of stale) {
      try {
        view.removeState(cell)
      } catch (e) {
        // 单个清理失败不阻断
      }
    }
  }

  // ---- 新建 / 载入 ----
  function newDoc(name) {
    loading = true
    try {
      destroyAllStates()
      model.clear()
      const root = model.getRoot()
      root.setId('0')
      const l = root.children && root.children[0]
      if (l) l.setId('1')
      model.nextId = 2
    } finally {
      loading = false
    }
    doc = freshDoc()
    doc.name = name || ''
    afterRootSwap()
  }

  function load(text, meta = {}) {
    const parsed = parseMxfile(text)
    const page = parsed.pages[0]
    loading = true
    try {
      destroyAllStates()
      model.clear()
      new ModelXmlSerializer(model).import(page.xml)
      normalizeImportedModel(model)
    } finally {
      loading = false
    }
    doc = {
      path: meta.path || '',
      name: page.name || '',
      pageAttrs: { ...(page.attrs || {}) },
      mxfileAttrs: parsed.mxfileAttrs || {},
      modelAttrs: extractModelAttrs(page.xml),
      otherPages: parsed.pages.slice(1).map((p) => ({
        attrs: p.attrs,
        rawContent: p.compressed ? p.rawText : p.xml,
      })),
    }
    afterRootSwap()
    return { name: doc.name, path: doc.path }
  }

  // ---- 序列化 ----
  function getModelXml() {
    return serializeGraphModel(model, { attrs: doc.modelAttrs })
  }

  function getXml() {
    const pages = [
      { xml: getModelXml(), name: doc.name || 'Page-1', attrs: doc.pageAttrs },
      ...doc.otherPages.map((p) => ({ rawContent: p.rawContent, attrs: p.attrs })),
    ]
    return buildMxfile({ pages, mxfileAttrs: doc.mxfileAttrs })
  }

  // ---- 缩放 / 视图 ----
  function clampScale(v) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, v))
  }

  // maxgraph 渲染约定：render = scale × (model + translate)
  // （依据 GraphView：state.x = scale*(translate.x + origin.x)、transformControlPoint 同形；
  //  translate 位于缩放内层）——屏幕（容器局部）→ 模型：screen / scale − translate。
  function screenToModel(sx, sy) {
    const t = view.getTranslate()
    const s = view.getScale()
    return [sx / s - t.x, sy / s - t.y]
  }

  function centerOfView() {
    const rect = container.getBoundingClientRect()
    return screenToModel(rect.width / 2, rect.height / 2)
  }

  function zoomAt(factor, cx, cy) {
    const s = view.getScale()
    const ns = clampScale(s * factor)
    if (ns === s) return
    const [px, py] = screenToModel(cx, cy)
    // 新平移满足 render' = ns*(model + t') = cx：光标下的模型点保持不动
    view.scaleAndTranslate(ns, cx / ns - px, cy / ns - py)
  }

  const onWheel = (e) => {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const d = Math.max(-150, Math.min(150, e.deltaY))
    zoomAt(Math.pow(1.18, -d / 120), e.clientX - rect.left, e.clientY - rect.top)
  }
  container.addEventListener('wheel', onWheel, { passive: false })

  function fit() {
    if (isEmptyDiagram()) {
      view.scaleAndTranslate(1, 60, 60)
      return 1
    }
    const plugin = graph.getPlugin('fit')
    if (plugin) return plugin.fit({ margin: 16 })
    return view.getScale()
  }

  function setScale(scale) {
    graph.zoomTo(clampScale(scale), false)
  }

  // ---- 编辑动作 ----
  function insertShape(kind, at) {
    const def = findPaletteItem(kind)
    if (!def) throw new Error('未知形状: ' + kind)
    const [w, h] = def.size
    const [cx, cy] = at || centerOfView()
    let cell = null
    graph.batchUpdate(() => {
      cell = graph.insertVertex({
        parent: layer(),
        value: '',
        position: [Math.round(cx - w / 2), Math.round(cy - h / 2)],
        size: [w, h],
        // 样式必须转成对象：maxgraph 仅在 mxCell 导入时做样式串→对象转换
        // （mxCellCodec.decodeAttribute→convertStyleFromString），insertVertex 会原样
        // 存字符串；渲染端 Stylesheet.getCellStyle 按对象处理，字符串会导致样式全部
        // 失效（形状退化为默认矩形）。这里与导入路径对齐。
        style: parseStyleString(def.style),
      })
      graph.setSelectionCells([cell])
    })
    return cell
  }

  function removeSelection() {
    const cells = graph.getSelectionCells()
    if (cells.length) graph.removeCells(cells)
  }

  function copySelection() {
    return Clipboard.copy(graph)
  }

  function cutSelection() {
    return Clipboard.cut(graph)
  }

  function pasteClipboard() {
    if (Clipboard.isEmpty()) return null
    let inserted = null
    model.beginUpdate()
    try {
      const cells = graph.getImportableCells(Clipboard.getCells())
      if (cells.length) {
        const delta = Math.max(1, Clipboard.insertCount) * Clipboard.STEPSIZE
        inserted = graph.importCells(cells, delta, delta, layer())
        graph.setSelectionCells(inserted)
      }
    } finally {
      model.endUpdate()
    }
    Clipboard.insertCount++
    return inserted
  }

  function selectAllShapes() {
    const cells = []
    const root = model.getRoot()
    const walk = (c) => {
      for (const ch of c.children || []) {
        if (ch.vertex || ch.edge) cells.push(ch)
        walk(ch)
      }
    }
    if (root) walk(root)
    graph.setSelectionCells(cells)
  }

  function undo() {
    if (undoManager.canUndo()) undoManager.undo()
  }

  function redo() {
    if (undoManager.canRedo()) undoManager.redo()
  }

  // ---- 样式 ----
  function rawStyle(cell) {
    const s = cell.getStyle()
    if (typeof s === 'string') return parseStyleString(s)
    return s ? { ...s } : {}
  }

  function setStyleKey(key, value) {
    const cells = graph.getSelectionCells()
    if (!cells.length) return
    graph.setCellStyles(key, value, cells)
  }

  function setLabel(text) {
    const cells = graph.getSelectionCells()
    if (!cells.length) return
    model.beginUpdate()
    try {
      for (const c of cells) graph.labelChanged(c, text)
    } finally {
      model.endUpdate()
    }
  }

  function markSaved(path) {
    doc.path = path || doc.path
    dirty = false
    notify('doc')
  }

  function toggleFontStyleFlag(flag) {
    const cells = graph.getSelectionCells()
    if (!cells.length) return
    graph.setCellStyleFlags('fontStyle', flag, null, cells)
  }

  function setFontFlag(flag, on) {
    const cells = graph.getSelectionCells()
    if (!cells.length) return
    graph.setCellStyleFlags('fontStyle', flag, !!on, cells)
  }

  function setBaseShape(shapeKey) {
    const cells = graph.getSelectionCells().filter((c) => c.vertex)
    if (!cells.length) return
    model.beginUpdate()
    try {
      for (const cell of cells) {
        const obj = rawStyle(cell)
        if (shapeKey && shapeKey.indexOf('shape=') === 0) {
          delete obj.baseStyleNames
          obj.shape = shapeKey.slice('shape='.length)
        } else {
          delete obj.shape
          if (shapeKey) obj.baseStyleNames = [shapeKey]
          else delete obj.baseStyleNames
        }
        graph.setCellStyle(obj, [cell])
      }
    } finally {
      model.endUpdate()
    }
  }

  function selectionDetail() {
    const sel = graph.getSelectionCells()
    if (!sel.length) return null
    const cell = sel[0]
    return {
      id: cell.getId(),
      value: cell.value == null ? '' : cell.value,
      vertex: !!cell.vertex,
      edge: !!cell.edge,
      raw: rawStyle(cell),
      computed: graph.getCellStyle(cell),
    }
  }

  // ---- 导出 ----
  function buildSvgRoot(fo, padding) {
    const bounds = graph.getGraphBounds()
    const pad = padding == null ? 8 : padding
    const w = Math.max(1, Math.ceil(bounds.width + pad * 2))
    const h = Math.max(1, Math.ceil(bounds.height + pad * 2))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    svg.setAttribute('version', '1.1')
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    svg.setAttribute('viewBox', `${Math.floor(bounds.x - pad)} ${Math.floor(bounds.y - pad)} ${w} ${h}`)
    // 注意：必须 styleEnabled=false。导出 SVG 是同文档游离节点，maxgraph 的导出
    // 样式表注入分支（ownerDocument!==document）不会执行；若开启 style 模式，无
    // fill 属性的开放路径（边、无填充形状）会按 SVG 默认值被填成黑色——带折点的
    // 连线会出现黑色三角。关闭后所有路径显式写出 fill/stroke 属性（fill="none"），
    // 导出文件自洽，不依赖内嵌样式表。
    const canvas = new SvgCanvas2D(svg, false)
    canvas.foEnabled = fo !== false
    canvas.foAltText = ''
    return { svg, canvas, w, h }
  }

  function drawExportedContent(svg, canvas, withBackground) {
    // 默认不加背景（导出透明，与页面一致——不添加背景颜色）；
    // 需要白底时由调用方显式传 { background: true }。
    if (withBackground === true) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', '0')
      rect.setAttribute('y', '0')
      rect.setAttribute('width', '100%')
      rect.setAttribute('height', '100%')
      rect.setAttribute('fill', '#ffffff')
      svg.insertBefore(rect, svg.firstChild)
    }
    const state = view.getState(view.currentRoot || model.getRoot())
    if (state) new ImageExport().drawState(state, canvas)
  }

  // 导出统一在 1:1 视图缩放下渲染。导出坐标 = (模型坐标 + 视图平移) × 视图缩放，
  // 直接导出会让分辨率跟随当前画布缩放（窗口小/缩小视图时导出的图很小、看起来糊；
  // 放大时又过大）。做法：临时把视图缩放置 1 并同步重校验（形状/文本以 1:1 重建），
  // 渲染序列化完成后同步恢复原缩放——同一帧内完成，页面无闪烁。
  function renderExportSvg(o = {}) {
    const scale = view.getScale()
    const t = view.getTranslate()
    const tx = t.x
    const ty = t.y
    const render = () => {
      const { svg, canvas, w, h } = buildSvgRoot(o.fo !== false, o.padding)
      drawExportedContent(svg, canvas, o.background)
      return { svgText: new XMLSerializer().serializeToString(svg), w, h }
    }
    if (scale === 1) return render()
    try {
      view.scaleAndTranslate(1, tx, ty)
      return render()
    } finally {
      view.scaleAndTranslate(scale, tx, ty)
    }
  }

  function exportSvgString(o = {}) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderExportSvg(o).svgText
  }

  async function exportPngBlob(o = {}) {
    // 位图导出用纯文本标签（foreignObject 经 img/canvas 通道兼容性差）
    const { svgText, w, h } = renderExportSvg({ ...o, fo: false })
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('PNG 导出：SVG 渲染失败'))
        img.src = url
      })
      const scale = o.scale == null ? 2 : o.scale
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(w * scale))
      cv.height = Math.max(1, Math.round(h * scale))
      const ctx = cv.getContext('2d')
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      return await new Promise((resolve) => cv.toBlob(resolve, 'image/png'))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // ---- 状态查询 ----
  function state() {
    const sel = graph.getSelectionCells()
    const kind = !sel.length
      ? 'none'
      : sel.every((c) => c.edge)
        ? 'edge'
        : sel.every((c) => c.vertex)
          ? 'vertex'
          : 'mixed'
    let vertices = 0
    let edges = 0
    const root = model.getRoot()
    const walk = (c) => {
      for (const ch of c.children || []) {
        if (ch.vertex) vertices++
        if (ch.edge) edges++
        walk(ch)
      }
    }
    if (root) walk(root)
    const t = view.getTranslate()
    return {
      path: doc.path,
      name: doc.name,
      dirty,
      scale: view.getScale(),
      tx: t.x,
      ty: t.y,
      canUndo: undoManager.canUndo(),
      canRedo: undoManager.canRedo(),
      selCount: sel.length,
      selKind: kind,
      vertices,
      edges,
    }
  }

  function destroy() {
    container.removeEventListener('wheel', onWheel)
    try {
      if (typeof graph.destroy === 'function') graph.destroy()
    } catch (e) {
      // 销毁失败不阻断
    }
  }

  return {
    graph,
    newDoc,
    load,
    getXml,
    getModelXml,
    fit,
    setScale,
    getScale: () => view.getScale(),
    screenToModel, // 屏幕（容器局部）→ 模型坐标，拖放等页面交互使用
    zoomIn: () => graph.zoomIn(),
    zoomOut: () => graph.zoomOut(),
    zoomActual: () => graph.zoomActual(),
    isEmptyDiagram,
    insertShape,
    removeSelection,
    copySelection,
    cutSelection,
    pasteClipboard,
    selectAllShapes,
    undo,
    redo,
    setStyleKey,
    setLabel,
    toggleFontStyleFlag,
    setFontFlag,
    setBaseShape,
    selectionDetail,
    markSaved,
    exportSvgString,
    exportPngBlob,
    state,
    destroy,
    FONT: { BOLD: FONT_BOLD, ITALIC: FONT_ITALIC, UNDERLINE: FONT_UNDERLINE },
  }
}

export { stringifyStyle }
