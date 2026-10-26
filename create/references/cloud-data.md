# 接口与数据（云端数据面）

> 面向"不了解平台实现"的 AI。目标：给包加一张表和几个接口，且用户之间数据严格隔离。

## 1. 表声明

`tables/<表名>.json`：

```json
{
  "fields": [
    { "name": "user_id", "type": "string" },
    { "name": "title", "type": "string", "required": true },
    { "name": "qty", "type": "int" }
  ]
}
```

- 字段名小写 snake_case；类型只可用 `string` / `text` / `number` / `int` / `bool` / `json` / `time`。
- **每张表都要有 `user_id` 字段**——行级隔离靠它（接口里用 `user_id = :user_id` 过滤）。
- 平台**不生成隐式业务主键**。需要 `id` 时可显式使用 SQLite `rowid AS id`，或自行声明 `id`、加唯一索引并在应用层生成值（见 `examples/todo_min`）；不要使用自增列。

## 2. 接口声明

`api/<方法>.<名字>.sqlx`，例如 `api/get.list.sqlx`、`api/post.add.sqlx`。内容是一条 SQL，参数用 `:名字` 绑定：

```sql
-- api/get.list.sqlx
select rowid as id, title, qty from items where user_id = :user_id order by rowid limit 200
```

```sql
-- api/post.add.sqlx
insert into items (user_id, title, qty) values (:user_id, :title, :qty)
```

- 方法段目前只接受 `get` 或 `post`，名字段是接口名；其它文件名不会注册成 API。
- **`user_id` 由服务端注入**（取当前登录身份），客户端不能覆盖——身份不可伪造。
- 查询必须带 `user_id = :user_id` 过滤；全表拉取要加 LIMIT。
- 返回形态：查询返回 `{ rows: [...] }`；写入返回受影响行数/空对象。

## 3. 怎么调

**页面里**（相对地址，前缀自动补）：

```js
const r = await $fetch('api/list')                    // GET
await $fetch('api/add', { method: 'POST', body: { title, qty } })
```

**AI 侧**（页面上下文执行，同源 + cookie 身份自动携带）：

```sh
exec 1host=page
curl {url_prefix}/api/list
curl {url_prefix}/api/add -X POST -H 'Content-Type: application/json' -d '{"title":"x","qty":1}'
```

`url_prefix` 就是建行时返回的 `/skills/cloud/{id}`——不要手拼 id。

## 4. SQL 书写规范

- 当前运行时是**每个技能包自己的 SQLite 库**，不是 sqlite/MySQL/PG 三库执行面；SQL 按这一真实边界书写。
- **禁字符串拼接 SQL**（`:name` 绑定是唯一传参方式）；字段与表名用小写下划线，查询字段明确列出（不要 `select *`）。
- 禁多语句；表结构走声明式 additive 迁移，**不要在 sqlx 里写 DDL**——这是作者与审核红线，不要依赖运行时是否恰好拦截。
- 不使用自增列；需要行句柄时显式写 `rowid`，需要业务主键时按 §1 自行声明并生成。

## 5. 常见坑

1. 忘了 `user_id = :user_id` → 跨用户可见，审核与安全双重问题。
2. 试图用客户端传的 `user_id` → 服务端会覆盖，值无效。
3. `select *` → 表结构变了就炸。
4. 一次拉全表 → 慢且危险，加 LIMIT。
5. 接口名里带中文或空格 → 寻址麻烦，用小写短横线。
6. 依赖数据库时钟或方言函数会让接口行为难测；时间值优先由调用方用参数显式传入。

## 6. 验收

- 建包后接口能通：GET 返回 `{ rows: [...] }`，POST 写入成功。
- 换一个账号调用，**看不到**上一个账号的数据（隔离生效）。
- 参数非法时返回可读错误，不 500 白屏。
- 包内没有真实用户数据（公开库从空开始）。
