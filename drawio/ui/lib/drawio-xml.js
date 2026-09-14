// drawio-xml.js — drawio 文件格式工具（纯函数，供编辑器与 node 测试复用）
//
// 职责：
//   1. mxfile / mxGraphModel 解析：拆出页面列表与 mxGraphModel XML（含 compressed 图解码，
//      raw-deflate 与 zlib 两种包装都兼容）
//   2. GraphDataModel → drawio 兼容 XML 序列化（扁平 mxCell + parent 引用）
//   3. 样式串 <-> 样式对象 转换（camelCase key 与 drawio 一致，autosize 特殊映射）
//
// 约定（与 drawio 桌面版互通）：新文档不压缩（可读、可 diff）；读取压缩文件后按页解码。
// 依赖 ./maxgraph.js（fflate）；DOM 解析使用全局 DOMParser（浏览器原生 / node 测试注入 shim）。

import { fflate } from './maxgraph.js'

const { strToU8, strFromU8, unzlibSync, inflateSync, deflateSync } = fflate

// ---------------------------------------------------------------- XML 文本

export function escapeXmlText(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])
}

export function escapeXmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

function readAttrs(el) {
  const out = {}
  for (const a of el.attributes) out[a.name] = a.value
  return out
}

function childElements(el) {
  const out = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n)
  return out
}

function firstElement(el) {
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) return n
  return null
}

// 元素 → XML 字符串（浏览器 XMLSerializer / xmldom toString）
function serializeElement(el) {
  if (typeof XMLSerializer !== 'undefined') return new XMLSerializer().serializeToString(el)
  return el.toString()
}

// 递归收集元素内全部文本（xmldom 的 textContent 不递归后代文本，浏览器实现亦兼容此写法）
function elementText(el) {
  let out = ''
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 4) out += c.data || ''
      else if (c.nodeType === 1) walk(c)
    }
  }
  walk(el)
  return out
}

function attrString(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
    .join(' ')
}

// ---------------------------------------------------------------- 压缩图

function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function inflateBytes(bytes) {
  // drawio 默认 raw deflate；历史/变体也有 zlib 包装，按魔数优先、互备兜底
  const attempts = bytes.length > 1 && bytes[0] === 0x78 ? [unzlibSync, inflateSync] : [inflateSync, unzlibSync]
  let lastErr = null
  for (const fn of attempts) {
    try {
      return fn(bytes)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error('drawio: 压缩内容解压失败（' + (lastErr && lastErr.message) + '）')
}

// 解码 <diagram> 内容（compressed 属性或未压缩文本）
export function decodeDiagramContent(el) {
  if (el.getAttribute('compressed') === 'true') {
    const raw = elementText(el).trim()
    let xmlText = strFromU8(inflateBytes(base64ToBytes(raw)))
    try {
      xmlText = decodeURIComponent(xmlText)
    } catch (e) {
      // 内容未做 URI 编码，原样使用
    }
    return xmlText
  }
  // 未压缩：内容在子元素标记里（文本节点只有空白），需序列化子元素
  const inner = firstElement(el)
  return inner ? serializeElement(inner).trim() : elementText(el).trim()
}

// 生成压缩后的 diagram 内容文本（当前仅在测试/工具链中使用；编辑器默认保存不压缩）
export function compressDiagramContent(xml) {
  const bytes = deflateSync(strToU8(encodeURIComponent(xml)))
  return bytesToBase64(bytes)
}

// ---------------------------------------------------------------- mxfile 解析

/**
 * 解析 .drawio 文本。
 * 返回 { mxfileAttrs, pages: [{ name, attrs, xml, rawText, compressed }] }
 *  - xml: 解码后的 mxGraphModel XML 文本（第一个页面即编辑对象）
 *  - rawText / attrs: 原始携带信息，用于保存时无损保留其他页面（多页文件）
 */
export function parseMxfile(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '')
  if (!src.trim()) throw new Error('drawio: 文件为空')
  let doc
  try {
    doc = new DOMParser().parseFromString(src, 'text/xml')
  } catch (e) {
    throw new Error('drawio: XML 解析失败（' + (e && e.message) + '）')
  }
  const root = doc && doc.documentElement
  if (!root || root.nodeName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('drawio: XML 解析失败（不是合法 XML）')
  }
  if (root.nodeName === 'mxGraphModel') {
    return {
      mxfileAttrs: {},
      pages: [{ name: 'Page-1', attrs: {}, xml: src.trim(), rawText: src.trim(), compressed: false }],
    }
  }
  if (root.nodeName !== 'mxfile') {
    throw new Error('drawio: 不是 drawio 文件（根元素为 ' + root.nodeName + '）')
  }
  const pages = []
  for (const el of childElements(root)) {
    if (el.nodeName !== 'diagram') continue
    const compressed = el.getAttribute('compressed') === 'true'
    const rawText = compressed ? elementText(el).trim() : ''
    pages.push({
      name: el.getAttribute('name') || '',
      attrs: readAttrs(el),
      xml: decodeDiagramContent(el),
      rawText,
      compressed,
    })
  }
  if (!pages.length) throw new Error('drawio: 文件中没有 diagram 页面')
  return { mxfileAttrs: readAttrs(root), pages }
}

const MXFILE_DEFAULT_ATTRS = { host: 'NDrawio', agent: 'ndrawio-editor', type: 'device' }

/**
 * 组装 mxfile 文本。
 * pages 项：{ xml, name?, attrs? } 为当前编辑页（重新序列化的 XML）；
 *           { rawContent, attrs } 为原样保留的页面（压缩或未压缩原文本）。
 */
export function buildMxfile({ pages, mxfileAttrs = {} }) {
  const attrs = { ...MXFILE_DEFAULT_ATTRS, ...mxfileAttrs }
  attrs.modified = new Date().toISOString()
  const parts = [`<mxfile ${attrString(attrs)}>`]
  for (const p of pages) {
    const pageAttrs = { ...(p.attrs || {}) }
    if (p.name && !pageAttrs.name) pageAttrs.name = p.name
    const pattr = attrString(pageAttrs)
    parts.push(pattr ? `  <diagram ${pattr}>` : '  <diagram>')
    if (p.rawContent != null) {
      parts.push(p.rawContent)
    } else {
      parts.push(indentText(p.xml, '    '))
    }
    parts.push('  </diagram>')
  }
  parts.push('</mxfile>')
  return parts.join('\n')
}

function indentText(text, prefix) {
  return String(text)
    .split('\n')
    .map((l) => (l ? prefix + l : l))
    .join('\n')
}

// ---------------------------------------------------------------- 样式

/**
 * drawio/mxGraph 样式串 → 样式对象。
 * 例：'rounded=1;fillColor=#dae8fc;' → { rounded: 1, fillColor: '#dae8fc' }
 *     'ellipse;whiteSpace=wrap;' → { baseStyleNames: ['ellipse'], whiteSpace: 'wrap' }
 */
export function parseStyleString(input) {
  const style = {}
  const s = String(input == null ? '' : input)
  if (s.startsWith(';')) style.ignoreDefaultStyle = true
  for (const part of s.split(';')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq < 0) {
      if (!style.baseStyleNames) style.baseStyleNames = []
      style.baseStyleNames.push(part)
    } else {
      const key = part.slice(0, eq) === 'autosize' ? 'autoSize' : part.slice(0, eq)
      style[key] = convertToNumericIfNeeded(part.slice(eq + 1))
    }
  }
  return style
}

