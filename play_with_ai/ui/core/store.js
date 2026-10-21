// 存档组件：每个游戏一份整档（当前局 + 历史归档），落在页面本地 OPFS。
// 存档跟随浏览器（换设备不可见）；换端共享请另存到云端用户空间。
//
// 路径约定：$fs 走**完整树路径**——页面本地是 /page/...（不是裸 /.games），
// 云端用户空间是 /cloud/u/{uid}/...，设备是 /{host_id}/...。
//
// 整档结构：
// {
//   game: 'gomoku',
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

export function createStore({ fs, dir = '/page/.games', historyCap = 50, now = () => Date.now() }) {
  const pathOf = (gameId) => `${dir}/${gameId}.json`

  async function load(gameId) {
    if (!fs) return null
    try {
      const f = await fs.readFile(pathOf(gameId))
      const raw = typeof f.content === 'string' ? f.content : await f.content.text()
      const d = JSON.parse(raw)
      if (d && d.game === gameId) return d
    } catch (_) {
      /* 无存档：全新开始 */
    }
    return null
  }

  async function save(gameId, doc) {
    if (!fs) return
    await fs.mkdir(dir).catch(() => {})
    await fs.writeFile(pathOf(gameId), JSON.stringify({ ...doc, updated_at: now() }))
  }

  return { pathOf, load, save, dir, historyCap }
}
