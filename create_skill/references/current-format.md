# 当前 aic v5 格式与能力限制

核对日期：2026-10-01。这里描述当前运行代码，目标 v6 见 [skill-v6.md](skill-v6.md)。SKILL.md 必需是当前与目标 v6 共同的包契约；CLI 注册等尚未实现的能力另行标注。

## 独立单文件组件

可以直接写一个完整 HTML，不建技能包：

| 落点 | 写入路径 | 打开 URL |
|---|---|---|
| page OPFS | `/{name}.html` | `/fs/page/{name}.html` |
| cloud UFS | `/u/{uid}/{name}.html` | `/fs/cloud/u/{uid}/{name}.html` |

通过 page exec 的 `open <URL>` 打开。含 `<script setup>` 的组件按 vhtml 加载，普通 HTML 按独立文档展示；只有需要 AI 操作窗口才提供 pageDesc。布局、资源与样式见 [页面手册](page-ui-manual.md)。

## 当前技能包

当前解析器和发布流程必须读到 SKILL.md；只有 ui/ 或 api/ 的目录不会成为可发现的技能。cli/ 存在仅产生能力标记，不注册命令、不启动程序。已有 exec 可运行设备允许的普通 CLI，这与技能包注册是两件事。

本地包目录 `/u/{uid}/skills/{name}/`，公开包 `/skills/{id}/`；包内运行库在目录之外，发布不含数据。ref 本地目录名优先，未命中再按公开注册表 id 解析。

纯描述最小例子：

```markdown
---
name: my_skill
description: 说明什么时候使用、能完成什么
---

# 使用说明

写真实有效的步骤和必要参考。
```

当前名称约束：`^[a-z0-9][a-z0-9-_]{0,31}$`；普通包的目录名、frontmatter name、发布名一致。SKILL.md frontmatter 严格解析，只支持 name、description、nickname、keywords、icon、ui；不要把尚未实现的入口依赖等新字段塞进当前 frontmatter；CLI 的目标机器声明放 cli/manifest.json，不另立包元数据。

UI 清单当前写法：

```yaml
ui:
  - path: index.html
    desc: 主界面
```

页面位于 ui/，URL 使用 `skills search/load` 返回的 url_prefix。平台提供 env.js，包不覆盖；页面应为完整 HTML 文档。详细模板在 [页面手册](page-ui-manual.md)。

## 当前 API

`api/get.name.sqlx`、`api/post.name.sqlx` 分别对应 GET/POST `{url_prefix}/api/name`。引擎使用 SQLite；只在查询需要业务表时定义 tables，API 可以不提供 UI。API-only 同样必须有 SKILL.md，说明认证、参数与调用例子；当前与目标 v6 都不接受缺少使用说明的技能包。

当前能力徽标把 tables 与 api 同时存在才显示为 data；这是展示模型的现有限制，不能据此认定 API 没有表就不能执行。编写后通过实际 HTTP 调用验证，不靠徽标判断。

调用者身份由平台注入 user_id/skill_id；所有跨用户业务数据读写须正确过滤，不能由页面约定代替服务端查询约束。详见 [数据手册](data-manual.md)。

## 当前可用性和交付

CLI 的 cli/manifest.json 注册、provider 协议和配套 UI SDK 尚未实现。需要立即可用的界面可交付单 HTML，或交付含 SKILL.md 的 UI 技能包；API 包同样可按现有契约交付。用户要求真正的 CLI 注册时，先完成对应平台改造，不能用空 cli 目录冒充结果。任何技能包都必须有 SKILL.md，不引入无说明包或重复身份清单。

现有发布规则和版本限制见 [发布手册](publishing.md)。单文件 UI、纯描述或 API 均只验证实际使用的能力，不要求统一执行“开窗→pageDesc→数据库”的全链路。
