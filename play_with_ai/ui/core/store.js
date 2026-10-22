// 存档组件：每个游戏一份整档（当前局 + 历史归档），落在页面本地 OPFS。
// 存档跟随浏览器（换设备不可见）；换端共享请另存到云端用户空间。
//
// 路径约定：$fs 走**完整树路径**——页面本地是 /page/...（不是裸 /.games），
// 云端用户空间是 /cloud/u/{uid}/...，设备是 /{host_id}/...。
//
// 整档结构：
// {
//   game: 'gomoku',
//   v: 2,                      // 存档格式版本（结构变了就 bump）
//   current: {
//     id, state,                 // state = 游戏核心的纯局面
//     executors: { seatId: {kind:'human'} | {kind:'ai', sessionId, agentId} },
//     phase: 'idle' | 'playing' | 'over',
//     moves: [ {n, seatId, action, text, t} ],
//     resigned: [seatId],
//     created_at, updated_at
//   },
//   history: [ {id, state, moves, winner, result, created_at, ended_at} ]
// }

import { migrateLegacy } from './legacy.js'

// 存档格式版本：结构不兼容时 bump；读档时版本对不上 → 迁移或丢弃，绝不硬解
export const FORMAT_VERSION = 2

export function createStore({ fs, dir = '/page/.games', historyCap = 50, now = () => Date.now() }) {
  const pathOf = (gameId) => `${dir}/${gameId}.json`

  async function load(gameId) {
    if (!fs) return null
    let d = null
    try {
      const f = await fs.readFile(pathOf(gameId))
      const raw = typeof f.content === 'string' ? f.content : await f.content.text()
      d = JSON.parse(raw)
    } catch (_) {
      return null // 无存档（或读坏了）：全新开始
    }
    if (!d || d.game !== gameId) return null
    if (d.v === FORMAT_VERSION) return d
    // 无版本号：可能是 1.0.x 的新格式（当时还没写版本号），也可能是旧试验版的格式
    if (d.current && d.current.state && typeof d.current.state === 'object') {
      return { ...d, v: FORMAT_VERSION }
    }
    const migrated = migrateLegacy(d, gameId)
    if (migrated) return { ...migrated, v: FORMAT_VERSION }
    console.warn(`play_with_ai: 存档格式不认识（${gameId}），已丢弃旧档`)
    return null
  }

  async function save(gameId, doc) {
    if (!fs) return
    await fs.mkdir(dir).catch(() => {})
    await fs.writeFile(pathOf(gameId), JSON.stringify({ ...doc, v: FORMAT_VERSION, updated_at: now() }))
  }

  return { pathOf, load, save, dir, historyCap }
}
