// 游戏注册表：新增小游戏只需在这里加一行（核心实现在 games/<id>.js）。
// 框架不限制游戏人数——席位数量与规则由各游戏自己声明。

import * as gomoku from './gomoku.js'
import * as chess from './chess.js'

export const GAMES = [gomoku, chess]

export const gameById = (id) => GAMES.find((g) => g.id === id)