function convertToNumericIfNeeded(value) {
  if (typeof value !== 'string') return value
  const v = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(v)) return value
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : value
}

/** 样式对象 → drawio 样式串（保留 baseStyleNames / ignoreDefaultStyle 语义）。 */
export function stringifyStyle(style) {
  if (style == null) return ''
  if (typeof style === 'string') return style
  const parts = []
  if (style.ignoreDefaultStyle) parts.push('')
  if (Array.isArray(style.baseStyleNames)) {
    for (const n of style.baseStyleNames) if (n) parts.push(String(n))
  }
  for (const k of Object.keys(style)) {
    if (k === 'baseStyleNames' || k === 'ignoreDefaultStyle') continue
    const v = style[k]
    if (v == null || v === '') continue
    const key = k === 'autoSize' ? 'autosize' : k
    parts.push(`${key}=${formatStyleValue(v)}`)
  }
  return parts.length ? parts.join(';') + ';' : ''
}

function formatStyleValue(v) {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v)
}

// ---------------------------------------------------------------- 模型 → drawio XML

const MODEL_ATTR_DEFAULTS = {
  grid: '1',
  gridSize: '10',
  guides: '1',
  tooltips: '1',
  connect: '1',
  arrows: '1',
  fold: '1',
  page: '1',
  pageScale: '1',
  pageWidth: '850',
  pageHeight: '1100',
  math: '0',
  shadow: '0',
}

/**
 * GraphDataModel → mxGraphModel XML（drawio 兼容：扁平 mxCell，父级用 parent 属性引用）。
 * opts.attrs 覆盖 mxGraphModel 属性（保留源文件的页面设置）。
 */
export function serializeGraphModel(model, opts = {}) {
  const attrs = { ...MODEL_ATTR_DEFAULTS, ...(opts.attrs || {}) }
  const lines = [`<mxGraphModel ${attrString(attrs)}>`, '  <root>']
  const root = model.getRoot()
  if (root) {
    const cells = []
    collectFlat(root, cells)
    for (const cell of cells) lines.push(buildCellElement(cell, 2))
  }
  lines.push('  </root>', '</mxGraphModel>')
  return lines.join('\n')
}

function collectFlat(cell, out) {
  out.push(cell)
  const children = cell.children || []
  for (const c of children) collectFlat(c, out)
}

