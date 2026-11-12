---
name: todo_min
version: 0.1.1
nickname: 待办清单示例
description: 界面与 API 组合示例：待办清单——ui 页面 + tables 声明 + sqlx 接口 + pageDesc 指令 + Host/Pod 批量脚本，含行级隔离与自测
keywords: [示例, 待办, tables, sqlx, 数据面, pageDesc, Host, Pod, 批处理]
---

# todo_min（最小活 skill 示例）

四件套完整链路：`ui/`（界面）+ `tables/todos.json`（存储声明）+ `api/*.sqlx`（5 条接口）+ pageDesc 指令。

> **复制改造**：按 `create/references/cloud-package.md` §4 在 page exec 中用同源 `fetch` 建行，再 `grant fs /skills/{id}` 后把本目录内容写进 `/skills/{id}/`（fs 工具路径）；同步修改 frontmatter 的 `name`、`nickname`/`description`。

## 数据面（页面与 AI 共用，行级隔离）

| 接口 | 方法 | 参数 | 说明 |
| --- | --- | --- | --- |
| `{url_prefix}/api/todos` | GET | 无 | 当前用户的待办（≤200 条） |
| `{url_prefix}/api/todo_add` | POST | `id,title,priority,note,created_at` | 新增 |
| `{url_prefix}/api/todo_toggle` | POST | `id,done` | 设完成状态（0/1） |
| `{url_prefix}/api/todo_remove` | POST | `id` | 删除 |
| `{url_prefix}/api/todo_clear_done` | POST | 无 | 删除当前用户全部已完成 |

所有接口强制 `user_id = :user_id`（服务端注入，不可伪造）——每个用户只看/只改自己的数据。

AI 的 page exec 调用示例（Host 或 Cloud/Pod 仍可用 exec/vsh 内建 curl）：

```js
const res = await fetch('{url_prefix}/api/todo_add', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({id: 'm1', title: '买牛奶', priority: '2', note: '', created_at: '2026-01-01T00:00:00Z'}),
})
if (!res.ok) throw new Error('todo_add failed: HTTP ' + res.status)
const listRes = await fetch('{url_prefix}/api/todos')
if (!listRes.ok) throw new Error('todos failed: HTTP ' + listRes.status)
return {added: await res.json(), list: await listRes.json()}
```

Host/Pod 批量写入：脚本读取 JSONL，一次运行提交整批，不要由 AI 逐条发调用。`todos.jsonl` 每行是完整的
`todo_add` 参数对象。

```sh
base=${1:?"pass url_prefix"}
while IFS= read -r row; do
  [ -z "$row" ] && continue
  out=$(curl "$base/api/todo_add" -X POST \
    -H 'Content-Type: application/json' -d "$row") || exit 1
  case "$out" in
    *'"code":'*) printf '%s\n' "$out" >&2; exit 1 ;;
  esac
done < todos.jsonl
curl "$base/api/todos"
```

批量循环不是事务；失败前的写入保留。使用稳定业务 id 设计去重，非幂等 POST 不自动重试。

## 页面与指令

打开：page exec 中 `await open({url: '/skills/cloud/{skill_id}'})`，skill_id 取自 `skills` 工具的 `search/load`；HTTP 数据面仍使用返回的 `url_prefix`（同前缀）。

| 指令 | 说明 |
| --- | --- |
| `todo_status()` | 返回 `{ok, total, done}` |
| `todo_add({title, priority?})` | 新增并返回 `{ok, id}` |
| `todo_toggle({id, done?})` | 设完成状态（缺省翻转） |
| `todo_remove({id})` | 删除 |
| `todo_clear_done()` | 清除全部已完成 |

## 自测闭环（AI）

```js
const opened = await open({url: '/skills/cloud/{skill_id}'})
const before = await win(opened.win_id).todo_status()
const added = await win(opened.win_id).todo_add({title: '测试'})
const after = await win(opened.win_id).todo_status() // total 应 +1
const res = await fetch('{url_prefix}/api/todos')    // 读回持久化结果
if (!res.ok) throw new Error('todos failed: HTTP ' + res.status)
return {before, added, after, stored: await res.json()}
```

批处理另测：一个 Host/Pod 脚本写入多条 → 一次 GET 读回；故意提交重复 id → 脚本在错误行停止，后续行不写入。
