// 旧试验版存档的一次性迁移（test_skills/play_with_ai 的单文件格式）。
//
// 背景：旧版把局面直接摊在 current 上（board/turn/phase/bindings/...），**没有 state 字段**；
// 新版按 current.state 取局面。读到旧档时 c.state 是 undefined，形状校验会抛
// 「Cannot use 'in' operator ... in undefined」，整个页面启动脚本挂掉 → 白屏。
//
// 这里把旧档翻译成新格式（旧棋盘数组与新 cells 的下标一一对应：都是 15×15、
// 行号自上而下、0 行在最上），迁移后由 store 落成带版本号的新档，此文件即可退役。
//
// 旧历史档只有摘要没有局面，无法还原棋盘 → 只迁当前局，历史列表丢弃。

const N = 15 // 五子棋 15×15

// 旧档的阵营编码：1=黑 2=白 0=空
const sideOf = (v) => (v === 1 ? 'black' : v === 2 ? 'white' : '')

// 旧档的 current → 新档的 current（返回 null = 不是旧格式）
export function migrateLegacyGomoku(cur) {
  if (!cur || !Array.isArray(cur.board) || cur.board.length !== N * N) return null

  const cells = new Array(N * N).fill(null)
  for (let i = 0; i < N * N; i++) {
    const side = sideOf(cur.board[i])
    if (side) cells[i] = side
  }

  const state = {
    cells,
    turn: sideOf(cur.turn) || 'black',
    lastMove: null,
    over: cur.phase === 'over',
    winner: sideOf(cur.winner) || null,
  }
  if (Number.isInteger(cur.lastMove) && cur.lastMove >= 0 && cur.lastMove < N * N) {
    state.lastMove = { x: cur.lastMove % N, y: Math.floor(cur.lastMove / N) }
  }

  // 旧档用 bindings（会话）+ agents（agent）表达席位归属；没绑定 = 人类代打
  const bindings = cur.bindings || {}
  const agents = cur.agents || {}
  const executors = {}
  for (const side of ['black', 'white']) {
    const sessionId = bindings[side] || ''
    executors[side] = sessionId ? { kind: 'ai', sessionId, agentId: agents[side] || '' } : { kind: 'human' }
  }

  const moves = (Array.isArray(cur.moves) ? cur.moves : []).map((m, i) => {
    const to = { x: m.x, y: m.y }
    return {
      n: m.n || i + 1,
      seatId: m.side,
      action: { type: 'move', to },
      text: m.pos || String.fromCharCode(65 + to.x) + (N - to.y),
      t: m.t,
    }
  })

  return {
    id: cur.id,
    state,
    executors,
    phase: cur.phase || 'idle',
    moves,
    resigned: [],
    created_at: cur.created_at,
    updated_at: cur.updated_at,
  }
}

// 整档迁移入口：认不出就返回 null（调用方丢弃旧档，不把结构对不上的档喂给会话）
export function migrateLegacy(doc, gameId) {
  if (!doc || doc.game !== gameId || !doc.current) return null
  if (gameId === 'gomoku') {
    const current = migrateLegacyGomoku(doc.current)
    if (!current) return null
    return { game: gameId, current, history: [] }
  }
  return null
}
