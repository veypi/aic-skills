---
name: hello
nickname: Hello 示例
description: 最小技能界面示例（当前 v5 格式）：计数器页面 + 三条 pageDesc 指令，演示 vhtml 页面骨架（@container 窗口响应式）与 AI 指令闭环
keywords: [示例, ui, pageDesc, vhtml, 计数器]
ui:
  - path: index.html
    desc: 主界面（计数器）
---

# hello（最小界面示例）

最小可用形态：只有 `SKILL.md` + `ui/index.html`，无数据面。
演示两件事：vhtml 页面骨架（含 `@container` 窗口响应式）+ pageDesc 指令（AI 经 `{win_id}.{cmd}` 操控页面）。

> **复制改造**：`POST /api/skills {"name": "{你的名字}"}` 建行得 `/skills/{id}/` 工作区，把本目录内容经 fs 门 PUT 进去，同步修改：frontmatter 的 `name`、`nickname`/`description`。

## 使用（AI 操作序，均为 exec 1host=page 通道）

```
open /skills/{skill_id}      # 打开页面；skill_id 取自 skill search/load
list                          # 拿 win_id；events 列应含 hello_status / hello_inc / hello_reset
{win_id}.hello_status         # → {"ok":true,"count":0}
{win_id}.hello_inc --by 3     # 计数 +3 → {"ok":true,"count":3}
{win_id}.hello_reset          # 归零
```

## 文件说明

- `ui/index.html`：完整 vhtml 组件（完整 HTML 文档 + `<script setup>`）；状态与指令都在 setup 里声明。
- 无 tables/api：需要数据面时参考 `examples/todo_min`。
