// 象棋（中国象棋）：9×10 线制，红先，将死/困毙判负。
//
// 这是**游戏核心**：只管规则与局面，不关心对局由人还是由 AI 执行，也不关心人数。
// 核心契约（席位、动作、执行入口）见 references/game-authoring.md。

export const id = 'chess'
export const name = '象棋'

export const seats = [
  { id: 'red', name: '红方', symbol: '红' },
  { id: 'black', name: '黑方', symbol: '黑' },
]
export const first = 'red'

export const board = { cols: 9, rows: 10 }
export const paddingRatio = 0.7
export const selectSource = true // 选子 → 目标，两步

export const moveSyntax = 'b1c3（起点列字母 a-i + 行号 1-10，再接终点；列按红方视角自左向右，行号自下向上）'
export const moveExample = 'b1c3'
export const rules = [
  '棋盘 9×10 线制，红方（帅/仕/相/马/车/炮/兵）在下，黑方（将/士/象/马/车/炮/卒）在上，红先。',
  '车走直线（不能越子）；炮走直线，吃子必须隔一个「炮架」；马走日（马腿被别即不可走）；相走田（塞象眼不可走、不可过河）；仕走斜线（不出九宫）；帅/将走直一格（不出九宫）；兵/卒只向前，过河后可左右平移，永不后退。',
  '将帅照面（同一列中间无子）为非法局面：谁造成照面，谁这步不能走。',
  '被将军的一方必须应将；无合法着法时判负（将死或困毙）。',
  '坐标：列 = a-i（红方视角自左向右），行 = 1-10（自下向上）；如 b1c3 = 马从 b1 跳到 c3。',
  '用 play <走法> 落子（如 play b1c3），且只能在自己的回合下自己的阵营。',
].join('\n')

const COLS = 9
const ROWS = 10
const idx = (x, y) => y * COLS + x
const inBoard = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS
const other = (side) => (side === 'red' ? 'black' : 'red')
const seatName = (id) => (id === 'red' ? '红方' : '黑方')
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0)

const CHAR = {
  red: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  black: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' },
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const HORSE = [
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
]
const DIAG2 = [
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
]
const DIAG1 = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const inPalace = (side, x, y) => x >= 3 && x <= 5 && (side === 'red' ? y >= 0 && y <= 2 : y >= 7 && y <= 9)
// 是否已过河（红在下：行 5 起算过河；黑在上：行 4 起算过河）
const crossed = (side, y) => (side === 'red' ? y >= 5 : y <= 4)

export function newState() {
  const cells = new Array(COLS * ROWS).fill(null)
  const back = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r']
  const put = (x, y, t, s) => {
    cells[idx(x, y)] = { t, s }
  }
  back.forEach((t, x) => put(x, 0, t, 'red'))
  put(1, 2, 'c', 'red')
  put(7, 2, 'c', 'red')
  for (const x of [0, 2, 4, 6, 8]) put(x, 3, 'p', 'red')
  back.forEach((t, x) => put(x, 9, t, 'black'))
  put(1, 7, 'c', 'black')
  put(7, 7, 'c', 'black')
  for (const x of [0, 2, 4, 6, 8]) put(x, 6, 'p', 'black')
  return { cells, turn: first, lastMove: null, over: false, winner: null, check: false }
}

// ---- 基础工具 ----

export function parseAction(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase()
  const m = /^([a-i])(\d{1,2})\s*[-–—→>]*\s*([a-i])(\d{1,2})$/.exec(s)
  if (!m) return null
  const fx = m[1].charCodeAt(0) - 97
  const fy = Number(m[2]) - 1
  const tx = m[3].charCodeAt(0) - 97
  const ty = Number(m[4]) - 1
  if (!inBoard(fx, fy) || !inBoard(tx, ty)) return null
  return { type: 'move', from: { x: fx, y: fy }, to: { x: tx, y: ty } }
}

export function formatAction(action) {
  if (!action || action.type !== 'move' || !action.from || !action.to) return '—'
  const p = (c) => String.fromCharCode(97 + c.x) + (c.y + 1)
  return p(action.from) + p(action.to)
}

function kingPos(cells, side) {
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i]
    if (p && p.s === side && p.t === 'k') return { x: i % COLS, y: Math.floor(i / COLS) }
  }
  return null
}

