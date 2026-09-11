# 数据面手册（tables + api）

> 覆盖：tables 声明 → sqlx 接口 → SQL 书写规范 → owner 管理面 → AI 数据通道。
> 完整示例：`examples/todo_min`（tables + 4 条 sqlx + 页面 + 指令，可直接复制改造）。

## 0. 心智模型

- **声明式**：`tables/*.json` 声明表结构（文件名即表名）；`api/{get|post}.{name}.sqlx` 一条 SQL 一个接口。引擎托管：懒建表、additive 迁移、参数绑定、只读/写连接分流、1000 行截断。
- **无通用 CRUD、无 schema 管理 API**：想读写就声明接口；**行级安全由你的 SQL 负责**。
- 运行库 = sqlite 单文件，在包目录外：本地 `/u/{uid}/skills/{name}.sqlite`、公开 `/skills/{id}.sqlite`；**发布打包天然不含数据**——公开库从空开始。
- 两个使用面（同一运行库，权限不同）：
  - **业务面** `{url_prefix}/api/{name}`：页面与 AI 都走这里；`user_id` 服务端注入。
  - **owner 管理面** `/api/skills/{ref}/...`：owner-only 的跨用户排查/批量修数；**无自动过滤**。

## 1. tables/{table}.json（表声明）

```json
{
  "title": "待办事项",
  "description": "每行一条待办，按 user_id 行级隔离",
  "fields": [
    {"name": "id", "type": "string", "required": true, "default": "", "description": "业务主键，应用层生成"},
    {"name": "user_id", "type": "string", "required": true, "default": ""},
    {"name": "title", "type": "string", "required": true, "default": ""},
    {"name": "done", "type": "bool", "default": false},
    {"name": "priority", "type": "int", "default": 0},
    {"name": "note", "type": "text"},
    {"name": "created_at", "type": "time"}
  ],
  "indexes": [
    {"fields": ["user_id"]},
    {"fields": ["id"], "unique": true}
  ]
}
```

- 类型映射：`string`→VARCHAR(255) / `text`→TEXT / `json`→TEXT / `int`→INTEGER / `number`→REAL / `bool`→BOOLEAN / `time`→TEXT
- 字段属性：`title`/`description`（文档性）、`required`、`default`、`enum`（合法值白名单）
- 名字规则：表名/字段名 `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`（推荐全小写 snake_case）；**`_rowid` 是保留名，声明即非法**
- **无隐式基列：声明什么列就有什么列**——需要 `user_id` 就声明 `user_id`（行级隔离几乎总是需要）

**required / default 精确语义**：

| 场景 | 行为 |
| --- | --- |
| 初始建表 | `required` → NOT NULL（该列插入必须带值，除非有 default 兜底） |
| 插入省略列 | 落 `default`（无 default 且非 required → NULL） |
| **additive 迁移**（表已存在时新增列） | 只加列；**新列 `required` 且无 `default` → 显式报错**（改定义或补 default） |

**推荐写法：`required` + `default` 成对**——迁移安全、语义完整。结构演进=**只加不删不改型**；删除/改型/改名不支持 → 弃用旧列加新列（或新表名 + 自行搬迁数据）。

- 本地形态：改 tables 文件后**下次调用自动重同步**（懒加载）。
- 公开形态：内容不可变——**改结构必须发新版本**；正式库文件保留，新版本表按 additive 加列生效。
- `enum` 的校验发生在 owner 管理面写行时；sqlx 直写不校验（弹性和责任在 SQL 作者）。

## 2. api/{method}.{name}.sqlx（接口）

命名即端点：`api/get.todos.sqlx` → `GET {url_prefix}/api/todos`；`api/post.todo_add.sqlx` → `POST {url_prefix}/api/todo_add`。

```sql
-- get.todos.sqlx
SELECT id, title, done, priority, note, created_at
FROM todos
WHERE user_id = :user_id
ORDER BY done ASC, priority DESC, created_at DESC
LIMIT 200
```

