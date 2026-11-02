# Changelog

版本号见 [VERSION](VERSION)，遵循 SemVer：破坏性变更进位 minor。

两个版本面：**模块版本**（本文件 / tag `vX.Y.Z`，Go 依赖面）与**技能版本**（各 `SKILL.md` frontmatter 的 `version:`，进入 `skills.builtin` 指纹）。内容更新 bump 技能版本以触发自动定版；事件执行时无条件整包覆盖，不做版本大小比较。契约或结构变化 bump 模块版本。

## 0.4.0 — 2026-11-02

- **新增 `manifest/` 子包：schema 1 的唯一权威解析器**（严格解析 + 归一化，未知字段与旧结构直接报错）。aic 的 `skillhub.ParseManifest` 与 aic-pod 的包装载都改为调用它；`manifest_contract_test.go` 删除本地弱副本，全部内嵌包与 create 示例/模板直接过权威 parser，仓内只保留 page 文件存在性等资产检查。
- `browser`（1.2.11 → 1.2.12）：删除 `AGENT_BROWSER_EXECUTABLE_PATH` 旧环境变量名（只认 `AIC_BROWSER_PATH`）；安装手册改为「发行包预装 + 预编译 `bin/browser`」，手动构建仅保留给源码运行 pod 的回退路径。
- `cua`（1.1.6 → 1.1.7）：安装手册同步预装形态（pod 启动定版，无需 `commands install` 与 Go 工具链）。
- `create`（1.0.9 → 1.0.10）：手册补齐包根 `manifest.json` 步骤——`ui.pages`/`ui.components`/`ui.openers`/`host` 的落位与「没有 `ui.pages` 就不出 UI 徽标、不进 launcher 子页面树」的后果；此前手册完全没提 manifest。
- 测试清扫：删除「旧 Profile 模板必须不存在」「browser 不得声明 opener」这类只为旧提交服务的断言；`AGENTS.md` 的声明面描述改为 schema 1 真值（frontmatter 只放元数据；launcher 无独立段）。
- 根 `manifest.json` 统一为 schema 1：UI pages/components/openers 与 Host 服务、内嵌 streams；pod 只消费 `host`，不解释 UI 声明。
- Profile 改为 typed registry + layout v1：saved/effective 分离，第一阶段仅 aliases/slots 装配；components 只保存贡献引用，openers 改为有序规则表（装载即生效、顺序即优先级）；非法规则与 alias-covered slot 均进入 rejected。
- `blender` 改为直接启动现成 `uvx blender-mcp`，删除自研 Go 桥接、私有 addon 与 vtools/tcp 依赖；工具面完全由上游 MCP 提供。
- `create`（1.0.5 → 1.0.9）：分篇路径、typed Profile 示例、真实 vslot/插槽目标、FS 文本读取与 JSON 字段绑定契约全面校对；Profile 模板文件名整理为 `alias.json` / `slot.json` / `components.json`，可复制示例补齐 `version`。
- `browser`（1.2.10 → 1.2.11）：去掉 `ui.openers.web` 的 http/https opener——browser UI 只用于看画面与临时交互（人工登录 / 人机验证码），外部 URL 交回系统浏览器。声明了 opener 却没有接收端会把目标 URL 静默丢弃（页面不读 `query.url`），并让「URL 无命中 → 系统浏览器」这条退路永远不触发。
- `cua`（1.1.5 → 1.1.6）：schema/能力探测从已下线的 `mcp describe` 调试直通改走 `commands info cua --schema`（返回该服务全部工具的原始描述，按名取目标工具）；`cua/ui/cua.js` 抽出共用的传输层校验，工具结果（对象）与工具目录（数组）分别校验，三处测试夹具同步。
- `blender`（0.3.5 → 0.3.6）：手册同步统一命令面——调试直通已下线，工具目录用 `<alias>`（无参）、参数表用 `<alias> <tool> --help`、原始 inputSchema 用 `commands info <alias> --schema`；服务命令的调用门是别名本身（`grant cmd <alias>`）。
- 内嵌技能内容版本同步：browser 1.2.12 / cua 1.1.7 / blender 0.3.6 / create 1.0.10 / office_studio 1.0.5 / drawio 1.0.4 / ppt_studio 1.0.5 / video_studio 1.0.4 / play_with_ai 1.0.5。
- 安装手册补齐平台 exec 的设备包目录 `grant fs`；CUA 不再宣称 Desktop 默认注册命令，Profile 总览不再把第一阶段未装配的组件绑定写成可换侧栏。
- 文档同步到当前事实：`README.md` / `README.en.md` 的技能版本表（browser 1.2.12 / cua 1.1.7 / blender 0.3.6 / create 1.0.10）与分发口径（pod 只内嵌官方预装包 browser/cua 用于启动定版；owner 服务走 `commands add` / 设备 `commands` 配置段，删掉已下线的 `mcp.servers`）；`AGENTS.md` 的分发描述同步；`create/references/device-cli.md` 的独立 MCP 服务注册改用 `commands add`。

