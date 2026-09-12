---
name: create_skill
nickname: 创建 Skill 指南
description: 从零创建本平台动态 skill 的自包含完整指南：分级决策 → SKILL.md 契约 → ui 页面与 pageDesc 指令 → tables/api 数据面 → 发布审核；附平台运行时手册、$fs 参考与三个可跑示例
keywords: [skill, 创建, 教程, 指南, 动态skill, skill.md, ui, 页面, pageDesc, 指令, tables, api, sqlx, 数据面, 发布, 示例]
icon: fa-solid fa-wand-magic-sparkles
---

# 创建动态 Skill 指南

本指南面向**任何在本平台上工作的 AI 助手**：你不需要平台源码或历史记忆——写技能所需的公共知识全部收录在本包内（正文 + `references/` 手册 + `examples/` 可跑示例）。

**并非一切都要建 skill**：一次性/私有的前端小组件，直接写一个 .html 文件就能打开使用（§2 Q0）；skill 是给「需要 AI 手册、数据通道、打包分享」的能力用的。

## 0. 本包地图（怎么读）

| 文件 | 内容 | 何时读 |
| --- | --- | --- |
| `SKILL.md`（本文） | 总纲：概念、分级、契约速览、红线、检查清单 | 先读 |
| `references/platform-runtime.md` | 平台运行时：工具/开窗/指令闭环、/fs 路径协议、$fs 全 API、$mod 服务、i18n、调试自测 | 写页面或用文件服务前 |
| `references/page-ui-manual.md` | 界面手册：vhtml 速览、pageDesc 完全规格、布局响应式、**样式规范**（设计 token）、高频坑 | 写 `ui/` 前 |
| `references/data-manual.md` | 数据面手册：tables/sqlx 规格、SQL 规范、owner 管理面、curl 通道 | 写 `tables/`、`api/` 前 |
| `references/publishing.md` | 发布手册：流程、审核自查、发布后更新、常见拒绝原因 | 发布前 |
| `examples/hello` | 最小纯前端：计数器 + 指令（L2） | 第一个练手 |
| `examples/todo_min` | 最小活 skill：ui+tables+api+指令全链路（L2+L3+L4） | 完整模板 |
| `examples/notes` | 文件驱动：$fs 读写 + 文件对话框 + 指令（无数据库） | 文件型应用模板 |

读法：本地形态 → fs 工具读 `/u/{uid}/skills/create_skill/references/xxx.md`；公开形态 → fs 工具读 `/skills/{load 返回的 skill_id}/references/xxx.md`。
写页面前建议先加载 **vhtml 技能**拿组件语言全契约：`skills search 'vhtml'` → `skills load <其 id>`（本地已有 vhtml 目录则直接 `load vhtml`）。

## 1. 概念：skill 是什么

skill = **SKILL.md（必有）** + 可选能力目录叠加：

| 目录 | 能力 | 服务对象 |
| --- | --- | --- |
| `ui/` | 技能界面（任意 HTML，OS 窗口一等组件） | **给人看** |
| `tables/` | 声明式存储表（惰性建表 + additive 迁移） | **存数据** |
| `api/` | 声明式接口（`{get|post}.{name}.sqlx`，执行器托管） | **数据通道**：页面与 AI 都经它读写 |
| `cli/` | 本地命令定义 | 预留，未启用 |

**两种形态**：本地（`/u/{uid}/skills/{name}/`，不进 DB，随时改删）与公开（注册表 + `/skills/{id}/`，内容不可变，≤10/用户）。寻址**混合、本地优先**：裸 ref 先试本地目录名，miss 后按注册表 uuid——`skills load myskill` / `skills load a1b2...` 都直接命中。两者仅差存储根（`/u/{uid}` 前缀）与 URL 的 scope 段，服务面同构——**本地调通再发布**。

## 2. 分级决策：先定级，再动手

先答 Q0 决定「要不要建 skill」，再依次决定启用哪些能力目录：

