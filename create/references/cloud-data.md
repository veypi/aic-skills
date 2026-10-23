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

- 字段名小写 snake_case；类型用 `string` / `int` / `float` / `bool` 这类基础名。
- **每张表都要有 `user_id` 字段**——行级隔离靠它（接口里用 `user_id = :user_id` 过滤）。
- 主键由平台生成，不要自增列。

## 2. 接口声明

`api/<方法>.<名字>.sqlx`，例如 `api/get.list.sqlx`、`api/post.add.sqlx`。内容是一条 SQL，参数用 `:名字` 绑定：

```sql
-- api/get.list.sqlx
select title, qty from items where user_id = :user_id order by rowid
```

```sql
-- api/post.add.sqlx
insert into items (user_id, title, qty) values (:user_id, :title, :qty)
```

- 方法段是 HTTP 方法（`get` / `post` / …），名字段是接口名。
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

- 只写**三种数据库都能跑的交集语法**（小写 snake_case、参数绑定、禁自增列、禁方言专用 upsert 与函数）。
- **禁字符串拼接 SQL**（`:name` 绑定是唯一传参方式）。
- 禁多语句、禁 DDL（表结构由平台按声明建）。
- 字段与表名用小写下划线；查询字段要明确列出（不要 `select *`）。

## 5. 常见坑

1. 忘了 `user_id = :user_id` → 跨用户可见，审核与安全双重问题。
2. 试图用客户端传的 `user_id` → 服务端会覆盖，值无效。
3. `select *` → 表结构变了就炸。
4. 一次拉全表 → 慢且危险，加 LIMIT。
5. 接口名里带中文或空格 → 寻址麻烦，用小写短横线。
6. 在 SQL 里写 `now()` 之类的方言函数 → 换库就挂；时间戳由客户端传字符串或用通用表达式。

## 6. 验收

- 建包后接口能通：GET 返回 `{ rows: [...] }`，POST 写入成功。
- 换一个账号调用，**看不到**上一个账号的数据（隔离生效）。
- 参数非法时返回可读错误，不 500 白屏。
- 包内没有真实用户数据（公开库从空开始）。
