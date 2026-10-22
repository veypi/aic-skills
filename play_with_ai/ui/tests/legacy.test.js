// 旧试验版存档的一次性迁移：旧档没有 state 字段（局面摊在 current 上），
// 新版按 current.state 取局面 → 读到旧档会崩。这里锁住迁移结果。
import test from 'node:test'
import assert from 'node:assert/strict'

import { migrateLegacy, migrateLegacyGomoku } from '../core/legacy.js'
import * as gomoku from '../games/gomoku.js'

const N = 15

function legacyDoc() {
  const board = new Array(N * N).fill(0)
  board[0] = 1 // 第 0 行（最上一行）左侧：黑
  board[7 * N + 7] = 2 // H8：白
  return {
    game: 'gomoku',
    current: {
      id: 'g-old',
      board,
      turn: 2, // 白方待走
      phase: 'playing',
      bindings: { black: 'sess-1', white: '' },
      agents: { black: 'agent-1', white: '' },
      winner: 0,
      lastMove: 7 * N + 7,
      moves: [{ n: 1, side: 'black', x: 7, y: 7, pos: 'H8', t: 1700000000000 }],
      created_at: 1700000000000,
      updated_at: 1700000000000,
    },
    history: [{ id: 'g-0', winner: 1, moves: [] }],
  }
}

test('旧五子棋档迁移成新格式：棋子/回合/上一手', () => {
  const doc = migrateLegacy(legacyDoc(), 'gomoku')
  assert.ok(doc)
  const st = doc.current.state
  assert.equal(st.cells[0], 'black')
  assert.equal(st.cells[7 * N + 7], 'white')
  assert.equal(st.cells[1], null)
  assert.equal(st.turn, 'white')
  assert.deepEqual(st.lastMove, { x: 7, y: 7 })
  assert.equal(st.over, false)
  assert.equal(st.winner, null)
})

test('迁移后的局面键与游戏核心 newState() 完全一致（形状校验要过）', () => {
  const doc = migrateLegacy(legacyDoc(), 'gomoku')
  const probe = gomoku.newState()
  assert.deepEqual(Object.keys(doc.current.state).sort(), Object.keys(probe).sort())
})

test('席位归属迁移：绑了会话 = AI，没绑 = 人类', () => {
  const doc = migrateLegacy(legacyDoc(), 'gomoku')
  assert.deepEqual(doc.current.executors.black, { kind: 'ai', sessionId: 'sess-1', agentId: 'agent-1' })
  assert.deepEqual(doc.current.executors.white, { kind: 'human' })
  assert.equal(doc.current.phase, 'playing')
})

test('棋谱迁移成新动作格式', () => {
  const doc = migrateLegacy(legacyDoc(), 'gomoku')
  const m = doc.current.moves[0]
  assert.equal(m.n, 1)
  assert.equal(m.seatId, 'black')
  assert.deepEqual(m.action, { type: 'move', to: { x: 7, y: 7 } })
  assert.equal(m.text, 'H8')
})

test('认不出的旧档不迁移（返回 null，绝不硬解）', () => {
  assert.equal(migrateLegacyGomoku({ board: [1, 2, 3] }), null)
  assert.equal(migrateLegacyGomoku({}), null)
  assert.equal(migrateLegacy(legacyDoc(), 'chess'), null) // 旧版只有五子棋
  assert.equal(migrateLegacy({ game: 'gomoku' }, 'gomoku'), null) // 没有 current
})
