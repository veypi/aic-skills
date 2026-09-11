# 平台运行时手册（技能作者视角）

> 本手册面向「第一次在本平台创建技能的 AI 助手」：内容是从平台实现提炼的实用契约，你不需要平台源码或历史记忆。
>
> 如何读本包其它文件：
> - 本地形态（技能作者自己的空间）：fs 工具读 `/u/{uid}/skills/create_skill/references/xxx.md`
> - 公开形态（从广场加载）：fs 工具读 `/skills/{load 返回的 skill_id}/references/xxx.md`
> - 全文只读；本包内 `examples/` 是可直接复制改造的完整示例。

## 1. 平台形态一页

- ivec.ai 是一个「浏览器内操作系统」：一切页面都跑在可拖拽/缩放/平铺的 **OS 窗口**里；窗口尺寸可变，不等于浏览器视口（响应式要用 `@container`，不是 `@media`）。
- **skill = 能力单元**：`SKILL.md`（必有，给 AI 看的手册）+ 按需叠加 `ui/`（给人看的界面）、`tables/` + `api/`（持久化与读写通道）。`cli/` 预留未启用。
- 人机两条交互面：
  - **人** → `ui/` 页面（HTML，跑在窗口里）
  - **AI** → 页面的**指令**（`{win_id}.{cmd}`，经 page 通道调用）+ **数据面**（sqlx 接口，经同源 curl）
- 页面与数据解耦：页面不写 SQL，一切读写走包内 sqlx 接口。

## 2. AI 作者可用工具

| 工具 | 用途 | 要点 |
| --- | --- | --- |
| `skills` | 发现与加载技能 | `search` 列表带 `url_prefix`；`load <ref>` 返回 SKILL.md 正文 + ui/apis/tables 清单 + `url_prefix` |
| `fs` | 文件读写 | cloud 空间 `/u/{uid}/...`；公开技能包 `/skills/{id}/...` 只读可达 |
| `exec` | 执行命令 | 本机/host 命令；`1host=page` 走浏览器页的指令通道（§3、§8） |
| page `curl` | 同源 HTTP | `exec 1host=page` → `curl <url>`，数据面调用（见数据手册） |

**寻址与加载其它技能**：`skills load` 的 ref **本地优先**（先试本地目录名，miss 后按注册表 uuid）；公开技能用其 id 加载。例如写页面前加载公共的 vhtml 技能：`skills search 'vhtml'` 找到条目 → `skills load <它的 id>`（若你本地已有 vhtml 目录，直接 `load vhtml`）。

## 3. 页面地址与开窗（AI 操作序）

页面 URL 前缀 `url_prefix`（search/load 输出直接给，勿自己拼 scope）：
- 本地：`/skills/local/{目录名}`；公开：`/skills/public/{技能 id}`

`exec 1host=page` 的根命令：`list` / `open` / `close` / `reload` / `curl`：

```
open {url_prefix}/index          # 打开页面（新建窗口；同一 URL 再次 open 会聚焦复用）
list                              # 列窗口表：win_id | title | origin_url | url | mode | real | events
open {url_prefix}/news           # 多页面：干净路径（不带 .html）
close <win_id>                    # 关窗
reload [win_id]                   # 刷新（缺省当前活动窗口）
```

- `open` 还接受：`/fs/...` 路径（按平台 filebind 预览，加 `?editor=1` 进编辑器）、`http(s)` 外链（内建浏览器窗口）、`--mode float` 浮窗、`--win <win_id>` 在指定窗口内打开。
- `list` 的 **events 列** = 该窗口当前可调用的 `{win_id}.{cmd}` 指令名（页面声明 pageDesc 才有）。
- 页面脚本报错/未就绪会导致 events 为空——`reload` 窗口后重查，并用 §10 的错误表定位。

## 4. 文件协议（/fs）与路径书写

四端合一（cloud 用户空间 / page 浏览器本地 / 各 host 设备）；技能最常用 **cloud**。

