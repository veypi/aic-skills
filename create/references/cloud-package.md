# 技能包（云端容器）

> 面向"不了解平台实现"的 AI。目标：建一个能自用、能发布的技能包。

## 1. 判形态

需要**下面任一项**才值得建技能包：

- 要**发布给别人**（广场上架 / 被分叉）；
- 需要**后端接口或持久数据**（页面关掉后数据还在）；
- 需要**被平台索引**（出现在技能列表、可被搜索与调用）；
- 需要把**界面 + 数据 + 设备命令**装在一起分发。

只需要一个界面 → 见 [ui-component.md](ui-component.md)。只想改桌面 → 见 [ui-profile.md](ui-profile.md)。

## 2. 包结构

```text
example/
  SKILL.md              必需：给 AI 的说明书（frontmatter + 正文）
  ui/index.html         可选：包内页面（裸入口加载它）
  ui/langs.json         可选：包内文案（i18n）
  api/get.list.sqlx     可选：云端接口（方法.名字.sqlx）
  tables/items.json     可选：数据表声明
  manifest.json         可选：schema 1 包声明（ui.pages / host，包根）
  src/main.go           可选：设备程序源码（产物永不入库）
  references/usage.md   可选：更细的补充文档
  scripts/example.sh    可选：普通脚本附件
```

各部分**正交可选**，只有 `SKILL.md` 必需。

## 3. SKILL.md 与根 manifest.json

| 字段 | 说明 |
| --- | --- |
| `name` | 必填，**必须与注册表行的 name 完全一致**（内建包还须等于目录名） |
| `version` | 内容版本，数字点分（`1.0.0`）；改了内容就 bump。普通公开包的 release 规则见 publishing；官方内嵌包还用它组成 `skills.builtin` 指纹 |
| `nickname` | 列表里显示的名字 |
| `description` | 一句话说明"什么时候用"——这是 AI 检索技能的主要依据 |
| `keywords` | 关键词列表 |
| `icon` | 图标类名（平台自带图标集，如 `fa-solid fa-layer-group`） |

UI 页面清单放在包根 `manifest.json`，不再写 frontmatter `ui`：

```json
{
  "schema": 1,
  "ui": {
    "pages": {
      "index": { "desc": "主界面" },
      "editor": { "desc": "编辑器，对应 ui/editor.html" }
    }
  }
}
```

`ui.pages` 的 key 是不带 `.html` 的包内页面路径，值当前只有 `desc`。设备服务在同一文件的
`host` 中声明，详见 [device-cli.md](device-cli.md)。`launcher` 段已删除——pages 自动成为 launcher 中该技能的子页面，无需单独声明；
components 第一阶段仅声明不装配；openers 经统一有序表生效（Profile 用户规则优先，包声明为默认表）。
注册文件 opener 时，目标页必须实现 `pageDesc` 的 `open` 并消费初始 `$router.query.url`；文档与项目存取统一走 `$fs`，完整契约见 [ui-storage.md](ui-storage.md)。
迁移旧包已有的 handles 等能力时必须写成对应 opener，不能在格式迁移中丢能力。

内建定版与普通发布不是一套流程：`skills.builtin` 的指纹变化触发自动定版，强制重跑也可手动触发；
事件一旦执行就对全部内嵌包无条件整包覆盖并全量刷新元数据，不比较版本大小。普通私有包是直接改文件，
普通公开包则走 release 审核流，不要混写它们的覆盖语义。

正文写：**适用场景 / 不适用场景 / 步骤 / 依赖与权限 / 验收**。
"不适用场景"别省——它决定 AI 会不会在你不需要的时候硬上这个包。

## 4. 建行、授权、写文件

**建行**（`/api/skills` 是平台管理接口，只在页面上下文里调；不要与三端可调的技能数据 API 混淆）：

```sh
exec _host=page
curl /api/skills -X POST -H 'Content-Type: application/json' -d '{"name":"example"}'
```

返回含 `skill_id`、`url_prefix`，并落一份 SKILL.md 骨架。名字规则：
`^[a-z0-9][a-z0-9-_]{0,31}$`。

