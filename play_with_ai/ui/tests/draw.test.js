// 绘图几何不变量测试：木底必须与棋盘范围一致（位图/几何错位会露馅）。
import test from 'node:test'
import assert from 'node:assert/strict'

import * as gomoku from '../games/gomoku.js'
import * as chess from '../games/chess.js'

function fakeCtx() {
  const ops = []
  return {
    ops,
    fillRect: (...a) => ops.push(['fillRect', ...a]),
    clearRect: (...a) => ops.push(['clearRect', ...a]),
    beginPath: () => ops.push(['beginPath']),
    moveTo: (...a) => ops.push(['moveTo', ...a]),
    lineTo: (...a) => ops.push(['lineTo', ...a]),
    stroke: () => ops.push(['stroke']),
    fill: () => ops.push(['fill']),
    arc: (...a) => ops.push(['arc', ...a]),
    fillText: (...a) => ops.push(['fillText', ...a]),
    strokeRect: (...a) => ops.push(['strokeRect', ...a]),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: '',
    textBaseline: '',
  }
}

// 与页面 layout() 同一套几何公式
function geomOf(game, aw, ah) {
  const r = game.paddingRatio ?? 0.8
  const cols = game.board.cols
  const rows = game.board.rows
  const cell = Math.max(6, Math.min(aw / (2 * r + cols - 1), ah / (2 * r + rows - 1)))
  const pad = cell * r
  return { cell, pad, w: Math.round(2 * pad + (cols - 1) * cell), h: Math.round(2 * pad + (rows - 1) * cell) }
}

for (const [name, game] of [
  ['五子棋', gomoku],
  ['象棋', chess],
]) {
  test(`${name}：木底与棋盘范围一致`, () => {
    const geom = geomOf(game, 900, 900)
    const ctx = fakeCtx()
    game.draw(ctx, game.newState(), geom)

    const fill = ctx.ops.find((o) => o[0] === 'fillRect')
    assert.ok(fill, `${name} 应先铺木底`)
    assert.deepEqual(fill.slice(1), [0, 0, geom.w, geom.h], '木底尺寸必须等于画布尺寸')

    const pts = ctx.ops.filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo')
    const xs = pts.map((o) => o[1])
    const ys = pts.map((o) => o[2])
    const near = (a, b) => Math.abs(a - b) <= 1.5 // geom.w/h 取整，容差 1px
    assert.ok(near(Math.max(...xs), geom.w - geom.pad), '最右线应贴右边距')
    assert.ok(near(Math.max(...ys), geom.h - geom.pad), '最下线应贴下边距')
    assert.ok(near(Math.min(...xs), geom.pad), '最左线应贴左边距')
    assert.ok(near(Math.min(...ys), geom.pad), '最上线应贴上边距')
  })

  test(`${name}：画布尺寸随容器变化且不超出容器`, () => {
    const small = geomOf(game, 400, 400)
    const big = geomOf(game, 900, 900)
    assert.ok(big.cell > small.cell)
    assert.ok(big.w <= 900 && big.h <= 900, '画布不能超出容器')
    assert.ok(small.w <= 400 && small.h <= 400)
  })
}
