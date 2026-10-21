// AI 选手组件：把「轮到某个 AI 席位」翻译成「给该会话推一条消息」。
//
// 组件只负责投递：会话 id + agent id 决定推给谁，消息正文是自然语言，
// 完整局面放在 reminders（system_reminder 注入，不污染对话正文）。
//
// 平台契约：$ai.open({agentId}) → client.attach(sessionId) → client.send({content, reminders})。

export function createAI({ ai: aiService } = {}) {
  const clients = new Map() // `${agentId}:${sessionId}` → client

  async function push(executor, { content, reminders } = {}) {
    if (!aiService || !executor || executor.kind !== 'ai') return false
    const sessionId = executor.sessionId
    const agentId = executor.agentId
    if (!sessionId || !agentId) return false
    const key = `${agentId}:${sessionId}`
    let client = clients.get(key)
    if (!client) {
      client = aiService.open({ agentId })
      clients.set(key, client)
    }
    if (client.state.id !== sessionId) await client.attach(sessionId)
    await client.send({ content, reminders })
    return true
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
  }

  return { push, dispose }
}
