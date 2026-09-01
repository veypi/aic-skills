---
name: create_skill
nickname: 创建 Skill 指南
description: 教导如何在本平台创建一个动态 skill：分级决策（纯文本/ui/数据/接口）→ 按级实施 → 发布审核流
keywords: [skill, 创建, 教程, 指南, 动态skill, skill.md, ui, tables, api]
icon: fa-solid fa-wand-magic-sparkles
---

# 创建动态 Skill 指南

本 skill 是一份操作手册，教你从零创建一个本平台的 skill。平台 skill 机制的唯一契约源是 `aic/docs/skill.md`，本指南是其面向创作者浓缩版；冲突时以文档与代码为准。

## 1. 概念：一切能力都是 skill

skill = **SKILL.md（必有）** + 可选能力目录叠加。能力按「给谁用」分两类：

| 目录 | 能力 | 服务对象 |
| --- | --- | --- |
| `ui/` | 技能界面（任意 HTML，OS 窗口一等组件） | **给人看** |
| `tables/` | 声明式存储表（sqlite 惰性建表 + additive 迁移） | **存数据** |
| `api/` | 声明式接口（`{get\|post}.{name}.sqlx`，执行器托管） | **数据通道**：页面与 AI 都经它读写 |
| `cli/` | 本地命令定义 | 方向定桩，初期不实施 |

**两种形态**：本地（`/u/{uid}/skills/{name}/`，不进 DB，随时改删）与正式（注册表 + `/skills/{id}/`，内容不可变，≤10/用户）。寻址**混合、本地优先**：裸 ref 先试本地目录名，miss 后按注册表 uuid——`skills load myskill` / `skills load a1b2...` 都直接命中。两者仅差存储根（`/u/{uid}` 前缀）与 URL 的 scope 段，服务面同构——本地调通再发布。

## 2. 分级决策：先定级，再动手

创建 skill 先依次回答四个问题，答案决定启用哪些能力目录：

```
Q1 这个 skill 只是教 AI 知识/流程/规范，无交互无数据？
   └ 是 → L1 纯静态：只需 SKILL.md，跳到 §3 写完即完成
   └ 否 ↓

Q2 需要给用户展示操作界面（表单/画布/控制台）？
   └ 是 → 启用 ui/（L2）。界面需要数据吗？
          ├ 不需要（纯前端小工具，如计算器）→ L2 即可
          └ 需要 → 继续 Q3
   └ 否（纯后端能力）→ 跳到 Q3

Q3 需要持久化数据（用户数据、配置、内容库）？
   └ 是 → 启用 tables/（L3），并且几乎总是同时启用 api/（L4）——
          tables 只是存储声明，没有 api 就没有读写通道
   └ 否 ↓

Q4 页面/AI 需要结构化的数据读写通道（即使是别人的表/纯查询）？
   └ 是 → 启用 api/（L4），不一定需要 tables/（接口可以查任何
          声明过的表；数据也可以经参数传入不落库）
```

**级别组合速查**：

| 级别 | 启用目录 | 典型场景 |
| --- | --- | --- |
| L1 | 仅 SKILL.md | 领域知识包、操作手册、提示词规范 |
| L2 | + ui/ | 计算器、剪贴板类纯前端工具 |
| L3+L4 | + tables/ + api/ | 备忘录、收藏库、记账（存数据 + 读写通道） |
| L2+L3+L4 | ui/ + tables/ + api/ | 完整应用：界面展示 + 数据持久化（最常见形态） |

决策要点：

- **ui 与数据解耦**：界面不写 SQL、不直连存储，数据一律走第 6 节的 api 通道
- **tables 无 api = 死数据**：声明了表就必须提供至少一条 sqlx 接口
- **api 可无 tables**：接口可以只查不存，或操作别的 skill 声明的表
- 每加一个目录，发布审核的审查面就多一些（ui 看 JS 越权调 /api、api 看 SQL 注入与 `:user_id` 过滤）

## 3. 共同地基：SKILL.md（所有级别必有）

在 UFS 空间创建 `/u/{uid}/skills/{name}/`，放入 SKILL.md：

```
---
name: my_skill
description: 我的第一个 skill
---

# 我的 Skill

（正文：写给 AI 看的操作手册——什么时候用本 skill、各能力怎么用、数据面怎么调。）
```

名字规则（三重一致强制，违反即契约非法 404）：

