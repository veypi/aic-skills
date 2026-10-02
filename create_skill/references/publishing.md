# 发布手册（私有 → 广场）

> 适用范围：现行 v6.1 行为（2026-10-02 核对）。包格式与能力契约见 [current-format.md](current-format.md)。

发布 = 把 caller 的**私有行**（工作区）打包拷贝为不可变的**公开行**，经审核后上架广场。私有行保留可改；发布不带数据、不带审核信任（内容进入审核）。

## 1. 形态差异速查

| | 私有行（工作区） | 公开行（广场） |
| --- | --- | --- |
| 存储 | `/skills/{id}/`（owner 可读写） | `/skills/{id}/`（内容不可变） |
| 寻址 | 注册表 id（AI 面可按 name 便利解析） | 注册表 id |
| 页面 URL | `/skills/cloud/{id}/...` | `/skills/cloud/{id}/...`（同族，按行归属鉴权） |
| 元数据 | SKILL.md frontmatter 实时生效 | 发布时落库冻结 |
| 数据 | sqlite 运行库随改随生效 | 发布不带数据；公开库从空开始 |
| 更新 | 直接改文件 | 发新版本 |

同一 (owner, name) 的私有行与公开行是两行：工作区与发布物同名是常态。

## 2. 发布流程

1. 管理页（`/skills_admin/cloud/{id}`）发起，或 `POST /api/skills/releases {source, name?, version}`（source = 私有行 id/name；name 省略 = 公开占 source 名）。
2. 契约校验：frontmatter name == 注册表行 name；含 cli/ 必有有效 manifest；有 artifacts.lock 必有效——坏清单直接拒发，走不到审核。
3. 配额：公开行 ≤10/用户（仅新条目占名额，发新版不占）。
4. 服务端流式打包私有行目录（**不含 `.sqlite` 运行库**——在包目录外）；**16MB 闸门**：压缩后超限立即失败，走不到审核。
5. **审核**：全量审核（含纯文本；SKILL.md 同样是注入载体）；管理员自发布 autoApprove。
6. 通过 = 公开行落库 + 目录冻结（历史版本 zip 不可变留存）；拒绝 = 备注 + 可重提（**版本号须递增**——提交即消耗，被拒也算）。版本号正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$`，禁连续点。

## 3. 发布前自查（≈ 审核关注点）

- **ui/**：有没有越权调用平台 API（任意 `/api/...`）、偷传数据、来路不明的脚本；地址一律 `{url_prefix}/...` 或相对路径派生，不写死前缀。
- **api/**：SQL 是否拼接字符串（禁止）；`user_id = :user_id` 行级过滤是否齐全；全表拉取是否加 LIMIT。
- **cli/**：manifest 有效（providers 非空、id 唯一、entry 相对不逃逸、stream 引用存在的 provider）。
- **文本**：内容合规。
- **通用**：frontmatter 严格 yaml 且 name 与注册表行一致；包体积；无调试垃圾（`.bak`、临时文件、大素材）。

## 4. 常见拒绝原因

1. name 与注册表行不一致 / 名字不合规（`^[a-z0-9][a-z0-9-_]{0,31}$`）。
2. frontmatter 拼错字段导致解析失败（如 `desc` ≠ `description`）。
3. sqlx 多语句、DDL、拼接 SQL、缺 `:user_id` 过滤。
4. UI 写死包前缀（fork/改名后 404）——用相对路径或 `$mod.scoped`/`url_prefix` 派生。
5. 包内塞大文件（>16MB）或无关二进制。
6. 内容违规 / 明显调试残留。

## 5. 发布后

- **验证**：换一个账号 → `skill search` 找到条目 → `skill load` 其 id → 打开 `{url_prefix}/index` → `curl` 数据面读回。
- **内容不可变**：无编辑面 + fs 门只读双保险；任何修改 = 发新版本；`description/nickname/keywords/icon` 随新版本从 frontmatter 刷新（非空覆盖、省略保持现值）。
- **数据不迁移**：公开库从空开始；要带数据就用 owner 管理面（`tables_sqlx`）导出/重建。
- **删除条目（下架）**：管理页危险区——删行 + 包目录 + 全部历史 zip + 运行库，agent_binds 级联硬删，释放名称与名额；已安装设备不受影响。
- **fork**：`POST /api/skills/{id}/copy`（或 cloud vsh `skill download <ref>`）→ 得 caller 私有副本（可改可再发布）。

## 6. 试用副本（了解即可）

审核台的「试用」会把待审 zip 解压为**审核员自己的临时私有行**用于真实试用；审核决定（通过/拒绝）后统一清理。作者无需操作。