## 0.3.6 — 2026-11-01

### `cua`（1.1.1 → 1.1.2）与 `blender`（0.3.1 → 0.3.2）：变成普通第三方包

- **pod 不再有任何 cua/blender 专属代码与配置**：两个包与 browser 同形态——
  根 `manifest.json`（统一 commands）+ 包内 Go 程序，pod 只按通用机制拉起。
  旧的 `cli/manifest.json` 维度（内嵌 packs 注册）废弃删除。
- `cua`：新增 `src/` 启动器，负责定位官方 cua-driver（`AIC_CUA_DRIVER_PATH` →
  bundle（`AIC_CUA_BUNDLE_DIR` 或可执行文件旁 `cua/`）→ PATH → macOS
  `/Applications/CuaDriver.app`）并以 `mcp` 运行，stdio 直通、退出码透传。
- `blender`：新增 `src/` Go MCP 服务，把 addon 的 vtools/tcp 桥接成 MCP 工具
  （schema 原样透传；`image_base64` 结果转成 MCP 图片内容）。
  `doctor`/`launch`/`install` 从 pod 的私有动词改为普通 MCP 工具，调用形式不变；
  addon 未连接时工具目录只有生命周期工具，launch 成功自动补齐。
  `launch` 拉起的 GUI 脱离服务进程组（pod 重启服务不再杀掉用户的 Blender）。

### 本轮修复（2026-10-31 review 后）

- `browser`（1.2.5 → 1.2.7）：UI fps 读数修复（`draw()` 成功绘制才自增
  `frameCount`，此前恒 0）；视口尺寸缓存按页面 session key 化（切页后 2 秒
  窗口内不再按上一页宽高换算坐标）；attach 模式 CDP 端点解析带 10s 超时、
  path/query 明确报错（不再静默改写）；启动前只在端口不可达时删
  `DevToolsActivePort`（活实例明确报错，不打断别人的 Chrome）；RTT 采样在
  ack 与发送记账竞争下不再丢样本；补回包头 round-trip / 拆包重组测试与 fps
  UI 用例；profile 用例兼容 Windows（HOME + USERPROFILE）。
  **关闭标签链路**：UI 等被关 target 从列表消失再选下一页（closeTarget 异步
  生效，旧快照 attach 死 id 曾报 `No target with given id found`）；没有选中
  页不再开画面流；服务端监听 `Target.targetDestroyed`，清 target 映射与当前
  绑定 session、停掉挂在死页面上的 cast；attach 死 target 的错误翻成可行动
  提示。
- `blender`（0.3.2 → 0.3.3）：图片结果 base64 双重编码修复（`ImageContent.Data`
  存解码后的原始字节，非法 base64 降级为文本错误）；addon 往返 5 分钟 I/O
  超时 + 拨号 10s 超时（Blender 卡死不再挂死服务）；addon 自述非法 schema
  跳过并记日志（SDK 对非 object schema 会 panic）；空 bridge token 明确报错。
- `cua`（1.1.2 → 1.1.3）：bundle 目录查找改包根 `cua/`（原候选是启动器自身，
  死规则）；被信号杀死时退出码归一为 1（不再是 255）。
- `cua` / `blender`：补 `src/go.mod.example` 与 SKILL.md「安装与构建」
  「免沙箱」小节（此前设备侧无从构建）；权限档名改别名口径
  （`grant cmd <alias>`，不再写 `mcp.cua` / `mcp.blender`）。
- `create`（1.0.4 → 1.0.5）：设备手册、模板与 `device_tool` 示例迁到包根
  `manifest.json` + `src/` 新契约（`commands install` + 设备侧构建），旧
  `cli/manifest.json` 写法全部清除；`device_tool` 0.1.1 → 0.1.2。
- `browser`（1.2.7 → 1.2.8）：手册补「AIC Desktop 自带 Chrome」——桌面版启动后端时注入
  `AIC_BROWSER_PATH`（随包 Chrome for Testing 的**可执行文件路径**，不是目录）；
  换浏览器用 `commands config browser AIC_BROWSER_PATH=…` 覆盖（命令定义级配置优先于
  继承环境）；独立 CLI / Docker 需自装 Chrome。
- 仓文档同步到包形态：`README.md` / `README.en.md`（技能 = `SKILL.md` + `ui/`/`api/`/`tables/`
  + 可选 `manifest.json` + `src/`；设备侧不再共用 embed，靠 `commands install` 拉包自建；
  版本表同步为 browser 1.2.7 / cua 1.1.3 / blender 0.3.3 / create 1.0.5）、
  `AGENTS.md`（pod 不再依赖本仓 Go 模块，发布面只余云端静态内容）、
  `blender/cli/aic_blender_bridge.py` 注释（命令门改为别名口径 `grant cmd blender`）。