- 正则 `^[a-z0-9][a-z0-9-_]{0,31}$`（小写/数字开头，可含 `-` `_`，≤32 字符）
- **目录名 = frontmatter `name` = 发布名**
- 禁中文、禁点号、禁路径分隔符、禁 `local_` 开头（正式名保留约束）
- 目录经 `/skills` 页的 $fs 视图管理（`/fs/cloud/u/{uid}/skills/{name}`），或 AI fs 工具读写

frontmatter 契约（yaml **严格解析**，未知字段直接报错、无别名）：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 须等于目录名 |
| `description` | — | 注册表 description 同源（发布时非空覆盖、省略保持现值） |
| `nickname` | — | 显示名（可中文），前端优先展示，空回落 name |
| `keywords` | — | 搜索关键词数组，三栏/工具检索用 |
| `icon` | — | 图标（如 `fa-solid fa-xxx`） |
| `ui` | — | 页面清单 `[{path, desc}]`，path 相对 `ui/`；缺省入口 `index.html` |

frontmatter 之后的正文 = **AI load 的入口内容**（skills 工具 `load` 返回正文 + 自动枚举的能力清单 + url_prefix）。正文写给 AI：能力清单、调用示例、pageDesc 指令表（如有 ui）。

## 4. L2：启用 ui/

`ui/` 下放任意 HTML 页面（vhtml 组件或原生均可），frontmatter 的 `ui` 清单登记入口：

```yaml
ui:
  - path: index.html
    desc: 主界面（表单 + 列表）
```

- 页面地址：`/skills/local/{name}/index.html`（正式形态 `/skills/public/{id}/index.html`；前端路由 `/skills/:scope/:ref/*path?` 直装，缺省组件 `index.html`）
- 模块引导**不需要自携 env.js**：平台固定 env.js（`/skills/{scope}/{ref}/env.js`，embed）自动完成——router_prefix 锚定包前缀、模块本地 `$fetch`、包内 `langs.json` 并入共享 i18n（有 `ui/langs.json` 即生效）
- 响应自动带 `vhtml-scoped: /skills/{scope}/{ref}` 头——包页面锚定为独立 vhtml 模块，相对 fetch / 组件标签全落在包服务前缀下
- **页面内不内嵌 AI、URL 零 agent 参数**。外部 AI 操控页面的方式 = 页面 setup 块声明 `pageDesc = {desc, commands:[{name, desc, help?, handler}]}`，平台按 `{win_id}.{cmd}` 自动采集暴露；AI 经 `exec 1host=page` 探测与调用
- 纯前端小工具（无数据）到这一级就结束了；需要数据继续 §5/§6

## 5. L3：启用 tables/

`tables/{table}.json` 声明表结构（文件名即表名，schema 内不重复声明）：

```json
{
  "title": "客户表",
  "description": "客户基础信息",
  "fields": [
    {"name": "name", "type": "string", "required": true},
    {"name": "email", "type": "string"},
    {"name": "age", "type": "int", "default": 0},
    {"name": "tags", "type": "json"},
    {"name": "note", "type": "text"},
    {"name": "active", "type": "bool", "default": true},
    {"name": "created_at", "type": "time"}
  ],
  "indexes": [
    {"fields": ["email"], "unique": true},
    {"fields": ["name", "age"]}
  ]
}
```

规则：

- 字段类型：`string`(VARCHAR 255) / `text` / `json` / `int` / `number` / `bool` / `time`
- 迁移语义 = **additive**：只加列，不删不改型；`required` 新列必须带 `default`（否则显式报错——sqlite ADD COLUMN 语义限制）
- `_rowid` 是保留字段名（owner 记录层的行句柄别名），声明即契约非法
- 运行库 sqlite 在**包目录外**：本地 `/u/{uid}/skills/{name}.sqlite`、正式 `/skills/{id}.sqlite`——发布打包天然不含数据
- owner 数据管理走 `/api/skills/{ref}/tables/{table}[/{rowid}]`（仅正式条目 owner；ref 单段 = 注册表 uuid）

## 6. L4：启用 api/

`api/{get|post}.{name}.sqlx` 一个文件一条 SQL，执行器托管：

```
api/get.customers.sqlx    → GET  /skills/local/{name}/api/customers（正式 /skills/public/{id}/...）
api/post.customer.sqlx    → POST /skills/local/{name}/api/customer
```

