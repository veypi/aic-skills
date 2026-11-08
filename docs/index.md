# aic-skills 文档地图

本仓是**技能内容仓**：每个技能包自己的 `SKILL.md` / `references/` / `ui/` 是发布内容，
不是仓库文档，永远留在包目录里，不移进 `docs/`。仓库级文档按统一架构放在根目录与本文件。

## 入口

| 文档 | 内容 | 何时读 |
| --- | --- | --- |
| [README.md](../README.md) / [README.en.md](../README.en.md) | 仓定位、内建技能与版本表、边界、消费方式、两个版本面 | 了解或消费本仓前 |
| [AGENTS.md](../AGENTS.md) | 契约与不变量：包结构、embed 发布面、版本规则、测试 | 新增/修改技能包前必读 |
| [CHANGELOG.md](../CHANGELOG.md) | 模块版本与技能版本的变更记录 | 发版与升级时 |
| [VERSION](../VERSION) | 模块版本（Go 依赖面），技能版本看各包 frontmatter | 发版时 |

## 技能手册（发布内容，按包查阅）

| 包 | 手册与分篇 |
| --- | --- |
| `create` | [SKILL.md](../create/SKILL.md) + [references/](../create/references/)（三端扩展作者手册）+ [templates/](../create/templates/) + [examples/](../create/examples/) |
| `browser` / `cua` | [browser/SKILL.md](../browser/SKILL.md)、[cua/SKILL.md](../cua/SKILL.md)（设备 MCP 用法与实时画面） |
| `blender` | [blender/SKILL.md](../blender/SKILL.md) |
| `vhtml` | [vhtml/SKILL.md](../vhtml/SKILL.md)（前端框架指南，源在 vhtml 仓 `ui/docs/SKILL.md`） |
| `drawio` | [drawio/SKILL.md](../drawio/SKILL.md) + [references/](../drawio/references/) |
| `office_studio` / `ppt_studio` / `video_studio` / `play_with_ai` | 各包 `SKILL.md` 与其 `references/` |
| `3d_maker` | [3d_maker/SKILL.md](../3d_maker/SKILL.md)（建模代码编写指南 + 工作台 UI） |
| `hello` | [hello/SKILL.md](../hello/SKILL.md)（最小 CLI 示例） |

## 约定

- 技能内容变更必须 bump 该包 `SKILL.md` 的 `version:`（它进入 `skills.builtin` 指纹，触发自动定版；
  事件执行时无条件整包覆盖，不做版本大小比较），并同步 `builtin_test.go` 的版本期望与 README 的版本表。
- 契约或结构变化 bump 模块 `VERSION` 并写 CHANGELOG；文档与代码注释里的跨仓指针
  （如 aic `docs/reference/skill.md`）随对方仓库移动同轮更新。
