// 页面指令层：AI 经窗口指令与对局交互（与人类点击最终都走 session.perform）。
//
// AI 在 page exec JS 中通过 win(id).command(data) 调用；业务数据直接返回。

export function createCommands({ manager, games }) {
  const gameOf = (id) => games.find((g) => g.id === id)

  async function currentSession() {
    const s = manager.current()
    await s.ready
    return s
  }

  const cmdGames = async () => {
    const lines = ['可用游戏：']
    for (const g of games) {
      lines.push(`- ${g.id}（${g.name}）：席位 ${g.seats.map((s) => `${s.name}[${s.id}]`).join(' / ')}`)
    }
    lines.push(`当前游戏：${manager.currentId()}。用 win(id).start({game, seat}) 绑定并开局。`)
    return lines.join('\n')
  }

  const cmdStart = async (data, ctx) => {
    const gameId = String(data?.game || manager.currentId())
    const game = gameOf(gameId)
    if (!game) throw new Error(`未知游戏「${gameId}」（用 games 查看可用游戏）`)
    if (!ctx || !ctx.sessionId) throw new Error('start: 缺少执行方身份（sessionId）')
    if (gameId !== manager.currentId()) manager.switchGame(gameId)
    const s = manager.current()
    await s.ready
    const seat = s.claimSeat(ctx.sessionId, ctx.agentId || '', String(data?.seat || ''))
    const tail = s.actors().includes(seat) ? '轮到你，请行动。' : '等待对手行动，轮到你时我会收到通知。'
    return `${s.text()}\n你已绑定「${s.seatName(seat)}」。${tail}`
  }

  const cmdStatus = async () => {
    const s = await currentSession()
    return s.text()
  }

  const cmdMoves = async () => {
    const s = await currentSession()
    const list = s.actors()
    if (!list.length) return '当前没有待行动的席位（对局未开始或已结束）。'
    const lines = []
    for (const seatId of list) {
      const acts = s.legalActions(seatId)
      const shown = acts.slice(0, 300).map((a) => s.game.formatAction(a))
      lines.push(`${s.seatName(seatId)} 的合法走法（${acts.length} 个）：${shown.join(' ') || '无'}`)
    }
    return lines.join('\n')
  }

  const cmdRules = async () => {
    const s = await currentSession()
    const g = s.game
    const lines = [`【${g.name}】规则：`, g.rules, '', `走法格式：${g.moveSyntax}`, `席位：${g.seats.map((x) => `${x.name}[${x.id}]`).join(' / ')}`]
    const list = s.actors()
    if (list.length) {
      const acts = s.legalActions(list[0])
      lines.push(`当前轮到 ${s.seatName(list[0])}，合法走法 ${acts.length} 个：${acts.slice(0, 60).map((a) => g.formatAction(a)).join(' ')}`)
    }
    return lines.join('\n')
  }

  const cmdPlay = async (data, ctx) => {
    const s = await currentSession()
    const text = String(data?.text || '').trim()
    if (!text) throw new Error(`play: text 必填（${s.game.moveSyntax}）`)
    const seatId = s.seatOfSession(ctx?.sessionId)
    if (!seatId) throw new Error('play: 会话未绑定席位（先调用 win(id).start({seat})）')
    const action = s.game.parseAction(text)
    if (!action) throw new Error(`play: 无法识别走法「${text}」（${s.game.moveSyntax}）`)
    s.perform(seatId, action, { kind: 'ai', sessionId: ctx.sessionId })
    return s.text()
  }

  const cmdResign = async (data, ctx) => {
    const s = await currentSession()
    const seatId = s.seatOfSession(ctx?.sessionId)
    if (!seatId) throw new Error('resign: 会话未绑定席位（先调用 win(id).start({seat})）')
    s.resign(seatId, { kind: 'ai', sessionId: ctx.sessionId })
    return s.text()
  }

  const cmdReset = async () => {
    const s = await currentSession()
    s.reset()
    return '已清盘归档并解绑双方。调用 win(id).start({seat}) 可开新局。'
  }

  return {
    desc: () => {
      const s = manager.current()
      const phase = s.snapshot().phase
      return `与 AI 对弈（${manager.currentId()}，phase=${phase}）`
    },
    commands: () => [
      { name: 'games', desc: '列出可用游戏、席位与当前游戏', help: 'win(id).games()', handler: cmdGames },
      {
        name: 'start',
        desc: '绑定席位开局（game/seat 可选；缺省取当前游戏与空缺席位）',
        help: 'win(id).start({game: "gomoku" | "chess", seat})\n绑定后你的会话独占该席位的行动权；该席位被占用会报错。对局已结束时调用=开新局。',
        handler: cmdStart,
      },
      { name: 'status', desc: '查看当前对局状态与局面（只读，任何会话可调）', help: 'win(id).status()', handler: cmdStatus },
      { name: 'moves', desc: '列出当前待行动席位的合法走法', help: 'win(id).moves()', handler: cmdMoves },
      { name: 'rules', desc: '查看当前游戏的规则与走法格式', help: 'win(id).rules()', handler: cmdRules },
      {
        name: 'play',
        desc: '走一步棋（如 {text: "H8"} / {text: "b1c3"}）；只能在自己的回合下自己的席位',
        help: 'win(id).play({text})\n走法格式随游戏而异，用 rules 查看。',
        handler: cmdPlay,
      },
      { name: 'resign', desc: '认输（退出对局）', help: 'win(id).resign()', handler: cmdResign },
      { name: 'reset', desc: '清盘归档并解绑双方', help: 'win(id).reset()', handler: cmdReset },
    ],
  }
}
