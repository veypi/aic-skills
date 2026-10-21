// 五子棋：15×15，黑先，五连珠胜。
//
// 这是**游戏核心**：只管规则与局面，不关心对局由人还是由 AI 执行，也不关心人数。
// 核心契约（席位、动作、执行入口）见 references/game-authoring.md。

export const id = 'gomoku'
export const name = '五子棋'

// 席位：数量与含义由游戏自己定，公共组件不设上限（这里 2 人）
export const seats = [
  { id: 'black', name: '黑方', symbol: '●' },
  { id: 'white', name: '白方', symbol: '○' },
]
export const first = 'black'

// 棋盘：cols×rows 个**交叉点**，落子与线条都落在交叉点上
export const board = { cols: 15, rows: 15 }
export const paddingRatio = 0.85 // 边距 = cell × ratio（给坐标标注留位）

// 动作需要「起点+目标」两步（象棋类）还是单击即成（落子型）
export const selectSource = false

export const moveSyntax = 'H8（列字母 A-O + 行号 1-15；H8 为天元，行号自下往上数）'
export const moveExample = 'H8'
export const rules = [
  '棋盘 15×15，黑方（●）先手，双方轮流落子。',
  '先连成五枚同色棋子（横/竖/斜任意方向）者胜；棋盘落满为和棋。',
  '坐标：列 = A-O（自左向右），行 = 1-15（自下向上），如 H8 为天元。',
  '用 play <坐标> 落子，且只能在自己的回合下自己的阵营。',
].join('\n')

const N = 15
const idx = (x, y) => y * N + x
const other = (side) => (side === 'black' ? 'white' : 'black')
const seatName = (id) => (id === 'black' ? '黑方' : '白方')

export function newState() {
  return {
    cells: new Array(N * N).fill(null), // 每格 = 席位 id | null
    turn: first, // 当前待行动席位
    lastMove: null, // {x,y}
    over: false,
    winner: null,
  }
}

// 指令文本 → 动作（只做语法解析；合法性由 applyAction 判定）
export function parseAction(text) {
  const s = String(text == null ? '' : text).trim().toUpperCase()
  const m = /^([A-O])(\d{1,2})$/.exec(s)
  if (!m) return null
  const x = m[1].charCodeAt(0) - 65
  const row = Number(m[2])
  if (row < 1 || row > N) return null
  return { type: 'move', to: { x, y: N - row } }
}

export function formatAction(action) {
  if (!action || action.type !== 'move' || !action.to) return '—'
  return String.fromCharCode(65 + action.to.x) + (N - action.to.y)
}

// 当前行动席位的合法动作
export function legalActions(state, seatId) {
  if (state.turn !== seatId) return []
  const out = []
  for (let i = 0; i < state.cells.length; i++) {
    if (!state.cells[i]) out.push({ type: 'move', to: { x: i % N, y: Math.floor(i / N) } })
  }
  return out
}

// 本轮待行动的席位（默认单方行动；多人同时行动的游戏可覆盖本函数）
export function actors(state) {
  return [state.turn]
}

function winAt(cells, x, y, side) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
  for (const [dx, dy] of dirs) {
    let n = 1
    for (const s of [1, -1]) {
      let cx = x + dx * s
      let cy = y + dy * s
      while (cx >= 0 && cx < N && cy >= 0 && cy < N && cells[idx(cx, cy)] === side) {
        n++
        cx += dx * s
        cy += dy * s
      }
    }
    if (n >= 5) return true
  }
  return false
}

// 执行动作 → 新局面（非法动作在此抛错）
export function applyAction(state, action, actorSeatId) {
  if (state.over) throw new Error('对局已结束')
  if (state.turn !== actorSeatId) throw new Error(`未轮到你（当前回合：${seatName(state.turn)}）`)
  const to = action && action.to
  if (!to || !Number.isInteger(to.x) || !Number.isInteger(to.y)) throw new Error('动作格式非法')
  if (to.x < 0 || to.x >= N || to.y < 0 || to.y >= N) throw new Error('落子越界')
  if (state.cells[idx(to.x, to.y)]) throw new Error(`非法落子 ${formatAction(action)}（已有子）`)

  const side = state.turn
  const cells = state.cells.slice()
  cells[idx(to.x, to.y)] = side
  let over = false
  let winner = null
  let note = ''
  if (winAt(cells, to.x, to.y, side)) {
    over = true
    winner = side
    note = `五连珠！${seatName(side)}获胜。`
  } else if (cells.every((c) => c)) {
    over = true
    note = '棋盘已满，和棋。'
  }
  const next = {
    cells,
    turn: over ? side : other(side),
    lastMove: { x: to.x, y: to.y },
    over,
    winner,
  }
  return { state: next, over, winner, note }
}