// 将帅照面：同列且中间无子
function generalsFace(cells) {
  const r = kingPos(cells, 'red')
  const b = kingPos(cells, 'black')
  if (!r || !b || r.x !== b.x) return false
  const lo = Math.min(r.y, b.y)
  const hi = Math.max(r.y, b.y)
  for (let y = lo + 1; y < hi; y++) if (cells[idx(r.x, y)]) return false
  return true
}

// 是否被 bySide 攻击（按伪合法着法判定：被牵制的子仍算攻击）
function isAttacked(cells, x, y, bySide) {
  for (const m of pseudoMoves(cells, bySide, true)) {
    if (m.to.x === x && m.to.y === y) return true
  }
  return false
}

function applyToCells(cells, action) {
  const piece = cells[idx(action.from.x, action.from.y)]
  const next = cells.slice()
  next[idx(action.from.x, action.from.y)] = null
  next[idx(action.to.x, action.to.y)] = piece
  return next
}

// 伪合法着法（不查自己王的安全；allowKingCapture 用于攻击判定）
function pseudoMoves(cells, side, allowKingCapture = false) {
  const out = []
  const push = (from, to, quietOnly = false) => {
    const target = cells[idx(to.x, to.y)]
    if (target) {
      if (quietOnly) return // 只走空位（兵的前进、炮架之前的平走）
      if (target.s === side) return // 不能吃自己的子
      if (target.t === 'k' && !allowKingCapture) return // 默认不出现吃将（吃将只在攻击判定里算）
    }
    out.push({ type: 'move', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } })
  }
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = cells[idx(x, y)]
      if (!p || p.s !== side) continue
      const from = { x, y }
      switch (p.t) {
        case 'r': {
          for (const [dx, dy] of DIRS) {
            let cx = x + dx
            let cy = y + dy
            while (inBoard(cx, cy)) {
              const t = cells[idx(cx, cy)]
              push(from, { x: cx, y: cy })
              if (t) break // 遇子即停（敌子可吃，己子不可）
              cx += dx
              cy += dy
            }
          }
          break
        }
        case 'c': {
          for (const [dx, dy] of DIRS) {
            let cx = x + dx
            let cy = y + dy
            let screened = false
            while (inBoard(cx, cy)) {
              const t = cells[idx(cx, cy)]
              if (!screened) {
                if (!t) push(from, { x: cx, y: cy }, true)
                else screened = true // 第一个子 = 炮架
              } else if (t) {
                push(from, { x: cx, y: cy }) // 炮架后的第一个子可吃
                break
              }
              cx += dx
              cy += dy
            }
          }
          break
        }
        case 'n': {
          for (const [dy, dx] of HORSE) {
            const tx = x + dx
            const ty = y + dy
            if (!inBoard(tx, ty)) continue
            const leg = Math.abs(dy) === 2 ? { x, y: y + sign(dy) } : { x: x + sign(dx), y }
            if (cells[idx(leg.x, leg.y)]) continue // 马腿被别
            push(from, { x: tx, y: ty })
          }
          break
        }
        case 'b': {
          for (const [dy, dx] of DIAG2) {
            const tx = x + dx
            const ty = y + dy
            if (!inBoard(tx, ty)) continue
            if (cells[idx(x + sign(dx), y + sign(dy))]) continue // 塞象眼
            if (side === 'red' ? ty > 4 : ty < 5) continue // 象不过河
            push(from, { x: tx, y: ty })
          }
          break
        }
        case 'a': {
          for (const [dy, dx] of DIAG1) {
            const tx = x + dx
            const ty = y + dy
            if (!inBoard(tx, ty)) continue
            if (!inPalace(side, tx, ty)) continue
            push(from, { x: tx, y: ty })
          }
          break
        }
        case 'k': {
          for (const [dy, dx] of DIRS) {
            const tx = x + dx
            const ty = y + dy
            if (!inBoard(tx, ty)) continue
            if (!inPalace(side, tx, ty)) continue
            push(from, { x: tx, y: ty })
          }
          break
        }
        case 'p': {
          const fwd = side === 'red' ? 1 : -1
          if (inBoard(x, y + fwd)) push(from, { x, y: y + fwd }, true) // 兵只能向前（前方有子就停）
          if (crossed(side, y)) {
            if (x > 0) push(from, { x: x - 1, y })
            if (x < COLS - 1) push(from, { x: x + 1, y })
          }
          break
        }
        default:
          break
      }
    }
  }
  return out
}

