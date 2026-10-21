// 多游戏管理：每个游戏一个对局会话（各自独立存档），页面当前只显示其中一个。
// 游戏开发者只需在 games/index.js 注册新游戏，这里与页面都不用改。

import { createSession } from './session.js'

export function createManager({ games, store, ai, now }) {
  const sessions = new Map()
  const listeners = []
  let currentId = games.length ? games[0].id : ''

  function emit() {
    for (const fn of listeners) {
      try {
        fn()
      } catch (e) {
        console.warn('play_with_ai listener failed:', e)
      }
    }
  }

  function session(gameId) {
    const id = gameId || currentId
    let s = sessions.get(id)
    if (!s) {
      const game = games.find((g) => g.id === id)
      if (!game) throw new Error(`未知游戏：${id}`)
      s = createSession({ game, store, ai, now })
      s.onChange(emit)
      sessions.set(id, s)
    }
    return s
  }

  function switchGame(id) {
    if (!games.some((g) => g.id === id)) throw new Error(`未知游戏：${id}`)
    currentId = id
    emit()
    return id
  }

  return {
    games,
    session,
    current: () => session(currentId),
    currentId: () => currentId,
    switchGame,
    onChange: (fn) => listeners.push(fn),
    snapshot: () => session(currentId).snapshot(),
  }
}