| 场景 | 路径形态 | 例 |
| --- | --- | --- |
| AI fs 工具（cloud 端） | `/u/{uid}/...` | `/u/{uid}/notes/todo.md` |
| 页面 `$mod.$fs`（树路径） | `/cloud/u/{uid}/...`（仅省 `/fs` 前缀） | `/cloud/u/{uid}/notes/todo.md` |
| HTTP / 消息 `@` 引用 / 浏览器地址栏 | `/fs/cloud/u/{uid}/...` | `/fs/cloud/u/{uid}/notes/todo.md` |
| 技能包（作者本地） | `/u/{uid}/skills/{name}/...`（$fs：`/cloud/u/{uid}/skills/{name}/...`） | SKILL.md、ui/index.html |
| 技能包（公开，只读） | `/skills/{id}/...` | `/skills/{uuid}/references/x.md` |
| host 设备文件 | `/fs/{host_id}/绝对路径`（$fs：`/{host_id}/...`） | — |

**页面内相对资源规则**（vhtml 自动处理，别手拼前缀）：

| 写法 | 行为 |
| --- | --- |
| `fetch('api/todos')` / `<img src="x.png">` | 自动加**包前缀**（当前页面所属 skill 的 url_prefix） |
| `fetch('/abs/x')` | **也会被加前缀**——别自己再拼前缀（双前缀即 404） |
| 运行时创建的节点（`document.createElement('img')`、第三方库 DOM） | **不会**被加前缀——用 `$mod.scoped + '/x.png'` 或完整 URL |
| `@/...` | 绕过所有前缀；`http(s)://`、`data:`、`blob:` 直通 |

## 5. $fs 完整参考（页面侧）

`$mod.$fs`（统一文件服务；返回的 `path` 均为可回喂的树路径）：

| 方法 | 签名与返回 |
| --- | --- |
| `ls(path, {depth})` | → `{ok, path, items:[{name, path, dir, size, mime, mod_time}]}`；`depth` 递归嵌套 |
| `get(path)` | 读文件 → 文本 `{ok, content: string, mime, size}`；二进制 `{content: Blob}`；目录 `{dir: true, items}`；不存在/越权 throw |
| `put(path, content)` | 写文件（string | Blob 通吃；覆写；父目录自动创建）→ `{ok, path, bytes}` |
| `mkdir(path)` | 建目录 → `{ok, path}` |
| `rm(path)` | 删除 → `{ok, path, removed}` |
| `mv(src, dst)` | 移动/重命名（同端；跨端报错） |
| `search(path, {glob, pattern, limit})` | 服务端文件名搜索 → `{ok, path, rows:[{path, name}]}` |
| `resolve(path)` | 资源直链 URL（同源 cookie 鉴权）——给 `<img :src>` / `<a download>` 用 |
| `httpUrl(path)` | 仅 cloud：HTTP 直链 |
| `home('/cloud')` | 用户空间根 → `/cloud/u/{uid}`（树路径参数必须以 `/` 开头） |
| `open({accept, multiple, directory, start})` | 平台**打开**选择器 → 文件项 / 数组 / `null`（取消） |
| `save_as({name, ext, start, accept})` | 平台**另存为**对话框 → `{path, name}` / `null`（只选路径，**不写盘**，由你自行 put） |

常用片段：

```js
const fs = $mod.$fs
const home = await fs.home('/cloud')           // '/cloud/u/{uid}'
const dir = home + '/notes'
try { await fs.ls(dir) } catch (e) { await fs.mkdir(dir) }   // 目录不存在则创建
await fs.put(dir + '/a.md', '# 你好')
const f = await fs.get(dir + '/a.md')          // f.content === '# 你好'
const pick = await fs.open({ accept: ['.md'], start: dir })
if (pick) await fs.get(pick.path)
const target = await fs.save_as({ name: '导出', ext: 'png', start: dir })  // 可能为 null
if (target) await fs.put(target.path, blob)
```

权限现实（简）：页面写自己空间直通；AI 工具面的写/删受平台分级与审批约束（平台会提示，按提示处理）。

## 6. $mod 服务表（技能页面）

| 服务 | 用途 |
| --- | --- |
| `$mod.$fs` | 文件服务（§5） |
| `$mod.$fetch(url, {method, params, body})` | **调平台 API / 数据面**：JSON 自动收发 + 同源鉴权；`params` → query、`body` → JSON；非 2xx 抛出（`e.status`/`e.code`），401/403 自动刷新重试一次；**返回解析后的 JSON 对象本体** |
| `fetch` / `$mod.fetch` | 底层 fetch（相对 URL 自动加包前缀） |
| `$mod.$auth` | 登录态：`$auth.user?.id`；`$auth.onLogin(fn)` |
| `$mod.$t` / `$mod.$i18n` | i18n（§7） |
| `$mod.$bus` | 模块级事件总线：`emit/on/off` |
| `$mod.$os` | OS 窗口桥（进阶）：`open(url, opts)` / `openNode(node)` / `pickFiles(opts)` / `focusWindow` / `closeWindow` / `listWindows` |
| `$mod.$err` | 错误码翻译 |

