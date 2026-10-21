// 指令层集成测试：两个 AI 会话经页面指令对弈一局。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createManager } from '../core/manager.js'
import { createCommands } from '../core/commands.js'
import { GAMES } from '../games/index.js'

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

function setup() {
  const store = fakeStore()
  const ai = fakeAI()
  const manager = createManager({ games: GAMES, store, ai })
  const commands = createCommands({ manager, games: GAMES })
  const cmd = (name) => commands.commands().find((c) => c.name === name).handler
  return { manager, ai, cmd }
}

const ctx = (sessionId, agentId) => ({ sessionId, agentId })

test('两个 AI 会话各绑一方，走完一轮并互推通知', async () => {
  const { manager, ai, cmd } = setup()
  await manager.current().ready

  const games = await cmd('games')([], ctx('s1', 'a1'))
  assert.match(games.content, /gomoku/)
  assert.match(games.content, /chess/)

  // 黑方归 s1，白方归 s2
  const start1 = await cmd('start')(['--game', 'gomoku', '--seat', 'black'], ctx('s1', 'a1'))
  assert.match(start1.content, /你已绑定「黑方」/)
  const start2 = await cmd('start')(['--game', 'gomoku', '--seat', 'white'], ctx('s2', 'a2'))
  assert.match(start2.content, /你已绑定「白方」/)

  // 黑方先手：s1 收到通知
  const toS1 = ai.pushes.filter((p) => p.executor.sessionId === 's1')
  assert.ok(toS1.length >= 1)
  assert.match(toS1[0].msg.reminders[0], /五子棋/)

  // 非当前回合的一方不能走
  await assert.rejects(() => cmd('play')(['H9'], ctx('s2', 'a2')), /未轮到你/)

  // s1 落子 → s2 收到通知
  const play1 = await cmd('play')(['H8'], ctx('s1', 'a1'))
  assert.match(play1.content, /第 1 手后局面/)
  const toS2 = ai.pushes.filter((p) => p.executor.sessionId === 's2')
  assert.ok(toS2.length >= 1)
  assert.match(toS2[0].msg.content, /轮到你了/)

  // s2 落子
  const play2 = await cmd('play')(['H9'], ctx('s2', 'a2'))
  assert.match(play2.content, /第 2 手后局面/)

  // status / moves / rules
  const status = await cmd('status')([], ctx('s3', 'a3'))
  assert.match(status.content, /黑方●=AI/)
  const moves = await cmd('moves')([], ctx('s3', 'a3'))
  assert.match(moves.content, /合法走法/)
  const rules = await cmd('rules')([], ctx('s3', 'a3'))
  assert.match(rules.content, /五枚同色棋子/)
})

test('走法格式错误给出可读报错；认输与重开', async () => {
  const { manager, cmd } = setup()
  await manager.current().ready
  await cmd('start')(['--game', 'chess', '--seat', 'red'], ctx('s1', 'a1'))
  await assert.rejects(() => cmd('play')(['xx'], ctx('s1', 'a1')), /无法识别走法/)
  const play = await cmd('play')(['b1c3'], ctx('s1', 'a1'))
  assert.match(play.content, /第 1 手后局面/)
  const resign = await cmd('resign')([], ctx('s1', 'a1'))
  assert.match(resign.content, /对局结束/)
  const reset = await cmd('reset')([], ctx('s1', 'a1'))
  assert.match(reset.content, /清盘归档/)
})

test('未绑定席位的会话不能落子', async () => {
  const { manager, cmd } = setup()
  await manager.current().ready
  await cmd('start')(['--game', 'gomoku', '--seat', 'black'], ctx('s1', 'a1'))
  await assert.rejects(() => cmd('play')(['H8'], ctx('other', 'a9')), /未绑定席位/)
})
