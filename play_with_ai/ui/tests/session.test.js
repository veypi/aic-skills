// 公共组件测试：人机统一执行入口、席位绑定、存档、通知。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createSession } from '../core/session.js'
import * as gomoku from '../games/gomoku.js'

function fakeStore() {
  const docs = new Map()
  return {
    historyCap: 50,
    pathOf: (id) => `/.games/${id}.json`,
    load: async (id) => docs.get(id) || null,
    save: async (id, doc) => {
      docs.set(id, JSON.parse(JSON.stringify(doc)))
    },
  }
}

function fakeAI() {
  const pushes = []
  return {
    pushes,
    push: async (executor, msg) => {
      pushes.push({ executor, msg })
      return true
    },
  }
}

const setup = () => {
  const store = fakeStore()
  const ai = fakeAI()
  const session = createSession({ game: gomoku, store, ai, now: () => 1700000000000 })
  return { session, store, ai }
}

test('AI 认领席位后进入对局，并收到轮次通知', async () => {
  const { session, ai } = setup()
  await session.ready
  const seat = session.claimSeat('sess-1', 'agent-1', 'black')
  assert.equal(seat, 'black')
  assert.equal(session.snapshot().phase, 'playing')
  assert.equal(session.seatOfSession('sess-1'), 'black')
  assert.equal(ai.pushes.length, 1)
  assert.match(ai.pushes[0].msg.content, /轮到你了/)
  assert.match(ai.pushes[0].msg.reminders[0], /五子棋/)
})

test('人机走同一个执行入口：动作对象通用，身份校验不同', async () => {
  const { session } = setup()
  await session.ready
  session.claimSeat('sess-1', 'agent-1', 'black')
  const action = gomoku.parseAction('H8')
  // AI 执行
  session.perform('black', action, { kind: 'ai', sessionId: 'sess-1' })
  assert.equal(session.snapshot().moveCount, 1)
  // 同一入口，人类不能替 AI 的席位落子
  assert.throws(() => session.perform('black', gomoku.parseAction('H9'), { kind: 'human' }), /AI 接管/)
  // 人类在自己（空缺席位）的回合用同一入口落子
  session.perform('white', gomoku.parseAction('H9'), { kind: 'human' })
  assert.equal(session.snapshot().moveCount, 2)
  assert.equal(session.snapshot().state.turn, 'black')
})

test('未绑定会话不能落子', async () => {
  const { session } = setup()
  await session.ready
  session.claimSeat('sess-1', 'agent-1', 'black')
  assert.throws(() => session.perform('white', gomoku.parseAction('H9'), { kind: 'ai', sessionId: 'sess-2' }), /未轮到你|没有指定执行者/)
})

test('席位被别的会话占用时报错', async () => {
  const { session } = setup()
  await session.ready
  session.claimSeat('sess-1', 'agent-1', 'black')
  assert.throws(() => session.claimSeat('sess-2', 'agent-2', 'black'), /已被其他会话占用/)
})

test('认输与重开：归档历史并解绑', async () => {
  const { session } = setup()
  await session.ready
  session.claimSeat('sess-1', 'agent-1', 'black')
  session.perform('black', gomoku.parseAction('H8'), { kind: 'ai', sessionId: 'sess-1' })
  session.resign('black', { kind: 'ai', sessionId: 'sess-1' })
  assert.equal(session.snapshot().phase, 'over')
  session.reset()
  const snap = session.snapshot()
  assert.equal(snap.phase, 'idle')
  assert.equal(snap.moveCount, 0)
  assert.equal(snap.archives.length, 1)
  assert.equal(snap.archives[0].moves, 1)
})

test('存档写入与恢复', async () => {
  const store = fakeStore()
  const ai = fakeAI()
  const s1 = createSession({ game: gomoku, store, ai, now: () => 1700000000000 })
  await s1.ready
  s1.claimSeat('sess-1', 'agent-1', 'black')
  s1.perform('black', gomoku.parseAction('H8'), { kind: 'ai', sessionId: 'sess-1' })
  await new Promise((r) => setTimeout(r, 10)) // 等 persist()

  const s2 = createSession({ game: gomoku, store, ai, now: () => 1700000000000 })
  await s2.ready
  const snap = s2.snapshot()
  assert.equal(snap.moveCount, 1)
  assert.equal(snap.seats.find((x) => x.id === 'black').kind, 'ai')
})