// 局面文本（给 AI 消费）
export function textView(state) {
  const lines = ['   ' + Array.from({ length: N }, (_, i) => String.fromCharCode(65 + i)).join(' ')]
  for (let r = 0; r < N; r++) {
    let line = String(N - r).padStart(2, ' ') + ' '
    for (let c = 0; c < N; c++) {
      const v = state.cells[idx(c, r)]
      line += (v === 'black' ? '●' : v === 'white' ? '○' : '·') + ' '
    }
    lines.push(line)
  }
  let out = lines.join('\n')
  out += `\n上一手：${state.lastMove ? formatAction({ type: 'move', to: state.lastMove }) : '无'}`
  if (state.over) {
    out += state.winner ? `\n对局结束：${seatName(state.winner)}胜。` : '\n对局结束：和棋。'
  }
  return out
}

// 棋盘绘制：geom = {cell, pad, w, h}；交叉点在 pad + i*cell
export function draw(g, state, geom) {
  const { cell, pad, w, h } = geom
  g.fillStyle = '#eec47e'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#7a5f33'
  g.font = `${Math.max(10, Math.round(cell * 0.34))}px sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let i = 0; i < N; i++) {
    g.fillText(String.fromCharCode(65 + i), pad + i * cell, pad / 2)
    g.fillText(String(N - i), pad / 2, pad + i * cell)
  }
  g.strokeStyle = '#6b5330'
  g.lineWidth = 1
  for (let i = 0; i < N; i++) {
    const p = pad + i * cell
    g.beginPath()
    g.moveTo(pad, p)
    g.lineTo(pad + (N - 1) * cell, p)
    g.stroke()
    g.beginPath()
    g.moveTo(p, pad)
    g.lineTo(p, pad + (N - 1) * cell)
    g.stroke()
  }
  g.fillStyle = '#6b5330'
  for (const sx of [3, 7, 11]) {
    for (const sy of [3, 7, 11]) {
      g.beginPath()
      g.arc(pad + sx * cell, pad + sy * cell, Math.max(2, cell * 0.1), 0, Math.PI * 2)
      g.fill()
    }
  }
  for (let i = 0; i < state.cells.length; i++) {
    const v = state.cells[i]
    if (!v) continue
    const x = pad + (i % N) * cell
    const y = pad + Math.floor(i / N) * cell
    const r = cell * 0.44
    const grad = g.createRadialGradient(x - r / 3, y - r / 3, r / 6, x, y, r)
    if (v === 'black') {
      grad.addColorStop(0, '#666')
      grad.addColorStop(1, '#111')
    } else {
      grad.addColorStop(0, '#fff')
      grad.addColorStop(1, '#cfcfcf')
    }
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fillStyle = grad
    g.fill()
    g.strokeStyle = v === 'black' ? '#000' : '#aaa'
    g.stroke()
  }
  if (state.lastMove) {
    g.beginPath()
    g.arc(pad + state.lastMove.x * cell, pad + state.lastMove.y * cell, Math.max(2, cell * 0.15), 0, Math.PI * 2)
    g.fillStyle = '#d33'
    g.fill()
  }
}

// 像素 → 交叉点
export function cellAt(geom, px, py) {
  const { cell, pad } = geom
  const x = Math.round((px - pad) / cell)
  const y = Math.round((py - pad) / cell)
  if (x < 0 || x >= N || y < 0 || y >= N) return null
  return { x, y }
}

// 人类点击 → 动作（或「需要再点一次目标」）
// 返回 {action} | {select:true, candidates} | null
export function pickAt(state, seatId, cell, pending) {
  if (state.over || !cell) return null
  if (state.turn !== seatId) return null
  if (state.cells[idx(cell.x, cell.y)]) return null
  return { action: { type: 'move', to: { x: cell.x, y: cell.y } } }
}
