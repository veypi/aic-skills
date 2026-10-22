// 存档组件测试：路径必须是页面本地 OPFS 的完整树路径（/page/...），且能回读。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createStore, FORMAT_VERSION } from '../core/store.js'

function memFS() {
  const files = new Map()
  const dirs = []
  return {
    files,
    dirs,
    readFile: async (p) => {
      if (!files.has(p)) throw new Error('not found: ' + p)
      return { content: files.get(p) }
    },
    writeFile: async (p, c) => {
      files.set(p, String(c))
    },
    mkdir: async (p) => {
      dirs.push(p)
    },
  }
}

test('存档路径是 /page/.games/<game>.json（不是裸 /.games）', async () => {
  const fs = memFS()
  const store = createStore({ fs })
  await store.save('gomoku', { game: 'gomoku', current: { id: 'g1' }, history: [] })
  assert.deepEqual([...fs.files.keys()], ['/page/.games/gomoku.json'])
  assert.deepEqual(fs.dirs, ['/page/.games'])
  assert.equal(store.pathOf('chess'), '/page/.games/chess.json')
})

test('存档写入后能回读（刷新恢复的底座）', async () => {
  const fs = memFS()
  const store = createStore({ fs })
  const doc = { game: 'gomoku', current: { id: 'g1', state: { turn: 'black' } }, history: [{ id: 'g0' }] }
  await store.save('gomoku', doc)
  const back = await store.load('gomoku')
  assert.equal(back.game, 'gomoku')
  assert.equal(back.current.id, 'g1')
  assert.equal(back.history.length, 1)
})

test('无存档时 load 返回 null（不抛）', async () => {
  const store = createStore({ fs: memFS() })
  assert.equal(await store.load('gomoku'), null)
})

test('落盘带格式版本号', async () => {
  const fs = memFS()
  const store = createStore({ fs })
  await store.save('gomoku', { game: 'gomoku', current: { id: 'g1' }, history: [] })
  const raw = JSON.parse(fs.files.get('/page/.games/gomoku.json'))
  assert.equal(raw.v, FORMAT_VERSION)
})

test('读档：版本号对得上直接放行', async () => {
  const fs = memFS()
  const store = createStore({ fs })
  await store.save('gomoku', { game: 'gomoku', current: { id: 'g1', state: { turn: 'black' } }, history: [] })
  const back = await store.load('gomoku')
  assert.equal(back.v, FORMAT_VERSION)
  assert.equal(back.current.id, 'g1')
})

test('读档：旧试验版档（无版本号 + 无 state）迁移成新格式', async () => {
  const fs = memFS()
  const board = new Array(225).fill(0)
  board[0] = 1
  fs.files.set('/page/.games/gomoku.json', JSON.stringify({ game: 'gomoku', current: { id: 'g-old', board, turn: 1, phase: 'playing' } }))
  const store = createStore({ fs })
  const back = await store.load('gomoku')
  assert.equal(back.v, FORMAT_VERSION)
  assert.equal(back.current.state.cells[0], 'black')
  assert.equal(back.current.state.turn, 'black')
})

test('读档：1.0.x 的新格式（无版本号但有 state）补上版本号放行', async () => {
  const fs = memFS()
  fs.files.set('/page/.games/gomoku.json', JSON.stringify({ game: 'gomoku', current: { id: 'g1', state: { turn: 'black' } } }))
  const store = createStore({ fs })
  const back = await store.load('gomoku')
  assert.equal(back.v, FORMAT_VERSION)
  assert.equal(back.current.id, 'g1')
})

test('读档：认不出的档直接丢弃（返回 null，不把脏档喂给会话）', async () => {
  const fs = memFS()
  fs.files.set('/page/.games/gomoku.json', JSON.stringify({ game: 'gomoku', current: { id: 'g1', foo: 1 } }))
  const store = createStore({ fs })
  assert.equal(await store.load('gomoku'), null)
})

test('读档：别的游戏的档不认', async () => {
  const fs = memFS()
  fs.files.set('/page/.games/gomoku.json', JSON.stringify({ game: 'chess', current: null }))
  const store = createStore({ fs })
  assert.equal(await store.load('gomoku'), null)
})