```sql
-- post.todo_add.sqlx
INSERT INTO todos (user_id, id, title, done, priority, note, created_at)
VALUES (:user_id, :id, :title, 0,
        CASE WHEN :priority = '' THEN 0 ELSE CAST(:priority AS INTEGER) END,
        :note, :created_at)
```

规则与防线（引擎自动执行，无需配置）：

- **单语句**文件（多语句 → 400）；首词黑名单：`PRAGMA / ATTACH / DETACH / VACUUM / REINDEX / BEGIN / COMMIT / END / ROLLBACK / SAVEPOINT / RELEASE`。
- 命名绑定 `:name` / `@name`；字符串与注释里的冒号不替换，`::` 跳过。**参数必须全部提供**（缺 → `400 missing sqlx param :x`）。
- **base 参数服务端注入**：`user_id`（当前调用者）、`skill_id`——客户端同名参数被覆盖，**不可伪造**。行级隔离 = 在所有读写里带 `user_id = :user_id`。
- `get` 强制只读连接（写 sqlite 报 `readonly database`）；`post` 走写连接。
- 参数合并：query、form、json body（优先级 query < form < json）；multipart 拒绝；query/form 多值（`?id=1&id=2`）不支持 → 400。
- 响应契约：
  - `get` → `{"rows":[...], "truncated": false}`（恒数组；超 1000 行截断并标 truncated）
  - `post` → `{"rows":[], "affected": n, "last_insert_id": n}`
- 错误语义：400 = 语句非法/缺参/值类型不支持；404 = 技能或表不存在。
- **参数来源不同、形态不同**（query/form 一律字符串；json 保原生类型）→ 数字一律显式 `CAST`（两种来源都稳）：

```sql
AND (:done = '' OR done = CAST(:done AS INTEGER))                -- 可选数字过滤：空串=不过滤
CASE WHEN :priority = '' THEN 0 ELSE CAST(:priority AS INTEGER) END  -- 写入兜底默认
AND (:q = '' OR title LIKE '%' || :q || '%')                     -- 全文搜索（空串=不过滤）
title = CASE WHEN :title = '' THEN title ELSE :title END         -- 部分更新：只改传了的字段
```

## 3. SQL 书写规范

**现状**：引擎当前执行在 SQLite 文件上——`datetime('now')`、`||` 拼接、`rowid` 都可用（平台既有技能大量使用）。
**推荐新代码贴三方言交集**（SQLite / MySQL / PostgreSQL 通用，便于未来迁移）：

- 标识符全小写 snake_case、不加引号；值一律参数绑定（**禁止拼字符串**）。
- 推荐：`COALESCE` / `CASE` / `CAST` / 聚合 / `IN` / `EXISTS` / `LIMIT` / `INSERT ... VALUES` / `UPDATE`/`DELETE ... WHERE`。
- 避免方言专属：`IFNULL`（用 COALESCE）、`NOW()`/`strftime`（时间戳由应用层传入，如 `created_at = :created_at`）、自增列（主键用应用层生成）、upsert 语句（`INSERT IGNORE`/`ON DUPLICATE KEY`/`ON CONFLICT`——先 UPDATE 看 affected 再 INSERT）。
- 明确禁止：多语句、DDL（建表改表归声明与引擎）、PRAGMA/事务语句（黑名单拦截）。

| 反例 | 正例 |
| --- | --- |
| `WHERE name = '" + q + "'`（拼接） | `WHERE name = :name`（绑定） |
| `IFNULL(a, 0)` | `COALESCE(a, 0)` |
| `INSERT IGNORE INTO ...` | 先 `UPDATE ... WHERE`；affected=0 再 INSERT |
| `WHERE priority = :p`（p 是字符串） | `WHERE priority = CAST(:p AS INTEGER)` |
| `created_at DATETIME DEFAULT NOW()` | 应用层传 `:created_at` |

## 4. owner 数据管理面（HTTP，owner-only）

定位：跨用户排查、批量修数、灌种子数据、清理。**本地技能**天然 owner-only（解析限定在你自己空间）；**公开技能**校验注册表 owner（非 owner → 403/404）。

