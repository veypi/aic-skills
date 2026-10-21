// 象棋核心规则测试（node --test，零依赖）。
import test from 'node:test'
import assert from 'node:assert/strict'

import * as chess from '../games/chess.js'

const idx = (x, y) => y * 9 + x
const pos = (x, y) => String.fromCharCode(97 + x) + (y + 1)

function stateWith(pieces, turn = 'red') {
  const cells = new Array(90).fill(null)
  for (const [x, y, t, s] of pieces) cells[idx(x, y)] = { t, s }
  return { cells, turn, lastMove: null, over: false, winner: null, check: false }
}

// 某格出发的全部合法着法（目标点集合）
function targetsFrom(state, seatId, x, y) {
  return chess
    .legalActions(state, seatId)
    .filter((a) => a.from.x === x && a.from.y === y)
    .map((a) => pos(a.to.x, a.to.y))
    .sort()
}

test('初始局面：红先，双方将帅居中线', () => {
  const s = chess.newState()
  assert.equal(s.turn, 'red')
  assert.deepEqual(s.cells[idx(0, 0)], { t: 'r', s: 'red' })
  assert.deepEqual(s.cells[idx(4, 0)], { t: 'k', s: 'red' })
  assert.deepEqual(s.cells[idx(4, 9)], { t: 'k', s: 'black' })
  assert.deepEqual(s.cells[idx(1, 2)], { t: 'c', s: 'red' })
  assert.deepEqual(s.cells[idx(0, 3)], { t: 'p', s: 'red' })
  assert.deepEqual(s.cells[idx(8, 6)], { t: 'p', s: 'black' })
  // 红方底行：车马相仕帅仕相马车
  const back = []
  for (let x = 0; x < 9; x++) back.push(s.cells[idx(x, 0)].t)
  assert.deepEqual(back.join(''), 'rnbakabnr')
})

test('马走日：马腿被别即不可走', () => {
  const s = chess.newState()
  // b1 马：a3/c3 的马腿是 b2；d3 的马腿是 c1（被自己的相占着）
  assert.deepEqual(targetsFrom(s, 'red', 1, 0), ['a3', 'c3'])
  // 塞住 b2（马腿）→ 马无处可走
  s.cells[idx(1, 1)] = { t: 'p', s: 'red' }
  assert.deepEqual(targetsFrom(s, 'red', 1, 0), [])
})

test('炮需炮架：越过炮架吃子，炮架之前只能平走', () => {
  const s = chess.newState()
  const moves = targetsFrom(s, 'red', 1, 2) // b3 红炮
  assert.ok(moves.includes('b4'), 'b4 应可平走')
  assert.ok(!moves.includes('b8'), 'b8 是炮架（黑炮），不能平走越过')
  assert.ok(!moves.includes('b9'), '炮架之后不能空走')
  assert.ok(moves.includes('b10'), '隔着炮架可以吃掉 b10 的黑马')
})

test('象不过河、士不出九宫', () => {
  const s = chess.newState()
  assert.deepEqual(targetsFrom(s, 'red', 2, 0), ['a3', 'e3']) // 红相 c1
  assert.deepEqual(targetsFrom(s, 'red', 3, 0), ['e2']) // 红仕 d1：c2 出了九宫
})

test('兵只向前，过河后可横走', () => {
  const s = chess.newState()
  assert.deepEqual(targetsFrom(s, 'red', 0, 3), ['a5']) // 未过河：只能向前
  const t = stateWith([[0, 5, 'p', 'red'], [8, 9, 'k', 'black'], [4, 0, 'k', 'red']])
  assert.deepEqual(targetsFrom(t, 'red', 0, 5), ['a7', 'b6']) // 过河后可左右（a6 → a7 / b6）
})

test('将帅照面为非法局面', () => {
  const s = stateWith([[4, 0, 'k', 'red'], [4, 2, 'k', 'black']])
  const moves = targetsFrom(s, 'red', 4, 0)
  assert.ok(!moves.includes('e2'), '照面不能走')
  assert.deepEqual(moves, ['d1', 'f1'])
})

test('被将军必须应将', () => {
  const s = stateWith([[4, 0, 'k', 'red'], [4, 2, 'r', 'black'], [0, 9, 'k', 'black']])
  const moves = targetsFrom(s, 'red', 4, 0)
  assert.ok(!moves.includes('e2'), '不能沿将线走')
  assert.deepEqual(moves, ['d1', 'f1'])
})

test('将死：黑车 a2→d2 绝杀（马 f3 控制 d2/e1）', () => {
  const s = stateWith(
    [
      [3, 0, 'k', 'red'], // d1 帅
      [0, 1, 'r', 'black'], // a2 车（走 d2 绝杀）
      [5, 2, 'n', 'black'], // f3 马：控制 d2（护车）与 e1
      [8, 9, 'k', 'black'],
    ],
    'black',
  )
  const action = { type: 'move', from: { x: 0, y: 1 }, to: { x: 3, y: 1 } }
  const res = chess.applyAction(s, action, 'black')
  assert.equal(res.over, true)
  assert.equal(res.winner, 'black')
  assert.match(res.note, /将死/)
})

test('走法解析与格式化互逆', () => {
  const a = chess.parseAction('b1c3')
  assert.deepEqual(a, { type: 'move', from: { x: 1, y: 0 }, to: { x: 2, y: 2 } })
  assert.equal(chess.formatAction(a), 'b1c3')
  assert.deepEqual(chess.parseAction('b1-c3'), a)
  assert.equal(chess.parseAction('z1c3'), null)
  assert.equal(chess.parseAction('b1'), null)
})

test('非法走法给出可读原因', () => {
  const s = chess.newState()
  assert.throws(() => chess.applyAction(s, { type: 'move', from: { x: 1, y: 0 }, to: { x: 1, y: 2 } }, 'red'), /不能这样走/)
  assert.throws(() => chess.applyAction(s, { type: 'move', from: { x: 4, y: 5 }, to: { x: 4, y: 4 } }, 'red'), /起点没有棋子/)
  assert.throws(() => chess.applyAction(s, { type: 'move', from: { x: 4, y: 9 }, to: { x: 4, y: 8 } }, 'red'), /不是你的棋子/)
})

test('局面文本可读且含坐标', () => {
  const s = chess.newState()
  const text = chess.textView(s)
  assert.ok(text.includes('楚河汉界'))
  assert.ok(text.includes('a b c d e f g h i'))
  assert.ok(text.includes('帅'))
  assert.ok(text.includes('将'))
})
