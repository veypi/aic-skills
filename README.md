# aic-skills

AIC 官方**技能内容仓**。技能 = `SKILL.md` + 可选 `ui/`、`api/`、`tables/` + 普通资源；
设备侧能力另有包根 `manifest.json` + `src/`。Go embed 只携带云端静态内容（随平台 aic 构建分发）；
设备程序源码随包入库，设备自行构建，pod 不再 embed 本仓。

**中文** | [English](README.en.md)

## 内建技能

| 技能 | 版本 | 形态 |
| --- | --- | --- |
| `browser` | 1.2.8 | 说明 + UI + 设备服务：包内 Go 服务，自带 Chrome 的 CDP 通道（AI 工具 + 实时画面 + 人工交互） |
| `cua` | 1.1.3 | 说明 + UI + 设备启动器：官方 `cua-driver`（0.33.2）MCP 的远程查看与控制 |
| `blender` | 0.3.3 | 说明 + 设备服务：包内 Go 服务经 vtools/tcp 连设备上的 Blender（看场景 / 渲染 / 执行 Python） |
| `create` | 1.0.5 | 手册 + 模板 + 介绍页：AIC 扩展作者手册（云端/界面/设备三端）与给人看的扩展能力介绍页 |
| `office_studio` | 1.0.4 | 说明 + UI：Office 文档工作台 |
| `drawio` | 1.0.3 | 说明 + UI：DrawIO 绘图工作台 |
| `ppt_studio` | 1.0.4 | 说明 + UI：PPT 工坊 |
| `video_studio` | 1.0.3 | 说明 + UI：视频工坊 |
| `play_with_ai` | 1.0.4 | 说明 + UI：与 AI 对弈的多游戏台（五子棋 / 象棋） |
| `vhtml` | 0.5.1 | 说明：vhtml 前端框架指南 |
| `hello` | 1.0.1 | 示例：普通原生 CLI |

[`builtin_embed.go`](builtin_embed.go) 的 embed 列表是**唯一的发布面**——目录存在但不在列表里
就不会发布。

## 边界

- 说明、UI 与云端 API 由平台发布和使用；技能本身没有 installed / enabled / 进程 / 服务状态。
- 普通 CLI 与脚本按说明**原生执行**，由用户自行下载安装；设备服务包则带包根
  `manifest.json`（声明 `commands` / `streams`）与 `src/` 程序源码。仓内不带二进制、构建产物或 provider / SDK。
- 有状态软件经设备侧 **commands install** 登记成 vsh 根命令：browser/cua/blender 与第三方包同形态
  （包内自带服务或启动器），宿主自登记服务由设备 `mcp.servers` 配置。
- 技能页面入口与 HTTP 包服务**同段**：`/skills/cloud/{id}`（对齐 `/fs/cloud`——裸入口加载包内
  `ui/index.html`，同段又是包服务）；子页 `/skills/cloud/{id}/{page}`，详情与管理 `/skills/detail/cloud/{id}`
  （按 role 自动分派；成员 `/members`、数据 `/data`）。页面用 `url_prefix` / `$mod.scoped` 定位资源，**不要硬编码平台地址**。
  注意 fs 工具路径仍是 `/skills/{id}/...`（与 URL 不同段，勿混用）。

## 消费方式

平台侧由 aic 的 `skills.builtin` 维护事件定版：首装整包落盘并建行（`id` = 包名、属主
`system`、公开）。事件指纹由「包名 + 内嵌 `version`」组成；指纹变化触发执行，管理员也可强制重跑。
**执行时不再比较行版本**，而是把全部内嵌包无条件整目录原子交换并全量刷新行元数据；因此内容变更必须
bump 对应技能版本以改变指纹。设备侧不再共用同一份 embed：设备用 `commands install <id>` 拉取包，
并按各包 SKILL.md「安装与构建」自行编译 `bin/<name>`。

```sh
go get github.com/veypi/aic-skills@latest
```

## 测试

```sh
go test ./...                # 嵌入清单、元数据、版本、打包

cd browser/ui && npm test    # 页面测试（零依赖，node --test）
cd cua/ui && npm test
cd play_with_ai/ui && npm test

# 根 Go 测试同时覆盖两个真实 MCP 示例（initialize + tools/call）
GOWORK=off go test ./...
```

## 版本面

- **模块版本**：[VERSION](VERSION) 与 tag `vX.Y.Z`，变更见 [CHANGELOG.md](CHANGELOG.md)——
  Go 依赖面，消费方（aic 与 aic-pod）据此解析。
- **技能版本**：各 `SKILL.md` frontmatter 的 `version:`——内容版本，也是 `skills.builtin`
  指纹的组成部分；内容变更必须 bump 以触发自动定版（事件执行后无条件覆盖，不做版本大小比较）。

贡献者与 AI 代理须知（契约与不变量）见 [AGENTS.md](AGENTS.md)；文档地图见
[docs/index.md](docs/index.md)。

## 许可

MIT（[LICENSE](LICENSE)）。
