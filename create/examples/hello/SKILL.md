---
name: hello
version: 0.1.0
nickname: Hello 示例
description: 最小技能界面示例（当前 v6.1 格式）：计数器页面 + 三条 pageDesc 指令，演示 vhtml 页面骨架（@container 窗口响应式）与 AI 指令闭环
keywords: [示例, ui, pageDesc, vhtml, 计数器]
---

# hello（最小界面示例）

最小可用形态：`SKILL.md` + `manifest.json`（`ui.pages`）+ `ui/index.html`，无数据面。
演示两件事：vhtml 页面骨架（含 `@container` 窗口响应式）+ pageDesc 指令（AI 在 page exec JS 中经 `win(id).command(data)` 操控页面）。

> **复制改造**：按 `create/references/cloud-package.md` §4 在 page exec 中用同源 `fetch` 建行，再 `grant fs /skills/{id}` 后把本目录内容写进 `/skills/{id}/`（fs 工具路径）；同步修改 frontmatter 的 `name`、`nickname`/`description`。

## 使用（AI 操作序）

`exec _host=page` 的 `script` 是 async JavaScript 函数体；skill_id 取自 skills 工具的 search/load：

```js
const opened = await open({url: '/skills/cloud/{skill_id}'})
const available = await commands() // 应含 hello_status / hello_inc / hello_reset
const before = await win(opened.win_id).hello_status()
const increased = await win(opened.win_id).hello_inc({by: 3})
const reset = await win(opened.win_id).hello_reset()
return {available, before, increased, reset}
```

## 文件说明

- `ui/index.html`：完整 vhtml 组件（完整 HTML 文档 + `<script setup>`）；状态与指令都在 setup 里声明。
- 无 tables/api：需要数据面时参考 `examples/todo_min`。