export function legalActions(state, seatId) {
  if (state.turn !== seatId) return []
  const out = []
  for (const m of pseudoMoves(state.cells, state.turn)) {
    const next = applyToCells(state.cells, m)
    if (generalsFace(next)) continue // 将帅照面：非法
    const k = kingPos(next, state.turn)
    if (!k) continue
    if (isAttacked(next, k.x, k.y, other(state.turn))) continue // 自己王被攻：不合法
    out.push(m)
  }
  return out
}

export function actors(state) {
  return [state.turn]
}

export function applyAction(state, action, actorSeatId) {
  if (state.over) throw new Error('对局已结束')
  if (state.turn !== actorSeatId) throw new Error(`未轮到你（当前回合：${seatName(state.turn)}）`)
  const from = action && action.from
  const to = action && action.to
  if (!from || !to || !inBoard(from.x, from.y) || !inBoard(to.x, to.y)) throw new Error('动作格式非法')

  const piece = state.cells[idx(from.x, from.y)]
  if (!piece) throw new Error(`${formatAction(action)}：起点没有棋子`)
  if (piece.s !== state.turn) throw new Error(`${formatAction(action)}：那不是你的棋子`)

  const pseudo = pseudoMoves(state.cells, state.turn).find((m) => m.from.x === from.x && m.from.y === from.y && m.to.x === to.x && m.to.y === to.y)
  if (!pseudo) throw new Error(`${formatAction(action)}：该子不能这样走（马腿被别 / 塞象眼 / 炮无炮架 / 被子挡住等）`)

  const cells = applyToCells(state.cells, action)
  if (generalsFace(cells)) throw new Error(`${formatAction(action)}：会造成将帅照面，不能这样走`)
  const k = kingPos(cells, state.turn)
  if (k && isAttacked(cells, k.x, k.y, other(state.turn))) {
    throw new Error(`${formatAction(action)}：这样走会被将军，必须先应将`)
  }

  const turn = other(state.turn)
  const next = { cells, turn, lastMove: { from: { ...from }, to: { ...to } }, over: false, winner: null, check: false }
  const nk = kingPos(cells, turn)
  next.check = !!(nk && isAttacked(cells, nk.x, nk.y, other(turn)))
  const reply = legalActions(next, turn)
  if (!reply.length) {
    next.over = true
    next.winner = state.turn
    return {
      state: next,
      over: true,
      winner: state.turn,
      note: next.check ? `将死！${seatName(state.turn)}获胜。` : `${seatName(turn)}无子可动（困毙），${seatName(state.turn)}获胜。`,
    }
  }
  return { state: next, over: false, winner: null, note: next.check ? `${seatName(turn)}被将军！` : '' }
}

// 局面文本（给 AI 消费）
export function textView(state) {
  const lines = ['   ' + 'a b c d e f g h i']
  for (let row = ROWS - 1; row >= 0; row--) {
    const cells = []
    for (let col = 0; col < COLS; col++) {
      const p = state.cells[idx(col, row)]
      cells.push(p ? CHAR[p.s][p.t] : '·')
    }
    lines.push(String(row + 1).padStart(2, ' ') + ' ' + cells.join(' '))
    if (row === 5) lines.push('   ' + '┈'.repeat(17) + ' 楚河汉界')
  }
  let out = lines.join('\n')
  out += `\n上一手：${state.lastMove ? formatAction({ type: 'move', from: state.lastMove.from, to: state.lastMove.to }) : '无'}`
  if (state.check) out += `\n${seatName(state.turn)}被将军！必须应将。`
  if (state.over) {
    out += state.winner ? `\n对局结束：${seatName(state.winner)}胜。` : '\n对局结束：和棋。'
  }
  return out
}