function fmtNum(n) {
  const r = Math.round(n * 100) / 100
  return String(r)
}

function cellValueToString(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (v.nodeType === 1) return v.getAttribute('label') || ''
  if (typeof v === 'object') return ''
  return String(v)
}

function buildCellElement(cell, depth) {
  const indent = '  '.repeat(depth)
  const attrs = []
  const push = (k, v) => {
    if (v != null && v !== '') attrs.push(`${k}="${escapeXmlAttr(v)}"`)
  }
  push('id', cell.getId())
  const value = cellValueToString(cell.value)
  if (value) push('value', value)
  const style = stringifyStyle(cell.getStyle ? cell.getStyle() : cell.style)
  if (style) push('style', style)
  if (cell.parent) push('parent', cell.parent.getId())
  if (cell.vertex) push('vertex', '1')
  if (cell.edge) push('edge', '1')
  if (cell.edge && cell.source) push('source', cell.source.getId())
  if (cell.edge && cell.target) push('target', cell.target.getId())
  if (cell.visible === false) push('visible', '0')
  if (cell.collapsed) push('collapsed', '1')
  const geo = buildGeometryElement(cell, depth + 1)
  if (geo) {
    return `${indent}<mxCell ${attrs.join(' ')}>\n${geo}\n${indent}</mxCell>`
  }
  return `${indent}<mxCell ${attrs.join(' ')} />`
}

function mxPointElement(point, asName, indent) {
  const attrs = []
  if (point.x != null) attrs.push(`x="${fmtNum(point.x)}"`)
  if (point.y != null) attrs.push(`y="${fmtNum(point.y)}"`)
  if (asName) attrs.push(`as="${asName}"`)
  return `${indent}<mxPoint ${attrs.join(' ')} />`
}

function buildGeometryElement(cell, geoDepth) {
  const g = cell.geometry
  if (!g) return null
  const indent = '  '.repeat(geoDepth)
  const attrs = []
  if (g.x != null && (g.x !== 0 || !cell.edge)) attrs.push(`x="${fmtNum(g.x)}"`)
  if (g.y != null && (g.y !== 0 || !cell.edge)) attrs.push(`y="${fmtNum(g.y)}"`)
  if (g.width != null && (g.width !== 0 || !cell.edge)) attrs.push(`width="${fmtNum(g.width)}"`)
  if (g.height != null && (g.height !== 0 || !cell.edge)) attrs.push(`height="${fmtNum(g.height)}"`)
  if (g.relative) attrs.push('relative="1"')
  const inner = []
  if (g.sourcePoint) inner.push(mxPointElement(g.sourcePoint, 'sourcePoint', indent + '  '))
  if (g.targetPoint) inner.push(mxPointElement(g.targetPoint, 'targetPoint', indent + '  '))
  if (Array.isArray(g.points) && g.points.length) {
    inner.push(`${indent}  <Array as="points">`)
    for (const p of g.points) inner.push(mxPointElement(p, null, indent + '    '))
    inner.push(`${indent}  </Array>`)
  }
  if (g.offset) inner.push(mxPointElement(g.offset, 'offset', indent + '  '))
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
  if (!inner.length) return `${indent}<mxGeometry${attrStr} as="geometry" />`
  return `${indent}<mxGeometry${attrStr} as="geometry">\n${inner.join('\n')}\n${indent}</mxGeometry>`
}

// ---------------------------------------------------------------- 导入后处理

/** 从 mxGraphModel XML 文本提取首标签属性（去实体转义）。 */
export function extractModelAttrs(xml) {
  const m = /<mxGraphModel\b([^>]*)>/.exec(String(xml == null ? '' : xml))
  if (!m) return {}
  const attrs = {}
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g
  let mm
  while ((mm = re.exec(m[1]))) attrs[mm[1]] = decodeXmlEntities(mm[2])
  return attrs
}

function decodeXmlEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#10|#13);/g, (_, e) => ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#10': '\n',
    '#13': '\r',
  })[e])
}

/**
 * 解码后归一化：
 *  1. UserObject 反转单元格（value 为 DOM 元素）→ 取 label 属性为文本值
 *  2. nextId 对齐最大数字 id，避免新建单元格 id 冲突
 * 返回归一化处理过的单元格数量。
 */
export function normalizeImportedModel(model) {
  let normalized = 0
  let maxNumId = -1
  const walk = (cell) => {
    if (cell.value && cell.value.nodeType === 1) {
      const label = cell.value.getAttribute('label') || ''
      cell.setValue(label)
      normalized++
    }
    const id = cell.getId()
    if (id != null && /^\d+$/.test(String(id))) {
      const n = Number.parseInt(String(id), 10)
      if (n > maxNumId) maxNumId = n
    }
    for (const c of cell.children || []) walk(c)
  }
  const root = model.getRoot()
  if (root) walk(root)
  model.nextId = Math.max(model.nextId || 0, maxNumId + 1, 2)
  return normalized
}