sqlx 写法（命名绑定）：

```sql
-- :name / @name 绑定 HTTP 参数；字符串与注释内的冒号不替换
SELECT * FROM customers WHERE user_id = :user_id AND name LIKE '%' || :q || '%' ORDER BY rowid DESC LIMIT :limit
```

```sql
INSERT INTO customers (user_id, name, email) VALUES (:user_id, :name, :email)
```

执行器防线（平台强制）：

- **单语句**文件；首词黑名单：PRAGMA / ATTACH / DETACH / VACUUM / REINDEX / BEGIN / COMMIT / END / ROLLBACK / SAVEPOINT / RELEASE
- base 参数 `user_id`（访问者 uid）与 `skill_id` **服务端注入且覆盖客户端同名参数**——`:user_id` 做行级隔离，用户无法伪造
- `get` 强制只读连接；单行返回上限 1000 条（截断标 `truncated`）
- 参数合并 query < form < json（multipart 一律拒绝）；响应 `get → {"rows":[...],"truncated":bool}`（恒数组）、`post → {"rows":[],"affected":n,"last_insert_id":n}`

**AI 数据通道**：AI 不经过 skills 工具调数据——由外部 AI（chat 壳 page 通道）发 `page exec curl` **同源**调 `{url_prefix}/api/{name}`。页面代码同样用同源 fetch。skills 工具只负责 search（发现，列表直接下发 url_prefix 列）与 load（读手册正文 + 能力清单 + url_prefix）。

## 7. 发布到广场

入口 = `/skills` 页本地详情「发布」（无上传，服务端流式打包本地目录）：

1. 选「发布新条目」（name 默认 = 目录名）或「发布到已有条目」（发新版）
2. 设版本号（正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$`，禁连续点）
3. `POST /api/skills/releases {source, name?, version}`

之后：

- **16MB 闸门**：压缩后超限立即失败，走不到审核
- **配额**：新条目占名额（每用户 ≤10，发新版不占）；同 `(owner_id,name)` 只允许一个 pending；**版本一经提交即消耗**（rejected 也算，重提须递增）
- **全 skill 统一审核**（SKILL.md 也是注入载体，无免审通道）：审核台看 zip 树 + diff + 试用副本真实试用；管理员自发布免审
- **通过** = 注册表落行（name owner 内唯一）+ `.next/.old` 原子交换 + 历史 zip 留存
- 正式内容不可改：desc/icon/nickname/keywords 仅随新版本从 frontmatter 刷新（非空覆盖、省略保持现值）
- owner 可删除整条（释放 name 与名额，级联清绑定）；本地目录与正式条目互不影响

## 8. 红线清单

- 名字三重一致：目录名 = frontmatter name = 发布名；`local_` 前缀已废除（寻址混合本地优先，无前缀判别；`temp_` 开头的本地名是审核试用副本保留形态）；UFS 路径单段 ≤64 字符（name ≤32 / version ≤16 连锁约束）
- 文件永不进 skill 层：DB 只存 `/f/...` 路径字符串；AI 数据通道 = page exec curl 同源
- fs 读面：`/skills` 区 L1/L2 拒（不可列不可读），包内文件 L3+ 只读开放，写一律拒
- 试用副本 = 审核员空间的普通本地条目（`temp_{name}_{v}` 裸名，版本点号转下划线）
- binds 仅公开条目（skill_id 关联）；本地 skill 无绑定无统计

## 9. 检查清单（发布前自查）

- [ ] 定级正确：L1 纯文本 / L2 +ui / L3+L4 数据+接口 / 全量组合
- [ ] frontmatter 过 yaml 严格解析，无拼错字段（`description` 不是 `desc`）
- [ ] name 与目录名一致，过 `^[a-z0-9][a-z0-9-_]{0,31}$`
- [ ] 正文写给 AI：能力清单 + 数据面调用示例 + pageDesc 指令表（如有 ui）
- [ ] api sqlx 单语句、过首词黑名单、行级过滤用 `:user_id`；tables 声明则 api 齐全
- [ ] tables 新 required 列带 default、无 `_rowid` 字段
- [ ] 压缩包 ≤16MB（大二进制素材放用户空间，DB 只存 `/f/...` 路径）
- [ ] 不自携 env.js（平台固定出口，作者不可覆盖）；页面所需 $t 文案放 `ui/langs.json`
