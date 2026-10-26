// 对局会话：席位、执行者绑定、**统一执行入口**。
//
// 设计要点（公共组件，游戏开发者不用管）：
//   · 席位（seat）由游戏核心声明，数量与含义由游戏决定，组件不设上限（≥2）；
//   · 每个席位挂一个「执行者」：human（人类玩家）或 ai（某个 AI 会话）；
//   · 人类点击与 AI 指令最终都调用同一个入口 perform(seatId, action, executor)；
//   · 轮次调度由游戏核心决定（game.actors(state)），组件只负责通知与存档；
//   · 认输/重开/归档等会话级操作也在组件里，与游戏无关。

export function createSession({ game, store, ai, now = () => Date.now() }) {
  const seatById = new Map(game.seats.map((s) => [s.id, s]))
  const seatName = (id) => (seatById.get(id) ? seatById.get(id).name : id)

  let doc = { game: game.id, current: null, history: [] }
  const listeners = []
  let ready = Promise.resolve()

  const cur = () => doc.current

  function freshCurrent() {
    return {
      id: 'g' + now().toString(36) + Math.random().toString(36).slice(2, 6),
      state: game.newState(),
      executors: {}, // seatId → {kind:'human'} | {kind:'ai', sessionId, agentId}
      phase: 'idle', // idle | playing | over
      moves: [], // [{n, seatId, action, text, t}]
      resigned: [], // 已认输席位
      created_at: now(),
      updated_at: now(),
    }
  }

  // ---- 变更与持久化 ----

  function emitChange() {
    for (const fn of listeners) {
      try {
        fn()
      } catch (e) {
        console.warn('play_with_ai listener failed:', e)
      }
    }
  }

  function changed() {
    persist()
    emitChange()
  }

  function persist() {
    if (!store) return
    store.save(game.id, doc).catch((e) => console.warn('play_with_ai save failed:', e))
  }

  function onChange(fn) {
    listeners.push(fn)
    return () => {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  }

  // ---- 载入 ----

  // 局面结构对不上（规则改过 / 旧档格式不同）就丢弃旧局，避免脏数据。
  // 注意：c.state 可能是 undefined（旧档没有 state 字段）——直接 `k in c.state`
  // 会抛「Cannot use 'in' operator」，整页启动脚本挂掉 → 白屏。
  function sameShape(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false
    const probe = game.newState()
    return Object.keys(probe).every((k) => k in state) && Object.keys(state).every((k) => k in probe)
  }

  async function load() {
    try {
      const saved = store ? await store.load(game.id) : null
      if (saved && saved.current) {
        const c = saved.current
        if (sameShape(c.state)) {
          doc = {
            game: game.id,
            current: {
              id: c.id || freshCurrent().id,
              state: c.state,
              executors: c.executors || {},
              phase: c.phase || 'idle',
              moves: Array.isArray(c.moves) ? c.moves : [],
              resigned: Array.isArray(c.resigned) ? c.resigned : [],
              created_at: c.created_at || now(),
              updated_at: c.updated_at || now(),
            },
            history: Array.isArray(saved.history) ? saved.history : [],
          }
        } else {
          console.warn(`play_with_ai: 存档局面结构对不上（${game.id}），已丢弃旧局`)
        }
      }
    } catch (e) {
      // 存档坏了也不能让页面起不来：记一笔，按新局继续
      console.warn('play_with_ai load failed:', e)
    }
    ready = Promise.resolve(doc)
    emitChange()
    return doc
  }
  ready = load()

  // ---- 席位与执行者 ----

  function actors() {
    const c = cur()
    if (!c || c.phase === 'over') return []
    const list = game.actors ? game.actors(c.state) : [c.state.turn]
    return list.filter((id) => seatById.has(id) && !c.resigned.includes(id))
  }

  function legalActions(seatId) {
    const c = cur()
    if (!c) return []
    return game.legalActions(c.state, seatId) || []
  }

  function seatOfSession(sessionId) {
    const c = cur()
    if (!c || !sessionId) return ''
    for (const [seatId, ex] of Object.entries(c.executors)) {
      if (ex.kind === 'ai' && ex.sessionId === sessionId) return seatId
    }
    return ''
  }

  function assertExecutor(seatId, executor) {
    const c = cur()
    const ex = (c.executors || {})[seatId] || null
    const kind = (executor && executor.kind) || 'human'
    if (!ex) {
      if (kind !== 'human') throw new Error(`席位「${seatName(seatId)}」没有指定执行者，AI 不能落子`)
      return
    }
    if (ex.kind !== kind) {
      throw new Error(
        kind === 'ai'
          ? `席位「${seatName(seatId)}」由${ex.kind === 'human' ? '人类玩家' : '另一个 AI 会话'}接管，不能由 AI 落子`
          : `席位「${seatName(seatId)}」由 AI 接管，请等 AI 落子`,
      )
    }
    if (kind === 'ai' && ex.sessionId !== executor.sessionId) throw new Error(`席位「${seatName(seatId)}」属于另一个会话`)
  }

  // AI 认领一个席位（幂等：同一会话重复绑定同一席位直接返回）
  function claimSeat(sessionId, agentId, seatId) {
    if (!sessionId) throw new Error('缺少执行方身份（sessionId）')
    let c = cur()
    if (c && c.phase === 'over') {
      // 上一局已结束：归档并开新局
      archiveCurrent()
      c = null
    }
    if (!c) {
      c = freshCurrent()
      doc.current = c
    }
    let target = seatId
    if (target) {
      if (!seatById.has(target)) {
        throw new Error(`未知席位「${target}」（本游戏席位：${game.seats.map((s) => s.name).join(' / ')}）`)
      }
      const ex = c.executors[target]
      if (ex && ex.kind === 'ai' && ex.sessionId !== sessionId) {
        throw new Error(`席位「${seatName(target)}」已被其他会话占用`)
      }
      if (ex && ex.kind === 'human') throw new Error(`席位「${seatName(target)}」已被人类玩家接管`)
    } else {
      target = game.seats.find((s) => !c.executors[s.id])?.id || ''
      if (!target) throw new Error('所有席位都已被占用')
    }
    c.executors[target] = { kind: 'ai', sessionId, agentId }
    c.phase = 'playing'
    c.updated_at = now()
    changed()
    watchNotification(notify())
    return target
  }

  // 人类玩家接管一个席位（页面按钮）
  function bindHuman(seatId) {
    const c = cur()
    if (!c) throw new Error('对局尚未开始')
    const ex = c.executors[seatId]
    if (ex && ex.kind === 'ai') throw new Error(`席位「${seatName(seatId)}」由 AI 接管`)
    c.executors[seatId] = { kind: 'human' }
    c.phase = 'playing'
    c.updated_at = now()
    changed()
    return seatId
  }

  function releaseSeat(seatId) {
    const c = cur()
    if (!c) return
    delete c.executors[seatId]
    c.updated_at = now()
    changed()
  }

  // 人类点「开始对局」：进入对局中（席位仍可空着，由人类代打）
  function begin() {
    let c = cur()
    if (!c) {
      c = freshCurrent()
      doc.current = c
    }
    if (c.phase === 'over') {
      archiveCurrent()
      c = freshCurrent()
      doc.current = c
    }
    c.phase = 'playing'
    c.updated_at = now()
    changed()
    return c
  }

  // ---- 统一执行入口（人类与 AI 共用） ----

  function perform(seatId, action, executor) {
    const c = cur()
    if (!c) throw new Error('对局尚未开始（先 start 或点「开始对局」）')
    if (c.phase === 'over') throw new Error('对局已结束（用 reset 开新局）')
    assertExecutor(seatId, executor)
    const list = actors()
    if (!list.includes(seatId)) {
      throw new Error(`未轮到你（当前待行动：${list.map(seatName).join('、') || '无'}）`)
    }
    const res = game.applyAction(c.state, action, seatId) // 非法动作在此抛错（带原因）
    c.state = res.state
    c.phase = res.over ? 'over' : 'playing'
    c.moves.push({ n: c.moves.length + 1, seatId, action, text: game.formatAction(action), t: now() })
    c.updated_at = now()
    changed()
    if (res.over) watchNotification(notifyAll(res.note || '对局结束。'))
    else watchNotification(notify())
    return res
  }

  // 认输：该席位退出对局；若只剩一个未弃权席位则其获胜
  function resign(seatId, executor) {
    const c = cur()
    if (!c) throw new Error('对局尚未开始')
    if (c.phase === 'over') throw new Error('对局已结束')
    assertExecutor(seatId, executor)
    if (!c.resigned.includes(seatId)) c.resigned.push(seatId)
    const alive = game.seats.map((s) => s.id).filter((id) => !c.resigned.includes(id))
    if (alive.length <= 1) {
      c.phase = 'over'
      c.state = { ...c.state, over: true, winner: alive[0] || null }
      changed()
      watchNotification(notifyAll(`对局结束：${seatName(seatId)}认输，${alive[0] ? seatName(alive[0]) : '无人'}获胜。`))
    } else {
      c.updated_at = now()
      changed()
      watchNotification(notifyAll(`${seatName(seatId)}认输，对局继续。`))
    }
    return c
  }

  // ---- 归档 / 重开 ----

  function archiveCurrent() {
    const c = cur()
    if (!c || !c.moves.length) return
    doc.history.push({
      id: c.id,
      state: c.state,
      moves: c.moves,
      winner: c.state.winner || null,
      result: c.phase === 'over' && c.state.winner ? `${seatName(c.state.winner)}胜` : '未完成',
      created_at: c.created_at,
      ended_at: now(),
    })
    const cap = store ? store.historyCap : 50
    if (doc.history.length > cap) doc.history = doc.history.slice(-cap)
  }

  function reset() {
    const c = cur()
    const exs = c ? Object.values(c.executors || {}) : []
    const finalText = c ? text() : ''
    archiveCurrent()
    doc.current = freshCurrent()
    changed()
    // 告知被解绑的 AI：这一局结束了
    for (const ex of exs) {
      if (!ex || ex.kind !== 'ai') continue
      watchNotification(ai.push(ex, { content: '对局已被结束（未完成，已归档）。', reminders: [finalText] }))
    }
    return doc.current
  }

  // ---- 通知（AI 选手） ----

  // 对局动作不能被通知投递阻塞；但失败必须可见，且不能变成未捕获 rejection。
  function watchNotification(p) {
    Promise.resolve(p).then(ok => {
      if (ok === false) console.warn('play_with_ai: AI 通知投递失败')
    }).catch(e => console.warn('play_with_ai: AI 通知投递异常', e))
  }

  async function notify() {
    const c = cur()
    if (!c || c.phase === 'over') return true
    let ok = true
    for (const seatId of actors()) {
      const ex = c.executors[seatId]
      if (!ex || ex.kind !== 'ai') continue
      const delivered = await ai.push(ex, {
        content: `轮到你了（${seatName(seatId)}）——请行动。`,
        reminders: [text() + `\n用 play <走法> 行动（如 ${game.moveExample}）。`],
      })
      if (!delivered) ok = false
    }
    return ok
  }

  async function notifyAll(content) {
    const c = cur()
    if (!c) return true
    let ok = true
    for (const ex of Object.values(c.executors)) {
      if (!ex || ex.kind !== 'ai') continue
      if (!(await ai.push(ex, { content, reminders: [text()] }))) ok = false
    }
    return ok
  }

  // ---- 对外视图 ----

  function who(seatId) {
    const ex = cur()?.executors?.[seatId]
    if (!ex) return '人类'
    return ex.kind === 'ai' ? 'AI' : '人类'
  }

  function text() {
    const c = cur()
    if (!c) {
      return (
        `[${game.name}] 尚未开局。席位：${game.seats.map((s) => s.name).join(' / ')}。` +
        `用 start --seat <席位> 绑定阵营开始。`
      )
    }
    const head =
      `[${game.name}] ${c.phase === 'idle' ? '待开局' : `第 ${c.moves.length} 手后局面`}` +
      `（${game.seats.map((s) => `${s.name}${s.symbol}=${who(s.id)}`).join('，')}）：`
    const lines = [head, game.textView(c.state)]
    const list = actors()
    if (c.phase === 'over') {
      lines.push(c.state.winner ? `对局结束：${seatName(c.state.winner)}胜。` : '对局结束。')
    } else if (list.length) {
      lines.push(`当前回合：${list.map(seatName).join('、')}（${who(list[0])}）。`)
    } else {
      lines.push('没有可行动的席位。')
    }
    return lines.join('\n')
  }

  function snapshot() {
    const c = cur()
    const state = c ? c.state : game.newState()
    const list = actors()
    return {
      gameId: game.id,
      gameName: game.name,
      phase: c ? c.phase : 'idle',
      seats: game.seats.map((s) => {
        const ex = c?.executors?.[s.id]
        return {
          id: s.id,
          name: s.name,
          symbol: s.symbol,
          kind: ex ? ex.kind : 'open',
          who: ex ? (ex.kind === 'ai' ? 'AI' : '人类') : '空位',
          agentId: ex?.agentId || '',
          sessionId: ex?.sessionId || '',
          acting: list.includes(s.id),
        }
      }),
      acting: list,
      turn: state.turn || game.first,
      moveCount: c ? c.moves.length : 0,
      moves: c ? c.moves.slice() : [],
      over: !!(c && c.state.over),
      winner: (c && c.state.winner) || null,
      state,
      archives: doc.history
        .slice()
        .sort((a, b) => b.ended_at - a.ended_at)
        .map((h) => ({ id: h.id, ended_at: h.ended_at, result: h.result, moves: h.moves.length, state: h.state })),
    }
  }

  return {
    game,
    get ready() {
      return ready
    },
    onChange,
    load,
    text,
    snapshot,
    actors,
    legalActions,
    seatName,
    seatOfSession,
    claimSeat,
    bindHuman,
    releaseSeat,
    begin,
    perform,
    resign,
    reset,
    archiveCurrent,
    notify,
  }
}