```
Q0 只是要一个前端页面/组件（无需 AI 手册、无需数据通道、无需发布分享）？
   └ 是 → L0 单文件组件：不建 skill，直接写一个 .html 进文件空间
          （见「L0 细则」），此后不必再读本指南
   └ 否 ↓

Q1 这个 skill 只是教 AI 知识/流程/规范，无交互无数据？
   └ 是 → L1 纯静态：只需 SKILL.md，跳到 §3 写完即完成
   └ 否 ↓

Q2 需要给用户展示操作界面（表单/画布/控制台）？
   └ 是 → 启用 ui/（L2）。界面需要数据吗？
          ├ 不需要（纯前端小工具）→ L2 即可
          └ 需要 → 继续 Q3
   └ 否（纯后端能力）→ 跳到 Q3

Q3 需要持久化数据（用户数据、配置、内容库）？
   └ 是 → 启用 tables/（L3），并且几乎总是同时启用 api/（L4）——
          tables 只是存储声明，没有 api 就没有读写通道
   └ 否 ↓

Q4 页面/AI 需要结构化的数据读写通道？
   └ 是 → 启用 api/（L4），不一定需要 tables/（接口可以只查不存）
```

**级别组合速查**：

| 级别 | 启用目录 | 典型场景 | 示例 |
| --- | --- | --- | --- |
| L0 | 不建 skill（单个 .html） | 一次性/私有前端小组件 | — |
| L1 | 仅 SKILL.md | 领域知识包、操作手册 | 本指南自身 |
| L2 | + ui/ | 计算器、剪贴板类纯前端工具 | `examples/hello` |
| L3+L4 | + tables/ + api/ | 备忘录、收藏库、记账 | `examples/todo_min` |
| L2+L3+L4 | 全量 | 完整应用（最常见形态） | `examples/todo_min` |
| L2（文件驱动） | ui/ + $fs（无 tables） | 文件即数据（编辑器/预览器/看板） | `examples/notes` |

决策要点：

- **ui 与数据解耦**：界面不写 SQL、不直连存储，数据一律走 api 通道
- **tables 无 api = 死数据**：声明了表就必须提供至少一条 sqlx 接口
- 每加一个目录，发布审核的审查面就多一些（ui 看越权调用、api 看 SQL 注入与 `:user_id` 过滤）

### L0 细则：单文件组件（不建 skill）

把组件写成单个 .html 文件即可，放哪由使用周期决定：

| 空间 | 写入路径 | 打开 URL | 适用 |
| --- | --- | --- | --- |
| page（浏览器本地 OPFS） | `/{path}.html`（page 端 fs 写入） | `/fs/page/{path}.html` | 临时、一次性 |
| cloud（你的 UFS） | `/u/{uid}/{path}.html`（cloud 端 fs 写入） | `/fs/cloud/u/{uid}/{path}.html` | 长久使用、跨设备 |

打开方式：AI → `exec 1host=page` → `open <URL>`；或平台内导航过去。文件即页面，无需登记。

平台按内容自动分流两种渲染形态：

- 含 `<script setup>` → 按 **vhtml 组件**挂载：响应式、scoped 样式、生命周期全语义（写法契约见 vhtml skill）；setup 里声明 `pageDesc` 即被采集为窗口指令（`{win_id}.{cmd}`，外部 AI 经 page exec 调用）
- 普通 HTML → **iframe blob** 渲染：独立文档，与平台运行时隔离（**无 pageDesc 通道**）

限制（需要任一能力即应升级为 skill L2）：不进 launcher / 搜索（只能按 URL 打开）；vhtml 形态相对路径不锚定文件目录（fetch/资源写绝对路径）；iframe 形态无包级 i18n 与模块 env.js；**均为单文件，无包结构**。

## 3. 共同地基：SKILL.md（L1 及以上必有）

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
- **目录名 = frontmatter `name` = 发布名**；禁中文/点号/路径分隔符
- 目录经 `/skills` 页的 $fs 视图管理，或 AI fs 工具直接读写

frontmatter 契约（yaml **严格解析**，未知字段直接报错、无别名）：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 须等于目录名 |
| `description` | — | 注册表 description 同源（发布时非空覆盖、省略保持现值） |
| `nickname` | — | 显示名（可中文），前端优先展示，空回落 name |
| `keywords` | — | 搜索关键词数组 |
| `icon` | — | 图标（如 `fa-solid fa-xxx`） |
| `ui` | — | 页面清单 `[{path, desc}]`，path 相对 `ui/`；缺省入口 `index.html` |

frontmatter 之后的正文 = **AI load 的入口内容**。消费方 `skills load` 拿到：正文 + 自动枚举的能力清单（ui 页面 / api 接口 / tables 表）+ url_prefix。**正文写给 AI**：能力清单、调用示例、指令表（如有 ui）——本包就是范例（§0 的读法说明就是给 AI 的导航）。

## 4. 平台速览（写 ui/、数据前先看）