## 0.3.5 — 2026-10-30

### `browser`（1.2.0 → 1.2.5）

- **修掉画面链路的 CDP 自锁**（实测：画面从 60fps 掉到 0.2fps）：ack Chrome 原来在
  CDP 读循环里同步发，而 CDP 响应只能由读循环读出来 → 每帧卡满 5 秒超时。
  `ackCastFrame` 改走后台 goroutine。
- **多订阅者的确认记账修正**（实测：多开 tab 时 5 秒摘掉 251 个订阅者、页面反复断流
  滚不动）：先确认的订阅者把 pending 删了，后确认的进不来 → 活跃时间不更新 →
  被误判成僵尸。现在任何确认都记账，僵尸摘除也只摘一次。
- **每个订阅者只保最新一帧**（队列深度 4 → 1，满了丢旧的）：慢订阅者不拖住链路，
  画面宁可跳帧也不堆积。
- **僵尸订阅者会被摘掉**：一直给它帧、它却 30 秒不确认就关掉连接（写失败也立即关）。
- **UI：解码失败也要 ack**（一帧坏数据不再把整条链路卡住）；**页面隐藏时放掉流**、
  回到前台自己建新流（多开 tab 时隐藏页不再白解 60fps 的帧）。
- `cast_stats` 增加可观测字段：`pageAcks` / `ackFailed` / `dropped` / `evicted` /
  `ackRttMs`（页面确认往返的平均耗时）。
- **header 上的画面自测读数**：实时帧率 + 输入往返延迟（毫秒）。画面是停是动、
  滚动卡在哪一段，看数字就行。
- **UI 不再每帧重设 canvas 尺寸**：重设 `canvas.width/height` 会清空并重新分配
  画布，每帧都做会把页面拖卡；只在尺寸真变了时才设。
- **设备侧视口尺寸带 2 秒缓存**：鼠标事件要拿视口换算坐标，滚动时每秒上百个
  事件，每个事件都发一次 CDP 去问视口会把输入管道堵住。
- **可接入用户自己的浏览器**：`BROWSER_CDP_URL`（`host:port` / `http://…` /
  `ws://…`，前两种自动问 `/json/version` 换 WebSocket）。设了就 attach 而不再
  本地启动 Chrome，`Close` 只断连不杀对方进程（`Browser.cmd == nil` 分支）。
  启动前清掉固定资料目录里过期的 `DevToolsActivePort`（进程组 SIGKILL 后残留，
  否则会去 dial 上一个实例的死端口）。
- **资料目录与窗口显示改由环境变量定，默认固定 profile**：`BROWSER_PROFILE`
  默认 `~/.aic/chrome-profile`（展开 `~`、自动建目录）——不再每次起临时目录，
  登录态与站点权限跨重启保留。`BROWSER_HEADLESS` 默认 `1`（不显示窗口），设
  `0`/`false` 弹出可见窗口，人工可直接在同一个浏览器里操作。启动日志打印实际
  生效的 profile 与 headless。
- **滚动 2 秒延迟的根因：输入在读循环里串行同步派发**（实测：30/s 时往返 28ms，
  120/s 时 p50 1 秒、max 2 秒，帧率同时从 60 掉到 42）。一次
  `Input.dispatchMouseEvent` 在 Chrome 忙时要几十毫秒，事件来得比派发快就无限
  排队，还把同一读循环里的画面确认一起堵住。现在读循环只入队，独立
  `dispatchLoop` 派发，队列里的连续事件合并（滚轮累加 delta、移动只保最新，
  离散事件按序保留不丢），队列上限 64。输入回执带事件号 `id`，页面按 id 算真实
  往返（合并后回执与发送不再一一对应，先入先出的对账会算出假延迟）。
  修复后实测：实发 800/s、92% 合并时往返 p50 17ms / max 22ms，帧率稳 60。

### 模块与工程

- 模块版本 0.3.4 → 0.3.5。

## 0.3.4 — 2026-10-30

### `browser`（1.1.3 → 1.2.0）

- 官方 `browser` 包整体换成自带的 Chrome CDP 通道：删除 agent-browser MCP（`agent_browser_*` 工具面）与其 `cli/manifest.json`（vtools pack 声明），改为根 `manifest.json`（统一 commands：`browser` → `bin/browser`；`streams.view` → `BROWSER_STREAM_ADDR`）+ `src/` 源码 + 新 `ui/` 界面。
- 工具面换成 `cdp` / `targets` / `attach` / `eval` / `navigate` / `snapshot` / `click` / `fill` / `screenshot` / `dialog_status` / `dialog_answer` / `cast_stats`；页面级工具统一走 `target_id`，UI 动作串行，attach 幂等。
- 实时画面改私有二进制协议 `browser/stream-v2`（裸 JPEG 帧 + 视口归一化输入坐标），平台只转发字节、不解析载荷；i18n key 由 `browser2.*` 收敛为 `browser.*`。
- 设备侧配置面统一走命令定义级配置（`commands config browser …`）：Chrome 路径 `AIC_BROWSER_PATH`、视口 `BROWSER_WINDOW_SIZE`、安全源 `BROWSER_SECURE_ORIGINS` 等；应用配置文件改 `~/.aic/browser/config.env`。