// 棋盘绘制：geom = {cell, pad, w, h}
export function draw(g, state, geom) {
  const { cell, pad, w, h } = geom
  const right = pad + (COLS - 1) * cell
  const top = pad + (ROWS - 1) * cell
  g.fillStyle = '#eec47e'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = '#6b5330'
  g.lineWidth = 1
  for (let i = 0; i < COLS; i++) {
    const x = pad + i * cell
    g.beginPath()
    g.moveTo(x, pad)
    g.lineTo(x, top)
    g.stroke()
  }
  for (let j = 0; j < ROWS; j++) {
    const y = pad + j * cell
    g.beginPath()
    g.moveTo(pad, y)
    g.lineTo(right, y)
    g.stroke()
  }
  // 九宫斜线
  g.beginPath()
  g.moveTo(pad + 3 * cell, pad)
  g.lineTo(pad + 5 * cell, pad + 2 * cell)
  g.moveTo(pad + 5 * cell, pad)
  g.lineTo(pad + 3 * cell, pad + 2 * cell)
  g.moveTo(pad + 3 * cell, top - 2 * cell)
  g.lineTo(pad + 5 * cell, top)
  g.moveTo(pad + 5 * cell, top - 2 * cell)
  g.lineTo(pad + 3 * cell, top)
  g.stroke()
  // 楚河汉界
  g.fillStyle = '#7a5f33'
  g.font = `${Math.max(12, Math.round(cell * 0.46))}px sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('楚 河', pad + 2 * cell, pad + 4.5 * cell)
  g.fillText('汉 界', pad + 6 * cell, pad + 4.5 * cell)

  // 棋子
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = state.cells[idx(x, y)]
      if (!p) continue
      const cx = pad + x * cell
      const cy = pad + y * cell
      const r = cell * 0.42
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.fillStyle = '#f6e3bd'
      g.fill()
      g.lineWidth = Math.max(1, cell * 0.06)
      g.strokeStyle = p.s === 'red' ? '#a8321f' : '#2b2b2b'
      g.stroke()
      g.fillStyle = p.s === 'red' ? '#a8321f' : '#1a1a1a'
      g.font = `600 ${Math.max(12, Math.round(cell * 0.5))}px sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(CHAR[p.s][p.t], cx, cy + 1)
    }
  }
  // 上一步标记
  if (state.lastMove) {
    g.strokeStyle = '#d33'
    g.lineWidth = Math.max(1, cell * 0.05)
    for (const c of [state.lastMove.from, state.lastMove.to]) {
      g.strokeRect(pad + c.x * cell - cell * 0.46, pad + c.y * cell - cell * 0.46, cell * 0.92, cell * 0.92)
    }
  }
  // 将军：被将一方的王高亮
  if (state.check) {
    const k = kingPos(state.cells, state.turn)
    if (k) {
      g.strokeStyle = '#d33'
      g.lineWidth = Math.max(2, cell * 0.09)
      g.beginPath()
      g.arc(pad + k.x * cell, pad + k.y * cell, cell * 0.5, 0, Math.PI * 2)
      g.stroke()
    }
  }
}

export function cellAt(geom, px, py) {
  const { cell, pad } = geom
  const x = Math.round((px - pad) / cell)
  const y = Math.round((py - pad) / cell)
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null
  return { x, y }
}

// 人类点击 → 动作（或「需要再点一次目标」）
export function pickAt(state, seatId, cell, pending) {
  if (state.over || !cell) return null
  if (state.turn !== seatId) return null
  if (pending) {
    const hit = legalActions(state, seatId).find((a) => a.from.x === pending.x && a.from.y === pending.y && a.to.x === cell.x && a.to.y === cell.y)
    if (hit) return { action: hit }
  }
  const piece = state.cells[idx(cell.x, cell.y)]
  if (!piece || piece.s !== state.turn) return null
  const candidates = legalActions(state, seatId).filter((a) => a.from.x === cell.x && a.from.y === cell.y)
  if (!candidates.length) return null
  return { select: true, candidates }
}