- **页面 URL**：`{url_prefix}/{页面名}`（url_prefix = `/skills/local/{name}` 或 `/skills/public/{id}`；search/load 输出直接给）。
- **开窗与指令**（AI，`exec 1host=page` 通道）：`open {url_prefix}/index` 开窗 → `list` 拿 win_id 与 events → `{win_id}.{cmd} --flag val` 调用。
- **文件**：三端统一 `$fs`；页面树路径 `/cloud/u/{uid}/...`；AI fs 工具 `/u/{uid}/...`；HTTP `/fs/cloud/u/{uid}/...`。
- **数据**：页面 `$mod.$fetch('api/xxx')`（相对路径自动加包前缀）；AI `curl {url_prefix}/api/xxx`（同源 cookie 身份）。
- 完整细节 → `references/platform-runtime.md`（$fs 全 API、$mod 服务表、i18n、调试与排障表）。

## 5. L2：启用 ui/

`ui/` 下放任意 HTML 页面，frontmatter 的 `ui` 清单登记入口：

```yaml
ui:
  - path: index.html
    desc: 主界面（表单 + 列表）
```

要点（完整规格见 `references/page-ui-manual.md`）：

- **写 vhtml 组件前先加载 vhtml 技能**（全语言契约）；组件必须是**完整 HTML 文档**（裸 `<template>` 片段会静默不挂载）
- 页面地址：`{url_prefix}/index`（多页面写干净路径：`/skills/.../news`；互链 `$router.push('news')` / `<a href="news">`；带参 `{page}?id=...`，同页 query 变化不重建 → `$router.onChange(() => init())` 自刷新）
- **不自携 env.js**：平台固定出口已做 router_prefix 锚定、模块本地 `$fetch`、`ui/langs.json` 并入 i18n
- 响应式用 **`@container`**（窗口 ≠ 视口）；满高 `body{height:100%}`
- **样式规范**：页面底色与字体由 OS 布局统一提供（`body` 不写背景/字体，只写布局）；配色/圆角/间距/字号用平台设计 token（亮/暗主题自动适配），不硬编码颜色——见 `references/page-ui-manual.md` §6
- **pageDesc**（页面指令，AI 操控入口）：setup 里 `pageDesc = {desc, commands:[{name, desc, help?, handler}]}`；形状硬校验（desc string / handler 函数），不满足会被平台忽略；返回 `{content: JSON.stringify(...)}`；**每个页面至少写一条 `{前缀}_status` 指令**（自测锚点）
- 纯前端工具到这一级就结束；需要数据继续 §6

## 6. L3+L4：启用 tables/ 与 api/

`tables/{table}.json` 声明表结构（文件名即表名）：

```json
{
  "title": "客户表",
  "description": "客户基础信息",
  "fields": [
    {"name": "user_id", "type": "string", "required": true, "default": ""},
    {"name": "name", "type": "string", "required": true, "default": ""},
    {"name": "age", "type": "int", "default": 0},
    {"name": "tags", "type": "json"},
    {"name": "note", "type": "text"},
    {"name": "active", "type": "bool", "default": true},
    {"name": "created_at", "type": "time"}
  ],
  "indexes": [
    {"fields": ["user_id"]},
    {"fields": ["name", "age"]}
  ]
}
```

- 类型：`string/text/json/int/number/bool/time`；**无隐式基列**——声明什么列就有什么列（`user_id` 要自己声明）
- 迁移 = **additive**（只加列，不删不改型）；**新列 `required` 必须带 `default`**（否则显式报错）；`_rowid` 保留禁声明
- 运行库 sqlite 在包目录外；**发布不带数据**（公开库从空开始）

`api/{get|post}.{name}.sqlx` 一个文件一条 SQL：

```sql
-- get.customers.sqlx —— 行级隔离 + 搜索 + 数字过滤范式
SELECT * FROM customers
WHERE user_id = :user_id
  AND (:q = '' OR name LIKE '%' || :q || '%')
  AND (:active = '' OR active = CAST(:active AS INTEGER))
ORDER BY name ASC
LIMIT 200
```

```sql
-- post.customer.sqlx —— 写入（参数必须由请求全部提供）
INSERT INTO customers (user_id, name, age, tags, note, active, created_at)
VALUES (:user_id, :name, CASE WHEN :age = '' THEN 0 ELSE CAST(:age AS INTEGER) END,
        :tags, :note, 1, :created_at)
```