**授权**（私有包目录默认只读）：

```sh
grant fs /skills/{skill_id}
```

**写包**：用 fs 工具写 `/skills/{skill_id}/...`（**fs 工具路径**）。注意区分两个空间：

- fs 工具路径：`/skills/{skill_id}/SKILL.md`（文件系统侧）
- 浏览器 URL：`/skills/cloud/{skill_id}`（页面侧）——不要混写

## 5. 寻址

| 目标 | 地址 |
| --- | --- |
| 包首页（裸入口） | `/skills/cloud/{id}` → 加载 `ui/index.html` |
| 包内子页 | `/skills/cloud/{id}/{page}`（写 `page` 不写 `page.html`） |
| 包详情 / 管理 | `/skills/detail/cloud/{id}`（按 role 分派；成员 `/members`，数据 `/data`） |
| HTTP 包服务（API/静态资源） | 与页面**同段**：`/skills/cloud/{id}/...`，用 `url_prefix` 拼 |
| 包内 API（页面里调用） | **相对地址**：`$fetch('api/todos')`——前缀自动补，与部署 id 无关 |
| 包目录（fs 工具） | `/skills/{id}/...` |
| 设备/Pod 调包内 API | exec/vsh 内建 `curl {url_prefix}/api/...`，身份自动注入；页面文件内容仍用 `pull` 或下载接口 |

**不要写死技能 id 或手拼前缀**——fork 或换部署后会 404。页内导航用相对页面名
（`$router.push('sub')`），资源用相对路径或 `$mod.scoped`。

## 6. 各部分的分工

- `ui/`：界面。完整 HTML 文档 + vhtml 写法，见 [ui-component.md](ui-component.md)。
- `api/` + `tables/`：云端数据面，见 [cloud-data.md](cloud-data.md)。
- `manifest.json` 的 `host` + `src/`：设备侧命令，见 [device-cli.md](device-cli.md)。
- `scripts/`：普通脚本附件，用户自己跑；可循环调用 `{url_prefix}/api/...` 批量回写；平台**不安装、不扫描、不启动**它们。
- `references/`：补充文档（细节多时把长内容拆出去，SKILL.md 保持可读）。

## 7. 私有行与公开行

| | 私有行（工作区） | 公开行（广场） |
| --- | --- | --- |
| 存储 | `/skills/{id}/`（属主可读写） | `/skills/{id}/`（内容不可变） |
| 元数据 | frontmatter 实时生效 | 发布时冻结 |
| 数据 | 自己的运行库随改随生效 | 发布**不带数据**，公开库从空开始 |
| 更新 | 直接改文件 | 发新版本 |

同一 (owner, name) 的私有行与公开行是**两行**——同名是常态。发布细节见 [publishing.md](publishing.md)。

## 8. 高频坑

1. 把技能 API 的三端支持误套到平台管理接口 → `/skills/cloud/{id}/api/...` 可由 Page/Host/Pod 调；`/api/skills` 等管理接口仍从页面上下文调。
2. 忘了先 `grant fs` → 私有包目录写不进去。
3. frontmatter 写 `desc` 而不是 `description` → 解析失败。
4. `name` 与注册表行不一致 → 加载失败。
5. 页面里手拼 id → fork 后 404；页面用相对 API，Host/Pod 脚本把 `url_prefix` 作为参数或配置传入。
6. 把设备二进制塞进 `bin` → 包体超限且违反契约（只入库源码）。
7. 页面自带 `env.js` → 平台有固定出口，不生效。
8. 发布时把私有行里的运行库/临时文件一起打包 → 审核拒绝。

## 9. 验收

- SKILL.md 可执行、引用完整（引用的文件都存在）。
- 页面能打开，资源无 404；接口按用户隔离（换个账号看不到别人的数据）；设备批处理脚本实测过 Host/Pod 读写与失败停止。
- 包内没有二进制、构建产物、用户数据、密钥。
- `description` 说清了"什么时候用"与"什么时候别用"。