### 模块与工程

- 模块版本 0.3.3 → 0.3.4；根模块新增 `github.com/gorilla/websocket` 依赖（browser 源码随根模块构建与测试）。
- `.gitignore` 改写：从「忽略一切 + 逐条白名单」改为按产物类型忽略（设备编译产物、依赖缓存、打包与运行数据），新增包目录不再需要手工改规则。
- `AGENTS.md` 契约同步：`src/` + 根 `manifest.json` 的设备执行面、`commands install` 安装流、包内不留嵌套 `go.mod`（`go:embed` 跳过嵌套模块目录，否则发布出去的包没有源码）。
- 仓库文档地图 `docs/index.md` 纳入版本控制（此前被白名单规则挡在仓外，AGENTS.md 里的指针是死链）。

## 0.3.3 — 2026-10-27

### `create`（1.0.3 → 1.0.4）

- `references/cloud-data.md` 新增 §4「owner 直连（调试与数据修复）」：`POST /api/skills/{skill_id}/tables_sqlx` 原始 SQL（body `sql` + `args`/`params` 二选一、单语句 + 首词白名单、只读 1000 行截断、写操作返 `affected`/`last_insert_id`），以及 `/api/skills/{id}/tables/{table}[/{rowid}]` 结构化行后台；明确管理面 owner-only 与「禁止从 `ui/` 调用」的红线，写清与包内 `.sqlx`（黑名单、用户端、`user_id` 隔离）的分工；原 SQL 规范/常见坑/验收顺延为 §5–§7。
- 分篇索引与 §1 的 `rowid` 条目同步指向该节，补建包后「查数据 / 修数据」的落地手段（之前手册只覆盖写 `.sqlx`，owner 看不到自己的表）。

## 0.3.2 — 2026-10-27

### 运行时修复

- `play_with_ai`（1.0.3 → 1.0.4）：对齐 `$ai.attach/send` 失败语义；attach 退挂后不再向新会话误发通知，send 返回 `ok:false` 不再伪装成功，通知异常有日志处理；新增成功/attach 失败/send 失败测试。
- `browser`（1.1.2 → 1.1.3）、`cua`（1.1.0 → 1.1.1）：UI 工具调用迁到正式 `<alias> <tool>` 服务命令；CUA 仅 schema 探测保留 `mcp describe` 调试通道，测试夹具同步。

### `create`（1.0.2 → 1.0.3）

- 数据模板显式使用 `rowid AS id` / `rowid = :id`，修掉无 `id` 列却查询/删除的坏模板；数据手册同步真实字段类型、主键、get/post、SQLite 与 DDL 作者红线。
- 设备示例改为官方 MCP Go SDK 的真实 stdio 服务，含官方 SDK 依赖声明（`go.mod.example`）、`ping` handler 与 SDK client/server initialize + tools/call 测试；删除普通示例中无 Streamer 支撑的 `stream` 声明。
- 设备手册以 `<alias> <tool>` 为主，说明 `stream.channel` → 真实 `vtools.Streamer` → RTC 的现行契约、冲突/权限边界及普通 MCP/TCP 不自动获得流。
- profile 白名单改 `/shared/` `/widgets/`，slot 私有路径改 `/fs/cloud/u/{uid}/...`；示例改安全恒等 alias 与真实 `footer` 插槽，并提示组件接口兼容。
- 发布版本改“未消耗的新值”，补齐压缩前后两个 16MiB 闸门；技能发现改 `skills` 工具，`$os`、服务命令与旧注释指针同步。

### 其它技能手册

- `drawio`（1.0.2 → 1.0.3）：页面命令路径改 `/cloud/u/...`，窗口探测改 `open.events` / 根 `list`。
- `ppt_studio`（1.0.3 → 1.0.4）、`video_studio`（1.0.2 → 1.0.3）：修正窗口探测；Video 删除 page curl 跨源下载与 `-o` 落盘的无效工作流，PPT 旧页面地址同步。
- `hello`（1.0.0 → 1.0.1）：补取消与写权限探针说明，修正 usage 命令名。
- `blender`（0.3.0 → 0.3.1）、`office_studio`（1.0.3 → 1.0.4）：清理移动后的文档/路由注释。

### 模块与工程

