// 页面指令层：AI 经窗口指令与对局交互（与人类点击最终都走 session.perform）。
//
// 指令是窗口级命名空间（{win_id}.{cmd}），故不需要额外前缀；平台根命令
// （list / open / close / reload / curl）不会被占用。

export function createCommands({ manager, games }) {
  const gameOf = (id) => games.find((g) => g.id === id)

  async function currentSession() {
    const s = manager.current()
    await s.ready
    return s
  }

  // --game / --seat（--side 为别名）；裸参数当作席位
  function parseArgs(argv) {
    const out = { game: '', seat: '' }
    const args = (argv || []).map((a) => String(a))
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '--game' || a === '--g') out.game = String(args[++i] || '')
      else if (a.startsWith('--game=')) out.game = a.slice(7)
      else if (a === '--seat' || a === '--side') out.seat = String(args[++i] || '')
      else if (a.startsWith('--seat=')) out.seat = a.slice(7)
      else if (a.startsWith('--side=')) out.seat = a.slice(7)
      else if (!a.startsWith('-') && !out.seat) out.seat = a
    }
    return out
  }

  const cmdGames = async () => {
    const lines = ['可用游戏：']
    for (const g of games) {
      lines.push(`- ${g.id}（${g.name}）：席位 ${g.seats.map((s) => `${s.name}[${s.id}]`).join(' / ')}`)
    }
    lines.push(`当前游戏：${manager.currentId()}。用 start --game <id> --seat <席位> 绑定并开局。`)
    return { content: lines.join('\n') }
  }

  const cmdStart = async (argv, ctx) => {
    const args = parseArgs(argv)
    const gameId = args.game || manager.currentId()
    const game = gameOf(gameId)
    if (!game) throw new Error(`未知游戏「${gameId}」（用 games 查看可用游戏）`)
    if (!ctx || !ctx.sessionId) throw new Error('start: 缺少执行方身份（sessionId）')
    if (gameId !== manager.currentId()) manager.switchGame(gameId)
    const s = manager.current()
    await s.ready
    const seat = s.claimSeat(ctx.sessionId, ctx.agentId || '', args.seat)
    const tail = s.actors().includes(seat) ? '轮到你，请行动。' : '等待对手行动，轮到你时我会收到通知。'
    return { content: `${s.text()}\n你已绑定「${s.seatName(seat)}」。${tail}` }
  }

  const cmdStatus = async () => {
    const s = await currentSession()
    return { content: s.text() }
  }

  const cmdMoves = async () => {
    const s = await currentSession()
    const list = s.actors()
    if (!list.length) return { content: '当前没有待行动的席位（对局未开始或已结束）。' }
    const lines = []
    for (const seatId of list) {
      const acts = s.legalActions(seatId)
      const shown = acts.slice(0, 300).map((a) => s.game.formatAction(a))
      lines.push(`${s.seatName(seatId)} 的合法走法（${acts.length} 个）：${shown.join(' ') || '无'}`)
    }
    return { content: lines.join('\n') }
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
    return { content: lines.join('\n') }
  }

  const cmdPlay = async (argv, ctx) => {
    const s = await currentSession()
    const text = (argv || []).map((a) => String(a)).join(' ').trim()
    if (!text) throw new Error(`play: 缺少走法（${s.game.moveSyntax}）`)
    const seatId = s.seatOfSession(ctx?.sessionId)
    if (!seatId) throw new Error('play: 会话未绑定席位（先 start --seat <席位>）')
    const action = s.game.parseAction(text)
    if (!action) throw new Error(`play: 无法识别走法「${text}」（${s.game.moveSyntax}）`)
    s.perform(seatId, action, { kind: 'ai', sessionId: ctx.sessionId })
    return { content: s.text() }
  }

  const cmdResign = async (argv, ctx) => {
    const s = await currentSession()
    const seatId = s.seatOfSession(ctx?.sessionId)
    if (!seatId) throw new Error('resign: 会话未绑定席位（先 start --seat <席位>）')
    s.resign(seatId, { kind: 'ai', sessionId: ctx.sessionId })
    return { content: s.text() }
  }

  const cmdReset = async () => {
    const s = await currentSession()
    s.reset()
    return { content: '已清盘归档并解绑双方。start 可开新局。' }
  }

  return {
    desc: () => {
      const s = manager.current()
      const phase = s.snapshot().phase
      return `与 AI 对弈（${manager.currentId()}，phase=${phase}）`
    },
    commands: () => [
      { name: 'games', desc: '列出可用游戏、席位与当前游戏', help: 'games：无参数', handler: cmdGames },
      {
        name: 'start',
        desc: '绑定席位开局（--game <id> --seat <席位>；缺省取当前游戏与空缺席位）',
        help: 'start [--game gomoku|chess] [--seat <席位>]\n绑定后你的会话独占该席位的行动权；该席位被占用会报错。对局已结束时调用=开新局。',
        handler: cmdStart,
      },
      { name: 'status', desc: '查看当前对局状态与局面（只读，任何会话可调）', help: 'status：无参数', handler: cmdStatus },
      { name: 'moves', desc: '列出当前待行动席位的合法走法', help: 'moves：无参数', handler: cmdMoves },
      { name: 'rules', desc: '查看当前游戏的规则与走法格式', help: 'rules：无参数', handler: cmdRules },
      {
        name: 'play',
        desc: '走一步棋（如 play H8 / play b1c3）；只能在自己的回合下自己的席位',
        help: 'play <走法>\n走法格式随游戏而异，用 rules 查看。',
        handler: cmdPlay,
      },
      { name: 'resign', desc: '认输（退出对局）', help: 'resign：无参数', handler: cmdResign },
      { name: 'reset', desc: '清盘归档并解绑双方', help: 'reset：无参数', handler: cmdReset },
    ],
  }
}