> **页面内不内嵌 AI**：技能的 AI 交互 = 「外部 AI 经 page 指令 + 数据面」闭环；不要在页面里接 LLM。

## 7. i18n（可选）

包内 `ui/langs.json` 由平台固定 env.js 自动并入页面 i18n（作者无需代码）：

```json
{ "zh-CN": { "todo.add": "添加" }, "en-US": { "todo.add": "Add" } }
```

- 页面里 `$t('todo.add')`；插值 `$t('k', { n: 3 })`，文案写 `{{n}}`；复数 `.zero/.one/.other`
- `_` 前缀键（如 `_err.40100`）为保留/动态键，平台扫描不会清理
- 起步阶段可以不用 i18n、直接写文案，先跑通再加

## 8. 指令面速览（pageDesc）

- 页面 setup 声明 `pageDesc = { desc, commands:[{name, desc, help?, handler}] }` → 平台采集 → AI 调 `{win_id}.{cmd}`
- 完整规格（形状校验、handler 契约、返回值、自测方法）→ `references/page-ui-manual.md`
- 探测：`exec 1host=page` → `list`（窗口表 + events）或 `commands`（全量命令带 help）

## 9. 数据面速览

- 页面读写数据：`$mod.$fetch('api/todos')`（相对路径自动加包前缀）
- AI 读写数据：`exec 1host=page` → `curl {url_prefix}/api/todos`（同源 cookie 身份；`-X/-H/-d` 子集）
- 完整规格（tables 声明、sqlx 语法、SQL 规范、owner 管理面）→ `references/data-manual.md`

## 10. 调试与自测（作者必读）

**运行时错误表**：
- 组件挂载失败 → 页面内显示红色 `[vhtml] ... failed` 占位（不是白屏）
- 全部编译/表达式/挂载错误 → `window.__vhtml_dev.errors`（最新在后，带代码预览）
- 反馈循环失控 → `window.__vhtml_dev.cascadeErrors`（10 轮保护）
- `localStorage.debug = 1` → 详细日志（路由/模块加载）

**AI 自测闭环**（不要只靠“看起来对”）：

1. 给每个页面写一条 `{页面}_status` 指令（返回 JSON：ready / 数据量 / 关键状态）——机器可断言的入口
2. `open {url_prefix}/index` → `list`（拿 win_id 与 events）
3. 调 `{win_id}.{页面}_status` 断言就绪；调业务指令做行为断言（增/删/改后读回）
4. 数据面断言：`curl {url_prefix}/api/...` 读回持久化结果
5. 失败时：读返回错误文本 → `reload` 窗口 → 复查 `__vhtml_dev.errors`

**排障对照**：

| 现象 | 可能原因 |
| --- | --- |
| open 成功但 events 为空 | pageDesc 形状非法被忽略（desc 必须 string、handler 必须函数）；或脚本报错未就绪 → reload 看错误 |
| `window "x" not found (run list to refresh)` | win_id 过期（窗口被关/重建）→ 重跑 list |
| `command "x" not found` | 指令名拼错；或页面未声明该指令（先 list 看 events） |
| API `400 missing sqlx param :x` | 请求缺参数——sqlx 里的参数**必须全部提供** |
| API 400 statement not allowed / multiple statements | SQL 触发首词黑名单（PRAGMA/事务类）或多语句 |
| 页面 404 | 技能名/页面路径拼错；本地与公开 scope 不同（`/skills/local/...` vs `/skills/public/...`） |
| 相对 fetch 404 且路径重复 | 自己又拼了包前缀（§4 规则） |

## 11. 约束速查

- 技能名：`^[a-z0-9][a-z0-9-_]{0,31}$`；**目录名 = frontmatter name = 发布名**
- 任意 UFS 路径**单段 ≤64 字符**
- 包结构：`SKILL.md` + `ui/` + `tables/` + `api/`（`cli/` 未启用）；`references/`、`examples/` 等为普通资料目录（平台透明，AI 经 fs 读）
- 发布：压缩后 ≤16MB；每用户正式技能 ≤10
- 数据：运行库 sqlite 在包目录外——**发布不带数据**，公开库从空开始