- 模块版本 0.3.1 → 0.3.2；README 中英补齐 `cli/`、manifest、MCP/TCP 与 aic+aic-pod 消费链，Go 获取示例改 `@latest`。
- 内建定版说明改为 `skills.builtin` 外层指纹闸 + 执行时全量覆盖；版本表与 `builtin_test.go` 全部同步。
- CI 在根 Go 测试中覆盖两个 MCP 示例的 initialize + tools/call 契约，防止“能编译但无法握手”及嵌套 module 被 go:embed 跳过的回归。

## 0.3.1 — 2026-10-27

### `browser`（1.1.1 → 1.1.2）

- MCP 工具集从 `core,tabs` 扩为 `core,tabs,mobile,state`（`cli/manifest.json` 同步）：
  `mobile` 提供视口与设备模拟（实时画面比例随视口变化），`state` 提供 cookies /
  storage / auth / `state_save` / `session_*`。手册新增「工具面」一节，并提醒
  `auth_*` 与 `state_save` 会把凭据/登录态明文写入设备磁盘。

### `create`（1.0.0 → 1.0.2）

- 文档寻址同步到现行前端路由：技能详情与管理统一 `/skills/detail/cloud/{id}`（成员 `/members`、数据 `/data`；`/skills_admin` 已不存在），桌面档案示例窗口地址 `/a/coder` → `/agents/coder`，dock 示例 `/os/chrome.html` → `/os/dock.html`。

### `vhtml`（0.5.0 → 0.5.1）

- 框架仓文档架构统一，模块沙箱指针改指 `docs/architecture/module-sandbox.md`。

### 模块与文档

- 模块版本 0.3.0 → 0.3.1；新增 [docs/index.md](docs/index.md) 文档地图（技能手册仍留在
  各包目录，不进 `docs/`）。
- README / README.en 的技能版本表与 frontmatter 对齐（create 1.0.2、ppt_studio 1.0.3、
  vhtml 0.5.1）；`builtin_test.go` 版本期望同步修正（create 此前漏 bump 期望）。
- AGENTS 的契约指针改指 aic `docs/reference/skill.md`。

## 0.3.0 — 2026-10-24

> 说明：v0.2.1 之后本仓一直未打 tag（0.3.0/0.3.1 两段内容只在 main 上未发布），
> 本版一次性发布：play_with_ai 新增 + vhtml 0.4.1 + `create` 改名与重写。

**破坏性变更**：内建包 `create_skill` 更名为 **`create`**（目录、embed 清单、注册表 id 同步改）。
它已不是“创建技能”的指南，而是 **AIC 扩展作者手册**——覆盖云端 / 界面 / 设备三端的扩展形态。
（旧内建行 `create_skill` 由平台启动时一次性退役清理。）

### `create`（新，1.0.0）

- **SKILL.md**：决策流程手册——三端速查表（负责 / 持久化 / 交互协议 / 能加什么 / 读哪篇）→ 六步流程
  （① 把需求拆成三端清单 ② 选内容物与落位 ③ 只读要动的那几端分篇 ④ 建容器：建行→授权→写文件
  ⑤ 按该端协议实现 ⑥ 验收）→ 红线 8 条 → 平台动作速查 → 按端验收清单 → 分篇索引。
- **references/ 八篇**（按端命名）：`model`（三端模型 + 需求→组合对照表 + 跨层说明）、
  `cloud-package`（技能包：结构 / frontmatter / 建行写包 / 寻址）、`cloud-data`（表声明 / sqlx 接口 /
  用户隔离 / SQL 规范）、`ui-component`（vhtml 页面与组件：文件形态 / 语法 / 样式 token / 页面指令）、
  `ui-profile`（桌面档案：三类规则 / 硬约束 / 生效语义 / 档案命令面）、`device-cli`（设备命令三种形态 /
  manifest 字段 / 源码与产物边界）、`materials`（共享服务 / 三个通道 / 身份边界）、
  `publishing`（私有→广场 / 审核要点 / fork / 下架）。