执行器防线（平台强制）：单语句；首词黑名单（PRAGMA/事务类等）；`get` 只读连接；**base 参数 `user_id`/`skill_id` 服务端注入且覆盖客户端同名值**（行级隔离用 `:user_id`）；缺参 400；get 超 1000 行截断。响应：`get → {"rows":[...],"truncated":bool}`、`post → {"rows":[],"affected":n,"last_insert_id":n}`。

- **AI 数据通道**：`exec 1host=page` → `curl {url_prefix}/api/xxx`（同源；`-X/-H/-d` 子集）
- **owner 管理面**（跨用户排查/批量修数）：`/api/skills/{ref}/tables/{table}` 行 CRUD + `/tables_sqlx` 原始 SQL（owner-only；**无自动 `:user_id` 过滤**）
- 完整规格、SQL 书写规范（三方言交集）、错误对照 → `references/data-manual.md`

## 7. 发布到广场

入口 = `/skills` 页本地详情「发布」（无上传，服务端打包本地目录）：

1. 「发布新条目」（name 默认 = 目录名）或「发布到已有条目」；版本号 `^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$`
2. **16MB 闸门**（压缩后超限直接失败）；**配额** ≤10 正式技能/用户；版本号一经提交即消耗（被拒也算，须递增）
3. **全 skill 统一审核**（含纯文本）；管理员自发布免审；审核台有「试用副本」机制
4. 通过 = 上架广场；正式内容**不可变**——更新 = 发新版本（frontmatter 的 desc/nickname/keywords/icon 随新版本刷新）
5. 删除条目释放名称与名额；**数据不随发布迁移**

审核关注点与发布后验证清单 → `references/publishing.md`。

## 8. 示例：从复制到跑通

复制 `examples/{hello|todo_min|notes}/` 到 `/u/{uid}/skills/{名字}/`（复制后可删掉示例里不需要的目录）：

1. **目录名** = 你的技能名（`^[a-z0-9][a-z0-9-_]{0,31}$`）
2. 改 `SKILL.md` frontmatter 的 `name` = 目录名；nickname/description 随手改
3. 跑通自测（每个示例的 SKILL.md 都写了命令序）：`open {url_prefix}/index` → `list` → 调 `{前缀}_status` → 数据面 `curl` 读回

## 9. 红线清单

- 名字三重一致：目录名 = frontmatter name = 发布名；UFS 路径单段 ≤64 字符
- ui 必须完整 HTML 文档；pageDesc 形状错误会被**静默忽略**（表现为 events 为空）
- 页面内**不写死** `/skills/local/...` 前缀（发布后 scope 变化即失效）；不自携 env.js
- 数据：所有业务接口带 `user_id = :user_id` 行级过滤；SQL 不拼接；单语句
- **文件永不进 skill 层**：数据只存路径字符串（`/fs/...`），大素材放用户空间
- fs 读面：`/skills` 区 L1/L2 拒（不可列），包内文件 L3+ 只读开放，写一律拒
- 发布：≤16MB、版本号递增消耗、内容不可变；本地数据不随发布

## 10. 检查清单（发布前自查）

**契约**
- [ ] 定级正确（L0 单文件 / L1 / L2 / L3+L4 / 全量 / 文件驱动）
- [ ] frontmatter 过 yaml 严格解析，无拼错字段（是 `description` 不是 `desc`）
- [ ] name 与目录名一致，过 `^[a-z0-9][a-z0-9-_]{0,31}$`
- [ ] 正文写给 AI：能力清单 + 指令表 + 数据面调用示例（含自测命令序）

**页面（ui/）**
- [ ] 完整 HTML 文档；`pageDesc` 形状合法（desc string / handler 函数）
- [ ] 每个页面有 `{前缀}_status` 指令；`@container` 而非 `@media`；相对路径无写死前缀
- [ ] 样式用平台设计 token（无硬编码配色）；`body` 不设底色/字体（OS 统一提供）；亮/暗主题下观感正常

**数据（tables/api）**
- [ ] sqlx 单语句、过首词黑名单；行级过滤用 `:user_id`；数字用 CAST 模式
- [ ] tables 新 `required` 列带 default；无 `_rowid` 字段；表名=文件名
- [ ] 接口参数在实际调用中**全部提供**（缺参会 400）

**发布与自测**
- [ ] 本地全链路自测：open → list（events 齐）→ status 指令 → 业务指令增删改 → `curl` 读回
- [ ] 压缩包 ≤16MB；无调试垃圾；未写死本地 scope 前缀
- [ ] 发布后换视角验证：search 找到条目 → `load` id → open 页面 → 指令 → 数据面
