---
name: todo_min
nickname: 待办清单示例
description: 最小活 skill 示例（L2+L3+L4）：待办清单——ui 页面 + tables 声明 + sqlx 接口 + pageDesc 指令的完整链路，含行级隔离与自测指令
keywords: [示例, 待办, tables, sqlx, 数据面, pageDesc]
ui:
  - path: index.html
    desc: 待办清单主界面
---

# todo_min（最小活 skill 示例）

四件套完整链路：`ui/`（界面）+ `tables/todos.json`（存储声明）+ `api/*.sqlx`（5 条接口）+ pageDesc 指令。

> **复制改造**：把本目录复制为 `/u/{uid}/skills/{你的名字}/`，同步修改：目录名、本文件 frontmatter 的 `name`、`nickname`/`description`。

## 数据面（页面与 AI 共用，行级隔离）

| 接口 | 方法 | 参数 | 说明 |
| --- | --- | --- | --- |
| `{url_prefix}/api/todos` | GET | 无 | 当前用户的待办（≤200 条） |
| `{url_prefix}/api/todo_add` | POST | `id,title,priority,note,created_at` | 新增 |
| `{url_prefix}/api/todo_toggle` | POST | `id,done` | 设完成状态（0/1） |
| `{url_prefix}/api/todo_remove` | POST | `id` | 删除 |
| `{url_prefix}/api/todo_clear_done` | POST | 无 | 删除当前用户全部已完成 |

所有接口强制 `user_id = :user_id`（服务端注入，不可伪造）——每个用户只看/只改自己的数据。

AI 调用示例（page 通道）：

```
curl {url_prefix}/api/todos
curl {url_prefix}/api/todo_add -X POST -H 'Content-Type: application/json' -d '{"id":"m1","title":"买牛奶","priority":"2","note":"","created_at":"2026-01-01T00:00:00Z"}'
```

## 页面与指令

打开：`open {url_prefix}/index`

| 指令 | 说明 |
| --- | --- |
| `todo_status` | 返回 `{"ok","total","done"}` |
| `todo_add --title <标题> [--priority <0-2>]` | 新增并返回 `{"ok","id"}` |
| `todo_toggle --id <id> [--done <0/1>]` | 设完成状态（缺省翻转） |
| `todo_remove --id <id>` | 删除 |
| `todo_clear_done` | 清除全部已完成 |

## 自测闭环（AI）

```
open {url_prefix}/index → list → {win_id}.todo_status → {win_id}.todo_add --title "测试"
→ {win_id}.todo_status（total 应 +1）→ curl {url_prefix}/api/todos（读回持久化结果）
```
