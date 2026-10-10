# aic-skills

AIC 官方**技能内容仓**。技能 = `SKILL.md` + 可选 `ui/`、`api/`、`tables/` + 普通资源；
Go embed 只嵌入这些静态内容，随平台（aic）与设备端（aic-pod）构建分发。

**中文** | [English](README.en.md)

## 内建技能

| 技能 | 版本 | 形态 |
| --- | --- | --- |
| `browser` | 1.0.11 | 说明 + UI：设备侧官方 `agent-browser`（0.38.2）MCP 的用法与实时画面 |
| `cua` | 1.0.9 | 说明 + UI：官方 `cua-driver`（0.33.2）MCP 的远程查看与控制 |
| `create_skill` | 1.0.6 | 手册 + 模板：怎么写一个技能（静态说明 + 可选云 UI/API） |
| `office_studio` | 1.0.3 | 说明 + UI：Office 文档工作台 |
| `drawio` | 1.0.2 | 说明 + UI：DrawIO 绘图工作台 |
| `ppt_studio` | 1.0.2 | 说明 + UI：PPT 工坊 |
| `video_studio` | 1.0.2 | 说明 + UI：视频工坊 |
| `vhtml` | 0.2.0 | 说明：vhtml 前端框架指南 |
| `hello` | 1.0.0 | 示例：普通原生 CLI |

[`builtin_embed.go`](builtin_embed.go) 的 embed 列表是**唯一的发布面**——目录存在但不在列表里
就不会发布。

## 边界

- 说明、UI 与云端 API 由平台发布和使用；技能本身没有 installed / enabled / 进程 / 服务状态。
- CLI 与脚本按说明**原生执行**：用户自行下载安装；仓内不带二进制、不带 manifest、不带
  provider / SDK。
- 有状态软件走**独立 MCP 服务**：Pod 默认启动官方 `agent-browser mcp` 与 `cua-driver mcp`
  （版本随 Desktop 分发固定，独立 CLI 按说明安装），第三方服务由设备 `mcp.servers` 配置。
- 技能页面入口与 HTTP 包服务**同段**：`/skills/cloud/{id}`（对齐 `/fs/cloud`——裸入口加载包内
  `ui/index.html`，同段又是包服务）；子页 `/skills/cloud/{id}/{page}`，详情 `/skills_detail/cloud/{id}`，
  管理 `/skills_admin/cloud/{id}`。页面用 `url_prefix` / `$mod.scoped` 定位资源，**不要硬编码平台地址**。
  注意 fs 工具路径仍是 `/skills/{id}/...`（与 URL 不同段，勿混用）。

## 消费方式

平台侧由 aic 的 `libs/skillhub` 在启动时定版：首跑整包落盘并建行（`id` = 包名、属主
`system`、公开），内嵌 `version` 更新时整目录原子交换，同版或更老跳过。设备端共用同一份
包，无需下载。

```sh
go get github.com/veypi/aic-skills@v0.1.0
```

## 测试

```sh
go test ./...                # 嵌入清单、元数据、版本、打包

cd browser/ui && npm test    # 页面测试（零依赖，node --test）
cd cua/ui && npm test
```

## 版本面

- **模块版本**：[VERSION](VERSION) 与 tag `vX.Y.Z`，变更见 [CHANGELOG.md](CHANGELOG.md)——
  Go 依赖面，消费方（aic）据此解析。
- **技能版本**：各 `SKILL.md` frontmatter 的 `version:`——内容版本，平台按它决定是否覆盖
  已定版内容。

贡献者与 AI 代理须知（契约与不变量）见 [AGENTS.md](AGENTS.md)。

## 许可

MIT（[LICENSE](LICENSE)）。
