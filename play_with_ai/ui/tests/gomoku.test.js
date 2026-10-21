// 五子棋核心规则测试（node --test，零依赖）。
import test from 'node:test'
import assert from 'node:assert/strict'

import * as gomoku from '../games/gomoku.js'

test('初始局面与坐标解析', () => {
  const s = gomoku.newState()
  assert.equal(s.turn, 'black')
  assert.equal(s.cells.length, 225)
  assert.deepEqual(gomoku.parseAction('H8'), { type: 'move', to: { x: 7, y: 7 } })
  assert.deepEqual(gomoku.parseAction('h8'), { type: 'move', to: { x: 7, y: 7 } })
  assert.equal(gomoku.formatAction({ type: 'move', to: { x: 7, y: 7 } }), 'H8')
  assert.equal(gomoku.parseAction('A16'), null)
  assert.equal(gomoku.parseAction('Z8'), null)
  assert.equal(gomoku.parseAction('H'), null)
})

test('五连珠即胜，轮次交替', () => {
  let s = gomoku.newState()
  const step = (state, p) => gomoku.applyAction(state, gomoku.parseAction(p), state.turn)
  // 黑走 A1 B1 C1 D1 E1 连成五连，白走 A3 A4 A5 A6 应对
  const script = ['A1', 'A3', 'B1', 'A4', 'C1', 'A5', 'D1', 'A6', 'E1']
  let res = null
  for (const p of script) {
    res = step(s, p)
    s = res.state
    if (res.over) break
  }
  assert.equal(res.over, true)
  assert.equal(res.winner, 'black')
  assert.match(res.note, /五连珠/)
  assert.equal(s.turn, 'black', '终局不再换边')
})

test('非法落子被拒（已有子 / 非己方回合）', () => {
  const s = gomoku.newState()
  const r1 = gomoku.applyAction(s, gomoku.parseAction('A1'), 'black')
  const r2 = gomoku.applyAction(r1.state, gomoku.parseAction('A3'), 'white')
  const s3 = r2.state // 轮到黑
  assert.throws(() => gomoku.applyAction(s3, gomoku.parseAction('A1'), 'black'), /已有子/)
  assert.throws(() => gomoku.applyAction(s3, gomoku.parseAction('B1'), 'white'), /未轮到你/)
})

test('合法着法集合与回合归属', () => {
  const s = gomoku.newState()
  assert.equal(gomoku.legalActions(s, 'white').length, 0) // 不是你的回合
  assert.equal(gomoku.legalActions(s, 'black').length, 225)
  assert.deepEqual(gomoku.actors(s), ['black'])
})

test('落满棋盘为和棋', () => {
  // 用 (x + 2y) % 4 的周期配色填满：任意方向都不会出现五连
  const pattern = ['black', 'black', 'white', 'white']
  const s = gomoku.newState()
  const cells = s.cells.slice()
  const empty = { x: 7, y: 7 }
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      if (x === empty.x && y === empty.y) continue
      cells[y * 15 + x] = pattern[(x + 2 * y) % 4]
    }
  }
  const st = { ...s, cells }
  const res = gomoku.applyAction(st, { type: 'move', to: empty }, st.turn)
  assert.equal(res.over, true)
  assert.equal(res.winner, null)
  assert.match(res.note, /和棋/)
})