- **templates/**：技能包骨架（SKILL.md + 界面 + api + tables）、桌面档案四件（空档 + alias / slot / dock）、
  设备命令骨架（manifest + 程序源码 + 安装说明模板）、普通脚本。
- **examples/**：新增 `profile_demo`（三类规则各一条 + 坑位说明）与 `device_tool`（设备命令示例包）；
  保留 `hello` / `notes` / `todo_min`。
- **ui/index.html**：给人看的扩展能力介绍页（三端关系图 + 一段真实对话 + 各端能加什么 +
  一键带 skill 标记开对话）；给 AI 的实现手册在同包 SKILL.md 与 references。

### `play_with_ai`（新增，1.0.0）

与 AI 对弈的多游戏台（自 test_skills/play_with_ai 试验版重写并升级）。**三层结构**——①游戏核心（`ui/games/<id>.js`：纯规则，不感知执行者与人数）②公共组件（`ui/core/`：席位与执行者抽象、统一执行入口 `perform(seatId, action, executor)`、存档、AI 选手推送、指令层）③页面（人类交互适配 + 渲染）。人类点击与 AI 指令走**同一个执行入口**，席位数量由游戏自己声明（框架不设上限，最低两人），扩展新游戏只需加一个核心文件并在 `ui/games/index.js` 注册一行。
  内置**五子棋**（15×15）与**象棋**（9×10：车炮马相仕帅兵全套规则、马腿/塞象眼/炮架/过河/照面/应将/将死困毙判定）。指令（窗口级命名空间，**不加前缀**）：`games` / `start` / `status` / `moves` / `rules` / `play` / `resign` / `reset`。AI 认领席位后独占该方行动权，回合轮到自己时经 `$ai` 推送通知（正文自然语言、完整局面走 system_reminder）。存档落页面本地 OPFS `/page/.games/<game>.json`（当前局 + 席位归属 + 历史归档 cap 50），刷新自动恢复。
  配套 `references/game-authoring.md`（游戏核心契约）与 `ui/tests/`（node --test：48 例，覆盖象棋规则、公共组件的人机统一入口、绘图几何不变量、存档路径与旧档迁移）。

- `play_with_ai`（1.0.0→1.0.1）：①**存档路径修正**——页面 `$fs` 走完整树路径（`/cloud/...`、`/page/...`、`/{host_id}/...`），原先的 `/.games/...` 会被解析成非法 endpoint（`fs: invalid endpoint: .games`，**写盘从未成功 → 刷新即丢局**），改为 `/page/.games/<game>.json`；②**画布尺寸与绘制同步**——canvas 的 `width/height` 改由绘制函数命令式设置（响应式绑定是异步 DOM 更新，会与同步绘制错位 → 画布比棋盘大一圈），画布改为绝对定位不参与容器尺寸计算（断开尺寸反馈循环）。
- `play_with_ai`（1.0.1→1.0.2）：席位面板的 AI 席位不再只显示「AI」，改为显示 **agent 名字 · 会话模型**（`$ai.agents.load` / `$ai.sessions.load`，仍只经平台 `$ai` 资源、不走 fetch）；读不到时回落到短 id。
- `play_with_ai`（1.0.2→1.0.3）：**旧档不再炸页面**——旧试验版（test_skills/play_with_ai）把局面直接摊在 `current` 上（**没有 `state` 字段**），新版按 `current.state` 取局面 → 读到旧档时形状校验抛 `Cannot use 'in' operator ... in undefined`，`ready` 被 reject → 页面启动脚本挂掉 → 整页白屏。现在：①整档带**格式版本号 `v`**，读档先验结构，对不上就**丢弃旧局重新开始**（记 warn，不再让页面起不来）；②旧试验版的五子棋档**一次性迁移**成新格式（棋子/回合/上一手/席位归属/棋谱都保留），不丢用户手上的局；③`load()` 整体包 try/catch，存档读坏了也照常开新局。

### `vhtml`（0.4.0 → 0.4.1）

`addSlotOverride` 契约同步 vhtml 框架新语义：①片段落点 = **平台根绝对**（注册期解析，缓存键/释放键/
解析源三者统一）；②纯结构闸门按 vhtml **真实指令面**（`v:`/`v-else-if`/`vbind`/`vslot`/内联 `on*`/
`iframe` 等；`v-model`/`v-bind`/`v-slot`/`v-cloak` 在 vhtml 中并不存在）；③片段失败记住失败态 +
错误占位（`.vhtml-slot-error`），不静默回落；④槽名白名单 `/^[a-zA-Z0-9_-]*$/`；⑤片段内嵌套组件
按**宿主模块**解析。

### 其他

- `vhtml` 的 frontmatter 版本此前未同步到 `builtin_test.go` 期望表（测试红），本轮校准；
  README 中各包版本号与实际 frontmatter 对齐（此前多包版本过期、`blender` 缺行）。

## 0.2.1 — 2026-10-19

仅技能内容更新（模块契约不变）：blender 0.2.0→0.3.0（`render` 工具、`execute_code --file/--entry`、`get_viewport_screenshot out` 落盘、手册重构）。发此版是为 aic-pod v0.9.2 内嵌集取到新内容（pod 经 Go module 嵌入技能包，未发版则 CI 只能拿到旧内容）。

### 技能版本

- `blender`（0.2.0→0.2.1）：①`get_viewport_screenshot` 增可选 `out` 落盘参数——给了就只回 `{path, mime, bytes, max_size, ms}`（不再回 base64），调用方（agent）随后用 fs read 读该 PNG，host 端图片 read 走 `image_data` 进视觉通道（原 base64 形态只有程序调用方用得上，agent 看不见画面）；addon `ADDON_VERSION` 同步 0.2.1。②手册修正示例参数名（`--max_size`，命令面按 schema 原名映射，原 `--max-size` 示例实际被拒）并补「看图」一节 + `cli/selftest.py` 断言 `out` 在 schema 里。

- `blender`（0.2.1→0.3.0）：
  ①**新工具 `render`**：渲一帧 PNG 落盘（只回 `{path,bytes,res,samples,engine,clip,camera,ms}`，不回图，调用方 fs read 就看）；
  支持临时 `camera{location,target,lens}` / `engine` / `res` / `samples` / `clip{start,end}`，渲完**一律还原**用户设置；
  相机裁剪默认按场景尺度**自适应、只扩不缩**（小模型保持默认 100m，km 级大场景自动盖住）。真机验证：临时机位渲染/显式 clip 裁切/渲完还原全通过。
  ②`execute_code` 增 `file`/`entry` 参数（读设备脚本执行；`entry` 指定载入后调用哪个入口函数，不传则只载入）——长脚本落盘后“改哪段跑哪段”，彻底避开 shell 引号；回执增 `source`/`entry`。
  ③`ping` 补 `engine/resolution/camera`（判断渲染环境）。
  ④手册重构：「脚本工作流」「看图：视口截图 vs 渲染」「坑（实测）」三节 + busy 措辞订正（busy 的调用已被丢弃、不会补执行）+ 无头选择表；
  坑条目全部在 5.2.1 真机核过（相机 clip 实测 0.1/100m、ColorRamp 按 position 排序、按 type 取 world 节点等）。

## 0.2.0 — 2026-10-16

**契约变更（结构级）**：技能包新增 `cli/` 执行端维度——`cli/manifest.json` 声明设备服务（协议 kind/别名/程序解析/stream 通道），源码随包入库；aic-pod 对内嵌集的 cli 清单注册 vsh 服务（vtools），二进制与构建产物仍不入库（契约测试收窄为拒 `provider/`、`cli/bin/` 与二进制扩展名）。

### 技能版本

- `blender`（新增 0.1.0）：设备上的 GUI Blender 直连服务——`blender` vsh 命令（doctor/launch/install 生命周期动词 + ping/get_scene_info/get_object_info/execute_code/get_viewport_screenshot 五工具）；addon `cli/aic_blender_bridge.py` 说 vtools/tcp v1（纯 stdlib，主线程 timer 泵），`cli/selftest.py` 免 Blender 自测。
- `browser`（1.0.11→1.1.0）：新增 `cli/manifest.json`（pod 内置默认项数据化，含 `aic-browser` stream 通道声明）；手册用法改直调（`browser <tool> --json`、标量参数自动成 flag）。
- `cua`（1.0.9→1.1.0）：同上（无 stream）。

## 0.1.1 — 2026-10-10

内容刷新与契约对齐（无结构变更）：同步 vhtml 指南、修正 create_skill 建技能链路与模板、UI 响应式（`@media`→`@container`）与**配色全部归到平台设计 token**；页面入口改为与包服务同段（对齐平台破坏性路由变更 `/skills/cloud/{id}`）。

### 技能版本

- `vhtml`（0.1.1→0.2.0）：指南整体同步到框架 v0.12.0（`ui/docs/SKILL.md`）——补「Module isolation（QuickJS 隔离）」章、删除已移除的 `restrictedFetch`、更正 unsafe 语义/双向绑定（只接受静态属性路径）/路由前缀兜底（路由表空间）/`manager.addAlias`/`scopeOf` 等描述。
- `create_skill`（1.0.4→1.0.6）：①建技能改为可复制的两步（`exec 1host=page` + `curl` 建行 → `grant fs /skills/{id}` 后写 `/skills/{id}/...`）；模板 `templates/ui/index.html` 去掉 `v-model`/硬编码兜底色/字体栈，补 `height:100%` + `container-type`；`examples/*` 的「当前 v5 格式」改 v6.1；页面手册 §4 去掉多余的 `list` 步骤并注明 page 通道。②页面入口写法改为 `/skills/cloud/{skill_id}`（与 `url_prefix` 同段），并明确 fs 工具路径仍是 `/skills/{id}/...`。
- `browser`（1.0.10→1.0.11）：UI 阴影字面色改 `var(--shadow-lg)`。
- `cua`（1.0.7→1.0.9）：①UI 布局断点 `@media`→`@container`（窗口≠视口），去掉 body 上的页面底色/文字色；②阴影/主色按钮字色改 `var(--shadow-sm/-lg)` / `var(--color-primary-text)`。
- `ppt_studio`（1.0.0→1.0.2）：`@media`→`@container`；旧名 `page_exec` 改 `$pageExec`；打开页面写法改 `/skills/cloud/{skill_id}`。
- `video_studio`（1.0.0→1.0.2）：①删除动作从错误的 `fs.rm` 改为页面端 `exec 1host=page rm`；打开页面写法改 `/skills/cloud/{skill_id}`。②**UI 配色全部改为平台设计 token**（index/assets/inspector/scenes/stage/timeline 六个文件的 `<style>`）：硬编码深色调色板（`#0a0e16`/`#4361ee`/`#e2e8f0`/`rgba(255,255,255,·)` 等）换成 `--bg-color(-secondary/-tertiary)` / `--text-color(-secondary/-tertiary/-disabled)` / `--border-color` 风格的 `color-mix(in srgb, var(--token) N%, transparent)` / `--color-primary(-hover/-text)` / `--color-info|success|warning|danger`；去掉 body 上的页面底色。视频文档自身的颜色（`engine.js` 文档主题默认、图表调色、字幕默认、场景背景 fallback）属内容，保持不变。
- `drawio`（1.0.0→1.0.2）：①打开页面写法改 `/skills/cloud/{skill_id}`；②**编辑器 chrome 配色 token 化**（硬编码浅色 `#24292f`/`#e1e4e8`/`#fff`/`#2f6fdb` 等 → `--text-color(-secondary/-tertiary)` / `--border-color(-hover)` / `--bg-color-secondary/-tertiary` / `--color-primary` / `--color-danger` 与 `color-mix` 淡色；内联 SVG 预览图标改 `var(--text-color-secondary)`；toast/tooltip 保持反色对）。图形形状与面板里的 `fillColor/strokeColor/fontColor` 默认值属 .drawio 格式内容，保持不变。

### 仓库

- 删除误留在 `browser/` 的 `browser.zip`（会被 `//go:embed` 一并嵌入、并被 `Zip()` 打包）；`builtin_test.go` 新增「包内不得含 `*.zip`/`*.sqlite`」断言。

## 0.1.0 — 2026-10-08

首个版本：技能仓从「带 provider/SDK/CLI manifest 的可执行包」收敛为**纯静态内容仓**。

### 变更（破坏性）

- **只保留静态内容**：技能 = `SKILL.md` + 可选 `ui/`、`api/`、`tables/` + 普通资源。删除 provider 与 SDK 机制（browser/cua/hello 的 `provider/*`、`cli/manifest.json`、`build.sh`、`cmd/build` overlay 嵌入、`sdk/go`、hello-service 整包）；内嵌集不再包含任何 provider 产物。
- **browser / cua 改为官方 MCP 说明**：browser（1.0.7→1.0.10）说明设备侧官方 `agent-browser mcp --tools core,tabs`（当前发行固定 0.38.2，工具/schema/结果原样透传，Pod 默认注册）；cua（1.0.3→1.0.7）说明官方 `cua-driver mcp`（Desktop 随包 0.33.2）。实时画面走 Pod 内建 RTC 通道，技能只提供静态说明与云端 UI。
- **hello 改为普通原生 CLI 示例**（1.0.0）：`scripts/hello.go` 自行 `go build` 放入 PATH，无 manifest、无注册表、无 MCP。
- **create_skill 手册重写**（1.0.3→1.0.4）：「静态说明 + 云端 UI/API」；`templates/cli` 与 manifest 模板删除，新增 `templates/scripts/hello.sh`；references 全面对齐现行边界。
- **UI 文件 API 统一**：drawio / office_studio / ppt_studio / video_studio 的 `$fs.open`、`$fs.save_as` 统一改为 `pickFiles` / `pickSavePath`；create_skill 新增页面共享服务契约（`$auth` / `$ai` / `$hosts` / `$skills` / `$account` / `$catalog` / `$fs` / `$pageExec`）。

### 新增

- **cua 远程查看/控制 UI**：桌面与窗口截图预览（等比压入 1280×720、≤600 KiB JPEG）、点击/双击/右键/拖动/滚轮/文字与快捷键、窗口列表过滤与失效处理、`check_permissions` 诊断保留、`capture_id`/`_meta["aic.dev/image-preview"]` 坐标映射契约。
- **browser UI 与官方 MCP 能力对齐**：标签页/导航/快照工具透传、实时画面与人工输入走 Pod 内建 Browser 通道。
- **内嵌集扩充至 9 个技能**：`drawio` / `hello` / `ppt_studio` / `video_studio` 纳入 `builtin_embed.go`（补齐 frontmatter `version: 1.0.0`）；`vhtml` 补齐 nickname / keywords / icon。
- 仓库工程面：`VERSION`、本 CHANGELOG、`AGENTS.md`、CI（gofmt / vet / go test + 各技能 UI 的零依赖 `node --test`）、README 中英双语。

### 说明

- `builtin_embed.go` 的 embed 列表是**唯一的发布面**：目录存在但不在列表中即不发布。
- 无历史兼容层：不保留旧 URL、旧协议、provider 产物或设备安装状态（2026-10-05 起设备端已无技能包机制）。
