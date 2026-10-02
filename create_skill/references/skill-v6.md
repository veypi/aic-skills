# Skill v6：必需说明与三种正交扩展

状态：目标方案，2026-10-01；CLI 注册等新增平台能力尚未实现。用于规划、平台开发或明确标注的格式草案，不作为当前环境可调用接口。当前格式见 [current-format.md](current-format.md)。

## 模型

统一结构：`SKILL.md（必需）+ UI? + API? + CLI?`。

SKILL.md 是每个技能包的基础：frontmatter 提供包元数据，正文说明何时使用、怎样使用、必要前提和例子。UI、API、CLI 三项正交，可任选组合；三项均不选就是纯静态描述技能，共 8 种组合。tables 是 API 可选存储，stream 是 provider 的可选通道，不增加扩展维度。

单 HTML 可以作为非技能组件直接打开；包装为技能时必须补 SKILL.md。UI-only/API-only/CLI-only 的 only 仅指运行扩展，均不能省略使用说明。包加载和发布必须校验说明文件，但运行扩展不要求先将说明正文加载到 AI 上下文。

## 包结构与元数据

```text
package/
  SKILL.md                 必需：frontmatter 元数据与正文使用说明
  ui/                      按需：界面
  api/                     按需：接口
  tables/                  按需：API 存储
  cli/                     按需：命令或驻留服务
    manifest.json          提供 CLI 时必需：命令/provider/stream 声明
  schemas/                 按需：配置/参数/数据格式
  artifacts.lock.json      按需：平台运行依赖
```

沿用 SKILL.md 中的 name、description、nickname、keywords、icon、ui 元数据；版本仍由既有发布记录与安装摘要确定。不新增 skill.json、tool.json 或第二个包身份来源，也不把 SKILL.md 改成无 frontmatter 的可选文件。

UI 入口使用现有 ui frontmatter 清单；API/tables 沿用约定文件枚举；CLI 在固定路径 cli/manifest.json 声明，不再添加 frontmatter 路径字段。平台将这些内容解析为同一个 Descriptor。缺 SKILL.md 是无效包；空 cli 目录不代表可注册能力。发现声明、设备安装、启用和授权分别处理。

UI-only 最小包是 SKILL.md + ui/index.html：说明包含如何打开、页面操作与限制。API-only 最小包是 SKILL.md + 有效 api 文件：说明包含认证、参数和 HTTP 调用例子。无需为它们增加空 CLI 或另建包清单。

## CLI 与 stream

cli/manifest.json 采用拟议的 aic.skill-cli/1 schema，声明 providers、commands 和可选 streams。它只定义执行绑定，不重复包 name/description/version。entry 与 schema 文件引用均相对包根，并校验不能逃逸目录。协议未实现前，这些只能作为设计草案。

普通 CLI 通过现有 exec 使用即可；需要注册时声明根命令，不在 manifest 重复列出全部业务子命令。参数解析、输出格式与 --help 由工具实现；SKILL.md 则解释适用场景和实际使用流程。

- process：固定程序和前置参数，标准 argv/cwd/stdin/stdout/stderr/exit_code，受设备 rules/沙箱与取消管理。
- service：驻留进程持有业务状态，通用协议提供 invoke/cancel/stream/health/shutdown。公共 SDK 独立，不依赖 pod 的 host/cfg/runtime 私有类型。

AI 调用保持 exec 完整脚本与 vsh 管道/重定向。前台等待、bg 与日志由现有 exec 层管理，不让每个工具重复实现。关闭 UI 不关闭命令或长期服务。

stream 声明 provider、端点、参数、方向、数据版本、关联命令权限和支持传输。通用层传有界字节，工具负责画面/输入等业务格式。首版使用 RTC，画面与输入不经持久消息日志；缺少 RTC 只影响依赖它的入口。重连不自动重放输入。

## UI 与组合

UI-only 不依赖 CLI/API；需要 AI 操作时才声明 pageDesc。UI 调用其他能力时显式声明所需入口，平台按当前包、版本、设备绑定提供 SDK。不要手工拼 shell 字符串，不让 UI 获取整个 NATS/设备权限。

某个页面可以依赖 CLI 与 RTC，静态帮助页可以没有依赖。CLI 不在线时保留其他独立入口。UI 资产与 provider 固定同一包摘要，旧 UI 不连接新实例的数据流。入口级依赖与 handler 是目标 UI 清单扩展，不能当作当前已支持的 frontmatter 字段使用。

API 不要求页面或 Agent 会话存活，首版复用 SQLX/SQLite 的独立 HTTP 服务；不把云端任意代码执行或 HTTP 代理当作已经提供的能力。

## Browser 与 CUA

- browser：SKILL.md + UI + CLI；说明观察、操作、下载流程，CLI 持有 Chrome/页面/下载，UI 持有展示/输入/解码，注册 page.frames/page.input；默认不需要 API。
- cua：SKILL.md + UI + CLI；说明应用/窗口/观察/操作流程，迁移现有命令、驱动和观察令牌，增加独立观察/操作面板；连续桌面 stream 尚非现有能力，有需求再实施；默认不需要 API。

业务代码、前端资源、配置 schema 和依赖锁定都随各自包交付。核心只负责通用安装/注册/运行；不能只移动源码目录，仍在 Client、RTC、OS 路由或 Electron 中留下业务特判。

## 安装与版本

包发布、设备安装、命令注册、启用与授权分别处理。加载说明或打开页面不隐式安装原生程序。执行可用性看目标 pod 的安装与健康情况，不看用户是否使用 Electron。

大型依赖在设备安装时按锁定版本与摘要准备；用户数据、秘密、profile、日志和运行库放包外。包实例重启生成新 instance_id，旧资源令牌失效。命令结果未知不自动重跑，UI 关闭只释放自己的流。

既有纯描述/UI/API 包保留 SKILL.md、目录结构和引用；无需转成另一份身份清单。CLI 包在新发布版本增加注册声明，历史发行物保持不可变。

## 模板与验收

模板按扩展提供：纯描述、UI-only、API-only、CLI process-only、CLI service+stream、UI+API、UI+CLI。每个技能模板必带有实际用法的 SKILL.md，现有 hello/notes/todo_min 同样保留并完善说明。单 HTML 非技能组件单列，不适用技能包结构。

所有技能先验证 SKILL.md 和有效元数据，再分别验证 UI 直接打开、API 无 UI 调用、CLI 无 UI 调用及组合。覆盖三项可选扩展的 8 种组合，并拒绝缺少 SKILL.md 的包。测试缺依赖、错误版本、命令冲突、权限拒绝、取消、进程崩溃与流背压；注册成功需以真实调用为证据。

当前可用能力按 v5 交付；CLI 注册、provider/stream 和新增 UI SDK 的可运行模板须随对应平台能力交付并验证。
