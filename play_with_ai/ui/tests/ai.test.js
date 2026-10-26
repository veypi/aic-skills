// AI 选手组件测试：展示信息只经平台 $ai 资源（agents / sessions）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createAI } from '../core/ai.js'

function fakeAIService({ cached = true } = {}) {
  const calls = []
  return {
    calls,
    open: ({ agentId }) => ({
      state: { id: '' },
      attach: async () => {},
      send: async () => {},
      dispose: () => {},
    }),
    agents: {
      load: async (id) => {
        calls.push(['agents.load', id])
        return { id, name: 'coder' }
      },
    },
    sessions: {
      peek: ({ sessionId }) => {
        calls.push(['sessions.peek', sessionId])
        return cached ? { id: sessionId, model: 'minimax-M2.5', title: '棋局' } : null
      },
      load: async (ref) => {
        calls.push(['sessions.load', ref.sessionId])
        return { id: ref.sessionId, model: 'fallback-model' }
      },
    },
  }
}

test('describe：agent 名字 + 会话模型', async () => {
  const svc = fakeAIService()
  const ai = createAI({ ai: svc })
  const info = await ai.describe({ kind: 'ai', agentId: 'a1', sessionId: 's1' })
  assert.equal(info.agentName, 'coder')
  assert.equal(info.model, 'minimax-M2.5')
  assert.equal(info.title, '棋局')
  // peek 命中 → 不再发 sessions.load
  assert.ok(!svc.calls.some((c) => c[0] === 'sessions.load'))
})

test('describe：会话未缓存时回落到 sessions.load', async () => {
  const svc = fakeAIService({ cached: false })
  const ai = createAI({ ai: svc })
  const info = await ai.describe({ kind: 'ai', agentId: 'a1', sessionId: 's2' })
  assert.equal(info.agentName, 'coder')
  assert.equal(info.model, 'fallback-model')
})

test('describe：非 AI 席位/无 agent 时返回空', async () => {
  const svc = fakeAIService()
  const ai = createAI({ ai: svc })
  assert.deepEqual(await ai.describe({ kind: 'human' }), { agentName: '', model: '', title: '' })
  assert.deepEqual(await ai.describe(null), { agentName: '', model: '', title: '' })
})

function fakePushService({ attach, send } = {}) {
  const calls = []
  const client = {
    state: { id: '' },
    attach: async (sessionId) => {
      calls.push(['attach', sessionId])
      if (attach) await attach(client, sessionId)
      else client.state.id = sessionId
    },
    send: async (msg) => {
      calls.push(['send', msg])
      return send ? send(client, msg) : { ok: true }
    },
    dispose: () => {},
  }
  return { calls, client, open: () => client }
}

test('push：附着原会话并检查发送成功', async () => {
  const svc = fakePushService()
  const ai = createAI({ ai: svc })
  const ok = await ai.push(
    { kind: 'ai', agentId: 'a1', sessionId: 's1' },
    { content: '轮到你了', reminders: ['局面'] },
  )
  assert.equal(ok, true)
  assert.deepEqual(svc.calls.map(c => c[0]), ['attach', 'send'])
  assert.equal(svc.calls[1][1].content, '轮到你了')
})

test('push：attach 静默退挂后不得向新会话发送', async () => {
  const svc = fakePushService({ attach: () => {} })
  const ai = createAI({ ai: svc })
  const ok = await ai.push(
    { kind: 'ai', agentId: 'a1', sessionId: 's1' },
    { content: '不应投递' },
  )
  assert.equal(ok, false)
  assert.deepEqual(svc.calls.map(c => c[0]), ['attach'])
})

test('push：send 返回 ok:false 时不能伪装成功', async () => {
  const svc = fakePushService({ send: () => ({ ok: false, err: new Error('send failed') }) })
  const ai = createAI({ ai: svc })
  const ok = await ai.push(
    { kind: 'ai', agentId: 'a1', sessionId: 's1' },
    { content: '轮到你了' },
  )
  assert.equal(ok, false)
  assert.deepEqual(svc.calls.map(c => c[0]), ['attach', 'send'])
})
