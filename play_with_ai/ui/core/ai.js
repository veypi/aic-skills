// AI 选手组件：把「轮到某个 AI 席位」翻译成「给该会话推一条消息」。
//
// 组件只负责投递：会话 id + agent id 决定推给谁，消息正文是自然语言，
// 完整局面放在 reminders（system_reminder 注入，不污染对话正文）。
//
// 平台契约：$ai.open({agentId}) → client.attach(sessionId) → client.send({content, reminders})。
// 展示信息（agent 名字 / 会话模型）同样只经平台 $ai 资源（agents / sessions），不走 fetch。

export function createAI({ ai: aiService } = {}) {
  const clients = new Map() // `${agentId}:${sessionId}` → client
  const infos = new Map() // `${agentId}:${sessionId}` → {agentName, model, title}

  async function push(executor, { content, reminders } = {}) {
    if (!aiService || !executor || executor.kind !== 'ai') return false
    const sessionId = executor.sessionId
    const agentId = executor.agentId
    if (!sessionId || !agentId) return false
    const key = `${agentId}:${sessionId}`
    let client = clients.get(key)
    try {
      if (!client) {
        client = aiService.open({ agentId })
        clients.set(key, client)
      }
      if (client.state.id !== sessionId) await client.attach(sessionId)
      // attach 失败会静默退挂；此时 send 会在空 sid 上新建会话，绝不能继续。
      if (client.state.id !== sessionId) return false
      const result = await client.send({ content, reminders })
      return result?.ok === true
    } catch (e) {
      console.warn('play_with_ai: AI 通知投递异常', e)
      return false
    }
  }

  // 展示信息：agent 名字 + 会话模型（供席位面板显示「谁在坐」）
  async function describe(executor) {
    const empty = { agentName: '', model: '', title: '' }
    if (!aiService || !executor || executor.kind !== 'ai') return empty
    const agentId = executor.agentId || ''
    const sessionId = executor.sessionId || ''
    const key = `${agentId}:${sessionId}`
    if (infos.has(key)) return infos.get(key)
    const info = { agentName: '', model: '', title: '' }
    if (agentId) {
      try {
        const agent = await aiService.agents.load(agentId)
        info.agentName = agent?.name || ''
      } catch (_) {
        /* agent 读不到：留空，界面回落到短 id */
      }
    }
    if (sessionId) {
      try {
        const session =
          aiService.sessions.peek({ sessionId }) ||
          (agentId ? await aiService.sessions.load({ agentId, sessionId }) : null)
        info.model = session?.model || ''
        info.title = session?.title || ''
      } catch (_) {
        /* 会话读不到：留空 */
      }
    }
    if (info.agentName || info.model) infos.set(key, info)
    return info
  }

  function dispose() {
    for (const c of clients.values()) {
      try {
        c.dispose?.()
      } catch (_) {
        /* ignore */
      }
    }
    clients.clear()
    infos.clear()
  }

  return { push, describe, dispose }
}