| 路由 | 说明 |
| --- | --- |
| `GET /api/skills/{ref}/tables/{table}?page&size&sort&...` | 列表：`{total, page, size, items:[{_rowid,...}]}`；默认 20/页（上限 200）、默认 `sort=rowid DESC`（写 `sort=title` / `-title` / `title DESC`）；其余 query 键作**等值过滤**（仅声明列生效） |
| `POST /api/skills/{ref}/tables/{table}` | 插行（JSON body）：仅声明列生效（未知键忽略）；default 回填、required 校验、enum 校验、类型宽松转换；返回带 `_rowid` 的行 |
| `GET/PUT/PATCH/POST/DELETE /api/skills/{ref}/tables/{table}/{rowid}` | 取/改/删单行；改行 patch 语义（required 列显式 null 拒绝；声明了 `updated_at` 会自动刷新） |
| `POST /api/skills/{ref}/tables_sqlx` | 原始 SQL：`{"sql": "...", "args": [...]}`（`?` 位置绑定）或 `{"sql": "...:name...", "params": {...}}`（命名绑定）**二选一** |

`tables_sqlx` 白名单单语句：`SELECT/WITH/EXPLAIN` 走只读连接（1000 行截断）；`INSERT/UPDATE/DELETE/REPLACE` 走写连接（返回 rows/affected/last_insert_id）；DDL、PRAGMA/ATTACH、事务类一律 400；body ≤1MB。

**安全提醒**：管理面**没有** `:user_id` 自动过滤——WHERE 条件自己写全；拿不准影响面时先 `SELECT` 同条件确认行数，再执行写。

AI 调用示例（经 page 端 curl，同源 + owner 身份）：

```
curl /api/skills/{ref}/tables/todos?size=5
curl /api/skills/{ref}/tables_sqlx -X POST -H 'Content-Type: application/json' -d '{"sql":"UPDATE todos SET done = 0 WHERE user_id = ?","args":["uid123"]}'
```

## 5. AI 数据通道（page exec curl）

`exec 1host=page` → `curl <url> [-X METHOD] [-H 'K: V']... [-d body]`

- **仅同源**（SSRF 防护）；cookie 身份自动携带（= `user_id` 注入取当前登录用户）；`-d` 隐含 POST；响应 = 状态行 + content-type + body（256KB 截断）；不支持的 flag 忽略并附警告。
- 业务面典型序列：

```
curl {url_prefix}/api/todos
curl {url_prefix}/api/todo_add -X POST -H 'Content-Type: application/json' -d '{"id":"m1","title":"买牛奶","priority":"2","note":"","created_at":"2026-01-01T00:00:00Z"}'
curl {url_prefix}/api/todo_toggle -X POST -H 'Content-Type: application/json' -d '{"id":"m1","done":"1"}'
```

- 页面侧不用 curl：`$mod.$fetch('api/todos')`（相对路径自动加包前缀；返回解析后的 JSON 本体）。

## 6. 常见问题对照

| 现象 | 原因 |
| --- | --- |
| `400 missing sqlx param :x` | 请求没带全参数（或名字大小写/拼写不一致） |
| `400 unsupported type` | query/form 传了多值（`?id=1&id=2`） |
| `readonly database` | `get` 接口里写了写语句（或 `WITH` 写 CTE）——get 只读 |
| `no such table` | SQL 表名与 `tables/{table}.json` 文件名不一致 |
| `UNIQUE constraint failed` | unique 索引冲突（如业务 id 重复） |
| 发布后数据"没了" | 正常：发布不带数据，公开库从空开始 |
| sqlx 结果 `done` 是 0/1 | 数据面返回原始值；页面里按 truthy 用（`item.done ?`） |

## 7. 落地顺序（推荐）

1. 先写 `tables/{table}.json`（含 user_id 列与索引）
2. 再写 sqlx：一条 list（get）+ 若干写（post），全部带 `user_id = :user_id`
3. 本地先用 curl 打通（page 通道 + `{url_prefix}/api/...`），再写页面
4. 页面只用 `$mod.$fetch` 调这些接口，不直连 sqlite
5. 需要批量/跨用户操作时再用 owner 管理面
