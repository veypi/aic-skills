# 写一个新游戏（游戏核心契约）

本包分三层：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| **游戏核心** | `ui/games/<id>.js` | 纯规则：局面、合法走法、结算、文本局面、绘制 |
| **公共组件** | `ui/core/*` | 席位与执行者、统一执行入口、存档、AI 选手、指令层 |
| **页面** | `ui/index.html` | 人类交互适配 + 渲染 |

**游戏开发者只写第一层**：不需要关心对面是人还是 AI、也不需要关心几个席位——公共组件负责
「谁该行动、怎么通知、存哪、怎么校验身份」。

## 加一个游戏的三个步骤

1. 新建 `ui/games/<id>.js`，实现下面的契约（复制 `gomoku.js` 或 `chess.js` 当模板）。
2. 在 `ui/games/index.js` 注册：`import * as mygame from './mygame.js'` → 加进 `GAMES`。
3. 在 `SKILL.md` 补一节（规则、席位、走法格式），并 bump `SKILL.md` 的 `version:`。

不需要改引擎、不需要改页面、不需要改指令层。

## 核心契约

一个游戏模块导出一个对象（`export const ...` 或 `export default {...}` 均可，注册表用 `import *` 收集）。

### 必填

| 字段 | 说明 |
| --- | --- |
| `id` | 游戏标识（指令参数 `--game <id>` 用它） |
| `name` | 显示名（按钮、标题） |
| `seats` | 席位数组 `[{id, name, symbol}]`——**数量由游戏自己定，框架不设上限**（最低两人） |
| `first` | 先手席位 id |
| `board` | `{cols, rows}`：交叉点数量（落子与线条都落在交叉点上） |
| `newState()` | 新局面：至少含 `turn`（当前待行动席位 id）与局面数据 |
| `parseAction(text)` | 指令文本 → 动作对象；**只做语法解析**，解析不了返回 `null` |
| `formatAction(action)` | 动作 → 文本（写进棋谱、回报给 AI） |
| `legalActions(state, seatId)` | 该席位此刻的合法动作数组；不是它的回合返回 `[]` |
| `applyAction(state, action, actorSeatId)` | 执行动作 → `{state, over, winner, note}`；非法动作在此 `throw new Error('原因')`（原因会原样回给 AI） |
| `textView(state)` | 局面文本（进 system_reminder，AI 靠它读盘） |
| `draw(g, state, geom)` | 绘制到 canvas 2d 上下文 |
| `cellAt(geom, px, py)` | 像素 → 交叉点 `{x, y}` 或 `null` |

### 选填

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `actors(state)` | `[state.turn]` | 本轮待行动的席位数组——多人**同时**行动的游戏覆盖它 |
| `paddingRatio` | `0.8` | 边距 = `cell × ratio` |
| `selectSource` | `false` | `true` = 需要「选子 → 目标」两步（象棋类）；`false` = 单击即成（落子类） |
| `rules` | — | 给 AI 的规则文本（`rules` 指令返回） |
| `moveSyntax` | — | 走法格式说明（错误提示与 `rules` 都用它） |
| `moveExample` | — | 一个合法走法示例（通知里告诉 AI 怎么走） |
| `pickAt(state, seatId, cell, pending)` | — | 人类点击 → `{action}` \| `{select:true, candidates}` \| `null`；不实现则页面按 `selectSource` 走默认路径 |

### 动作对象

动作是**游戏内部**的形状，公共组件不解析它，只负责把它交给 `applyAction`：

```js
// 落子型（五子棋）
{ type: 'move', to: { x, y } }
// 走子型（象棋）
{ type: 'move', from: { x, y }, to: { x, y } }
```

人类点击与 AI 指令最终都变成动作，再走同一个 `session.perform(seatId, action, executor)`。

### 局面对象

`state` 必须是**可 JSON 序列化**的纯数据（存档直接存它）：局面 + `turn` + `over` / `winner` + `lastMove`。
不要把类实例、函数、Map 放进 state。

## 公共组件已经替你做的事

- **席位与执行者**：每个席位挂一个执行者（`human` / `ai`）。一个席位只能有一个执行者；
  AI 用 `start --seat` 认领，人类在页面上点「我来」。
- **统一执行入口**：`perform(seatId, action, executor)` 校验「轮次 + 身份 + 动作合法性」，
  然后结算、记谱、存档、通知下一方。人类与 AI 的差别只体现在 `executor` 上。
- **回合调度**：`game.actors(state)` 给出本轮待行动席位，公共组件给其中的 AI 席位推送通知
  （正文是自然语言，完整局面放 `reminders`）。
- **存档**：每个游戏一份整档 `/.games/<id>.json`（当前局 + 席位归属 + 历史归档，cap 50）。
- **指令层**：`games / start / status / moves / rules / play / resign / reset`，与游戏无关。

## 自测

游戏核心是纯 JS（不碰 DOM），可以直接在 node 里测：

```sh
cd play_with_ai/ui
node --test
```

新增游戏时在 `ui/tests/` 加一个 `<id>.test.js`：至少覆盖初始局面、走法解析、
一条典型合法着法与几条典型非法着法（马腿/塞象眼/过河/照面/应将之类）。
