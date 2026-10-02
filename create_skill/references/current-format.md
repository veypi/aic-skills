# 现行包格式与能力契约（v6.1）

核对日期：2026-10-02。本文描述当前运行代码的契约，是写任何技能包之前的必读。

## 独立单文件组件（不建技能包）

只需要一个页面时直接写一个完整 HTML：

| 落点 | 写入路径 | 打开 URL |
|---|---|---|
| page OPFS（临时） | `/{name}.html` | `/fs/page/{name}.html` |
| cloud UFS（长久） | `/u/{uid}/{name}.html` | `/fs/cloud/u/{uid}/{name}.html` |

通过 page exec 的 `open <URL>` 打开。含 `<script setup>` 的组件按 vhtml 加载，普通 HTML 按独立文档展示；只有需要 AI 操作窗口才提供 pageDesc。布局、资源与样式见 [页面手册](page-ui-manual.md)。

限制：无 tables/api/cli 能力、无独立路由、不能发布到广场；需求一升级就转技能包。

## 包结构

```text
{pkg}/
  SKILL.md            包身份 + 使用说明（frontmatter 契约见下，必需）
  ui/                 界面（vhtml 页面；index.html 缺省入口；langs.json 包 i18n）
  tables/             数据表定义（{table}.json）
  api/                数据接口（{method}.{name}.sqlx）
  cli/manifest.json   命令清单（providers + streams；提供 CLI 时必需）
  cli/bin/            provider 可执行文件（安装时补执行位）
  scripts/            包内资源脚本（构建期打包，运行期经包目录相对路径调用）
  artifacts.lock.json 按需：大二进制声明（设备侧下载 + sha256 校验）
```

UI/API/CLI 三种扩展**正交**：只做需要的，空目录不要留；tables 是 API 的可选存储，stream 是 provider 的可选通道，不增加扩展维度。一切云端 skill 进注册表：私有行 = 工作区（可改），公开行 = 发布物（冻结）；包目录统一 `/skills/{id}/`。

## SKILL.md frontmatter

```yaml
---
name: my_tool          # 必需；^[a-z0-9][a-z0-9-_]{0,31}$；须等于注册表行 name
version: 0.1.0         # 包自声明版本；发布/定版以注册表行为准，frontmatter 保持一致
description: 一句话说清做什么（AI search 的主要命中面）
nickname: 显示名        # 可中文
keywords: [关键词, 数组]
icon: fa-solid fa-xxx  # Font Awesome
ui:                    # 有 ui/ 才声明
  - path: index.html
    desc: 页面说明
    handles: [md, txt]  # 可选：声明可打开的文件扩展/协议（OS open 通用机制）
---
```

frontmatter 严格 yaml（字段名写错即解析失败）；私有行列表/详情**实时叠加** frontmatter（工作区单真相源，改文件即生效）。

## tables（数据表）

`tables/{table}.json` 定义表（sqlite 运行库在包目录外 `/skills/{id}.sqlite`，**发布不携带数据**）：

```json
{"fields": [
  {"name": "user_id", "type": "string"},
  {"name": "title", "type": "string", "required": true},
  {"name": "qty", "type": "int"}
]}
```

- `user_id` 是约定字段：每用户数据隔离（api 执行器按访问者注入；owner 管理面见全量）。
- 迁移惰性 additive：只加列不删不改型；required 新列必须有默认值。
- 管理面：`GET/POST /api/skills/{id}/tables/{table}`（owner-only）；原始 SQL：`POST /api/skills/{id}/tables_sqlx`。

## api（sqlx 接口）

`api/{method}.{name}.sqlx` = 单条 SQL（`get.` 强制只读）：

```sql
-- api/post.add.sqlx
insert into items (user_id, title, qty) values (:user_id, :title, :qty)
-- api/get.list.sqlx
select title, qty from items where user_id = :user_id order by rowid
```

- `:user_id` / `:skill_id` 由服务端注入（调用方传入无效，防伪造）；其余 `:name` 来自 query/json/form。
- 调用：`POST {url_prefix}/api/{name}`（公开行任何登录用户可调，私有行仅 owner）。
- 事务：`api/post.begin.sqlx`（内容 `BEGIN`）/ `.commit.sqlx` / `.rollback.sqlx`。
- 禁止字符串拼接 SQL；get 返回上限 1000 行（超出截断置 truncated）。

## ui（vhtml 页面）

- 页面放 `ui/`，缺省入口 `ui/index.html`；页面地址 `{url_prefix}/{page}`（剥 .html，index 省略）。
- 平台固定 `env.js`（作者不可自携/覆盖）：loader `import {scoped}/env.js` 完成模块引导；`{scoped}/langs.json` 映射包 `ui/langs.json` 并入共享 i18n。
- 读平台数据用 `$fetch`（模块本地，与根环境同契约）；调自己的 api 用相对地址 `api/{name}`。
- `handles` 声明后可被 OS `open <文件|URL>` 通用打开（如 browser 注册 http/https）。

## cli（设备命令）

`cli/manifest.json`：

```json
{
  "providers": [
    {"id": "main", "kind": "process", "entry": "cli/bin/hello"},
    {"id": "svc", "kind": "service", "entry": "cli/bin/hello-service"}
  ],
  "streams": [{"name": "events", "provider": "svc"}]
}
```

- **process**：每次调用起一个进程跑 entry（argv/stdin/stdout 全量透传）——无状态命令脚本即可，**任何语言**（模板是 shell）。
- **service**：常驻进程，skillrun 懒启动（首调用）+ bg 登记；经 `SKILLPROC_SOCKET`（env 注入的 unix socket）收 invoke/stream 帧——有状态（持连接/会话）才需要，协议参考 hello/browser/cua 包源码。
- 根命令 = 包名（隐式，manifest 无 commands[]）；子命令与 --help 由包 CLI 自行实现。
- 大二进制不进包：用 `cli/artifacts.lock.json`（url/sha256/落盘路径）在安装阶段设备侧下载校验。
- 根命令冲突（内建/保留名/已装包）安装时显式拒绝；禁用 = 命令保留但显式报错，不回落同名系统程序。
- 安装到设备：`skill download <ref>`（设备 vsh 指令；ref = 注册表 id 或本人私有行 name）→ 解包 `~/.aic/skills/{name}/` → 校验 manifest + 补执行位 + 注册。之后 AI 与人都可用 `{name} <args>`。

## 寻址与 fs 门（最易踩）

- **系统面严格 id**：URL/API 路径参数一律用注册表 id；`name` 只是 AI 工具调用的便利解析（caller 自己的行：私有先、公开后，再内建）。
- `/fs/cloud/skills/`（L1）不可列不可读；`/skills/{id}` 目录写恒拒（生命周期归注册表）；公开行内容只读；私有行 owner 可读写、他人 404（不暴露存在性）。
- 单段路径名 >64 字符直接报错（连锁约束：name ≤32、version ≤16）。
- 响应里的 `url_prefix` 字段（= `/skills/cloud/{id}`）：拼地址一律 `{url_prefix}/...`，不要硬编码前缀。
- 设备包服务面：`/skills/{host_id}/{name}/...`（host fs 代理，owner 本人、设备在线才可访问）。
