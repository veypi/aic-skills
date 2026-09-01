---
description: 基于vhtml框架撰写的agent ui
name: agentui
---

---
name: agentui
description: 基于vhtml框架撰写的agent ui
---

本技能用于指导如何为 agent 撰写 ui

## 规则

- agentui 基于 vhtml 框架(一个 html 增强框架，将一个 html 文件视为一个组件或者页面)
- agentui 内置了/api/xxx, /tables/xxx 请求， 请使用 fetch 去请求
- agentui 必须保存在 ufs:$AGENT/ui目录下. 在描述中可以用 [name](url:$AGENT/i/xx)描述页面，前端会自动识别该格式并提供跳转链接。 xx 是 ufs:$AGENT/ui/目录下的路径名称(去掉.html后缀)，如.../ui/admin/user.html => 导航输出[](url:$AGENT/i/admin/user)

## 语法规则

详细语法请参考 vhtml 技能，以下是核心语法
vhtml 语法风格比较像 vue,但是不是 vue，是一个 html 增强框架

页面结构

```html
<style></style>
<body></body>
<script setup></script>
<script></script>
```

style 定义组件样式
body 定义组件 dom
setup 语法块用来注册组件响应式变量，计算属性，注册方法
script 用来初始化运行

### body

支持以下特性

- <div>{{var_name}}</div> 动态解析变量
- 支持 v-if, v-else, v-else-if, v-for
- 输入组件支持 v:value 双向绑定变量， 所有 dom 支持:attr 来设置属性
- @click, @input 等原生事件支持
- 可以访问 setup 语法块中`=`定义的变量、函数

### script setup

setup 通过=来定义响应式变量，计算属性和 组件内事件方法

```js
name = "";
id = "";
att = () => ""; //需要显式调用att()
func1 = (a1) => {};
func2 = async (a1, a2) => {};
```

### script

该脚本只在组件初始化后运行一次，可以访问 setup 中用`=`定义的变量或者函数

### 路由导航

agentui下已经是单独路由模块,做了自动路由，<a href='/i/dashboard'> $router.push("/i/dashboard")会自动映射到/ui/dashboad.html, 如果需要相关ID，可以通过$router.query.xxx_id
已存在路由

内置界面

- `/` agent 首页
- `/chat` agent 聊天页面
- `/i` 自定义首页(/ui/index.html 页面)
- `/i/name` 自定义页面 ('/ui/name.html'页面)

```js
$router.push("/i/{filename}");
$router.query.varname;
```

## 样式变量

在 style 中可以直接使用这些变量，已经在外部定义过了，style 中的语法和使用逻辑可以参考 vue 组件的 style，
禁用100vh,agentui设计的都是子页面内容，子页面body不需要设置背景，字体，颜色，padding等，由外部主题管理页面主体布局，你只负责子页面内部body布局和样式

```css
/* --- Semantics: Theme (语义主题) --- */
/* Primary Action */
--color-primary: #4361ee;
--color-primary-hover: #2563eb;
--color-primary-active: #1d4ed8;
--color-primary-text: #fff;

/* Secondary Action */
--color-secondary: #3f37c9;
--color-secondary-hover: #3730a3;
--color-secondary-active: #332d92;
--color-secondary-text: #fff;

/* Feedback */
--color-info: #0ea5e9;
--color-success: #22c55e;
--color-warning: #fbbf24;
--color-danger: #ef4444;
--color-danger-hover: #dc2626;

/* Backgrounds */
--bg-color: #f1f8ff;
--bg-color-secondary: #f7fcff;
--bg-color-tertiary: #e0edf3;

/* Text */
--text-color: #111827;
--text-color-secondary: #374151;
--text-color-tertiary: #6b7280;
--text-color-disabled: #9ca3af;
--text-color-inverse: #f1f5f9;

/* Borders */
--border-color: #d1d5db;
--border-color-hover: #9ca3af;

/* --- Dimensions: Spacing & Radius (尺寸) --- */
--radius-sm: 2px;
--radius-md: 4px;
--radius-lg: 8px;
--radius-xl: 12px;
--radius-full: 9999px;

--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;
--spacing-2xl: 40px;
--spacing-3xl: 48px;

/* --- Typography (排版) --- */
--font-size-xs: 12px;
--font-size-sm: 13px;
--font-size-md: 14px;
/* Base size */
--font-size-lg: 16px;
--font-size-xl: 20px;
--font-size-2xl: 24px;

--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 600;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

/* --- Effects (特效) --- */
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

/* --- Transitions (动画) --- */
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
```

## /api

agentui 内置了以下 REST API，所有请求使用 `fetch` 调用，Content-Type 为 `application/json`。

### Stats（运行时统计）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/stats` | 获取当前 Agent 运行时统计信息 |

返回字段：`scope`、`agent`（含 id/name/status/model/tools 等）、`session_count`、`task_count`、`message_count`、`total_tokens`、`tool_count`、`session_status`、`task_status`、`message_role`、`model_stats`、`last_session_at`、`last_task_at`、`last_message_at`。

### Sessions（会话）

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/sessions` | query: `page`(默认1)、`size`(默认20)、`name`、`hide`(默认false) | 分页查询会话列表 |
| `POST` | `/api/sessions` | body: `{ title, model, tools, env_vars, active_env_id, hide }` | 创建会话，返回完整 Session 对象 |
| `GET` | `/api/sessions/{session_id}` | — | 获取单个会话详情 |
| `PATCH` | `/api/sessions/{session_id}` | body: `{ title?, model?, tools?, env_vars?, active_env_id?, favorite?, hide? }` | 更新会话 |
| `DELETE` | `/api/sessions/{session_id}` | — | 删除会话 |
| `POST` | `/api/sessions/{session_id}/stop` | — | 停止会话 |
| `POST` | `/api/sessions/{session_id}/clear` | — | 清空会话消息 |

**Session 对象字段**：`id`、`created_at`、`updated_at`、`owner_id`、`user_id`、`agent_id`、`title`、`status`、`last_error`、`finished_at`、`context`、`env_vars`、`model`、`tools`、`active_env_id`、`channel_id`、`auto_tts`、`hide`、`favorite`、`task_id`。

列表返回格式：`{ total, page, size, items: [...] }`。

### Messages（消息）

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/sessions/{session_id}/messages` | query: `page`(默认1)、`size`(默认20)、`after_seq`、`include_hidden`、`context_state`、`order_asc` | 分页查询会话消息列表 |
| `POST` | `/api/sessions/{session_id}/messages` | body: `{ content, images?, model?, audio? }` | 创建消息（发送消息触发 Agent 回复）。`images` 为 `[{url}]` 数组，`audio` 为 base64 字符串 |
| `POST` | `/api/sessions/{session_id}/messages/{message_id}/resolve` | body: `{ action, reason?, content? }` | 解决等待中的消息（如权限确认、工具审批） |
| `POST` | `/api/sessions/{session_id}/messages/{message_id}/rollback` | — | 回滚消息（删除该消息及之后所有消息），返回 `{ deleted: N }` |
| `GET` | `/api/sessions/{session_id}/messages/{message_id}/speech` | — | 获取消息 TTS 语音 |

**Message 对象字段**：`id`、`created_at`、`updated_at`、`session_id`、`seq`、`role`、`content`、`reasoning_content`、`audio`、`images`、`tool_calls`、`tool_call_id`、`tool_call_type`、`tool_input_raw`、`permission_fingerprint`、`wait_type`、`wait_target`、`wait_target_id`、`resolved_by`、`resolved_note`、`resolved_at`、`status`、`context_state`、`hide`、`total_token`、`metadata`、`model_id`。

列表返回格式：`{ total, page, size, items: [...] }`。

### Run Tool（工具执行）

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/sessions/{session_id}/run_tool` | body: `{ tool_name, tool_data, timeout? }`（timeout 默认 30 秒） | 在会话上下文中直接执行工具，返回 `{ request_id, content, attrs, error }` |

### Tasks（任务）

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/tasks` | query: `page`(默认1)、`size`(默认20)、`status` | 分页查询任务列表 |
| `POST` | `/api/tasks` | body: 见下方说明 | 创建任务，返回 `{ task, session }` |
| `GET` | `/api/tasks/{task_id}` | — | 获取任务详情 |
| `PATCH` | `/api/tasks/{task_id}` | body: `{ title?, goal?, steps?, constraints?, model?, data?, continue_prompt?, finished_prompt?, schedule_times?, schedule_delta?, schedule_start? }` | 更新任务 |
| `DELETE` | `/api/tasks/{task_id}` | — | 删除任务 |
| `POST` | `/api/tasks/{task_id}/complete` | body: `{ result }` | 完成任务，返回 `{ task, result }` |
| `POST` | `/api/tasks/{task_id}/fail` | body: `{ error }` | 标记任务失败，返回 `{ task, result }` |
| `POST` | `/api/tasks/{task_id}/resume` | — | 恢复暂停的任务 |
| `POST` | `/api/tasks/{task_id}/cancel` | — | 取消任务 |
| `POST` | `/api/tasks/{task_id}/pause` | — | 暂停任务 |

**创建任务请求体**：

```json
{
  "title": "任务标题",
  "goal": "任务目标描述",
  "steps": "执行步骤",
  "constraints": "约束条件",
  "model": "模型名称",
  "tools": {},
  "env_vars": {},
  "continue_prompt": "继续提示词",
  "finished_prompt": "完成提示词",
  "schedule_type": "once",
  "schedule_times": 0,
  "schedule_start": "ISO时间",
  "schedule_delta": 0
}
```

**Task 对象字段**：`id`、`created_at`、`updated_at`、`owner_id`、`user_id`、`agent_id`、`session_id`、`from_session_id`、`model`、`title`、`goal`、`steps`、`constraints`、`status`、`schedule_type`、`schedule_times`、`schedule_start`、`schedule_delta`、`trigger_count`、`error`、`continue_prompt`、`finished_prompt`、`closed_at`。

列表返回格式：`{ total, page, size, items: [...] }`。

### Task Results（任务执行结果）

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/tasks/{task_id}/results` | query: `page`(默认1)、`size`(默认20) | 分页查询任务执行结果历史 |

**TaskResult 对象字段**：`id`、`created_at`、`updated_at`、`task_id`、`session_id`、`status`、`result`、`error`、`started_at`、`finished_at`、`run_index`。

列表返回格式：`{ total, page, size, items: [...] }`。

## /tables

1. 接口由 `./tables` 目录下的 `{table}.json` 文件决定：一个 JSON 文件对应一张表，文件内包含表标题、描述、字段和索引等 schema 信息。
2. 每张表会自动生成一组用户侧记录 CRUD 接口。假设存在 `XXXA.json`，则表名为 `XXXA`，用户侧库会屏蔽内部前缀，对外只需要使用 `/tables/XXXA`：

| 方法 | 路径 | 请求/参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/tables/XXXA` | query: `page`(默认1)、`size`(默认20,最大200)、`sort`(如 `-created_at`)、`filters`(JSON 字符串，仅支持精确匹配，可过滤系统字段和 schema 自定义字段，未知字段会被忽略。如 `?filters={"active":true}` 或 `?filters={"name":"Alice","age":25}`) | 列表查询，只返回当前用户记录。返回 `{ "items": [], "total": 0, "page": 1, "size": 20 }`。默认按 `created_at DESC` 排序。 |
| `POST` | `/tables/XXXA` | body: `{ "data": { "id"?: "可选主键", ...字段 } }` | 创建记录。`data.id` 可选，缺失时自动生成 UUID。`user_id`/`created_at`/`updated_at` 由系统自动写入，前端无需传入。返回完整 `TableRecord`。 |
| `GET` | `/tables/XXXA/{id}` | — | 单条查询，只返回当前用户自己的记录。若记录属于其他用户则按未找到处理。返回 `TableRecord`。 |
| `PATCH` | `/tables/XXXA/{id}` | body: `{ "data": { ...字段 } }` | 更新当前用户记录。`data` 只传 schema 自定义字段，保留字段（`id`/`user_id`/`created_at`/`updated_at`）会被忽略。`updated_at` 自动刷新。返回更新后的 `TableRecord`。 |
| `DELETE` | `/tables/XXXA/{id}` | — | 删除当前用户自己的记录。返回 `"deleted"`。 |

用户侧接口只操作当前登录用户的数据，`user_id`、`created_at`、`updated_at` 由后端自动写入，前端不需要传。

## 内置全局组件

### ai-box  

ai对话组件 双向绑定session_id 该组件透明背景无边框，可以融入主页背景
<ai-box v:id='session_id'></ai-box>

### ai注册事件 ui_run

以下两个事件为样例，请根据需要自己定义事件说明和事件响应前端代码，一般需要配合ai-box使用，监听其创建的session_id, 需要注意的是session_id创建完后请记得取消之前ID的事件订阅
事件声明文档
为 AI 编写一份事件声明（注入到 system prompt[index.md] 中），列出所有可用 action：

```markdown
 可用 ui_run 事件
 confirm — 弹出确认框

| argv | 说明 |
|---|---|
| `--prompt <text>` | 确认提示文本 |

 pick — 从选项中选择

| argv | 说明 |
|---|---|
| `--title <text>` | 选择器标题 |
| `<选项1>` `<选项2>` ... | 可选项，按位置传入 |
```

AI 阅读后按如下格式调用：

```
action: "confirm"
argv:   ["--prompt", "确认删除该文件？"]

action: "pick"
argv:   ["--title", "选择文件", "index.html", "app.js"]
```

argv 传参规则

| 写法 | 前端收到 |
| --- | --- |
| `["--key", "val"]` | `{"key": "val"}` |
| `["val1", "val2"]` | `{"0": "val1", "1": "val2"}` |
| `["pos0", "--key", "val"]` | `{"0": "pos0", "key": "val"}` |

前端订阅

前端按 action 订阅 NATS subject，收到 args 后处理并回复：
u.uid前缀 $mod.$nc已经全局配置了，只能访问子路径topic

```
subject: u.{uid}.s.{session_id}.ui_run.{action}
消息体:  解析后的 args JSON
回复:    处理结果的 JSON（直接作为 tool 返回值给 AI）
```

```javascript
// 订阅 confirm 事件
// subscription via $nc.sub() auto-adds u.{uid} prefix
let unsub = $mod.$nc.sub(`s.${session_id}.ui_run.confirm`, (err, msg) => {
    const args = JSON.parse(msg.string())   // {"prompt": "确认删除该文件？"}
    const ok = confirm(args.prompt)
    msg.respond(JSON.stringify({ confirmed: ok }))
  }
})

// 订阅 pick 事件
let unsub = $mod.$nc.sub(`s.${session_id}.ui_run.pick`, (err, msg) => {
  callback: (err, msg) => {
    const args = JSON.parse(msg.string())   // {"0": "index.html", "1": "app.js"}
    const idx = showPicker(Object.values(args))
    msg.respond(JSON.stringify({ index: idx }))
  }
})
```

## 内置对象

### 前端获取 ufs 文件或文件列表（云文件系统 $cloud_fs）

如果访问$AGENT/ui下文件，直接访问，fetch|src等获取资源的接口在组件里面已经自动加了前缀， 比如访问$AGENT/ui/xx.img, 可以直接访问 <img src='/xx.img'/>'

以下是访问 ufs 绝对路径的通用接口（`$mod.$cloud_fs`，v0.13.1 统一客户端，路径必须 `/sessions|/home|/agents|/skills` 开头）：

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `get(path)` | `{ok, content: string\|Blob, mime, size, path}` 或目录 `{ok, dir:true, path, items}` | 整读（文本原文 string / 二进制 Blob；目录自动识别） |
| `put(path, content)` | `{ok, path, bytes}` | 整写（string 文本 / Blob 二进制通吃，父目录自动创建） |
| `ls(path)` | `{ok, path, items}` | 一层目录列表 |
| `rm(path)` | `{ok, removed}` | 递归删除（文件或整棵目录树） |
| `exists(path)` | `{ok, exists}` | 存在性（HEAD） |
| `resolve(path)` | 完整 URL | 给 `<img :src>` 等资源直链（同源 cookie 鉴权） |
| `fsPrefix` | `{origin}/aic/fs` | httpfs 完整 URL 基座（URL 拼接/剥离用） |

```javascript
  readUfsText = async (ufsPath) => {
    const r = await $mod.$cloud_fs.get(ufsPath);
    if (!r.ok) throw new Error("read ufs failed");
    return typeof r.content === 'string' ? r.content : await r.content.text();
  }
  loadSessionFiles = async () => {
    if (!aiSessionId) { sessionFiles = []; return {ok: false, text: 'no ai session'} }
    try {
      const r = await $mod.$cloud_fs.ls('/sessions/' + aiSessionId + '/')
      if (!r.ok) throw new Error('HTTP')
      const items = r.items || []
      sessionFiles = items.filter(x => x && !x.dir && /\.(v|sv|txt)$/i.test(x.name || ''))
      return {ok: true, total: sessionFiles.length}
    } catch (e) {
      sessionFiles = []
      log('读取会话文件列表失败：' + (e && e.message ? e.message : e), 'wrn')
      return {ok: false, error: e && e.message ? e.message : String(e)}
    }
  }
  save_file = async () => {
    // input 选文件 → 上传
    // input.onchange = (e) => $mod.$cloud_fs.put("/sessions/sid/.....", e.target.files[0]);
    // const blob = await fetch(base64Str).then(r => r.blob());
    // $mod.$cloud_fs.put("/sessions/sid/.....", blob);
  }
```

### 前端获取本地文件（$mod.$page_fs，浏览器 IndexedDB 单根）

`$mod.$page_fs` 是共享单例（`new PageFS()`），操作浏览器本地文件系统：本地根 `/`，无用户/会话隔离（`$SESSION/$USER` 仅存在于 cloud）。API 与 `$cloud_fs` 行为一致：`get/put/ls/rm/exists`（`get` 支持目录、`put` 通吃 string/Blob、`rm` 递归）。

```javascript
  await $mod.$page_fs.put('/data.json', JSON.stringify({a: 1}))  // 本地写入
  const r = await $mod.$page_fs.get('/data.json')                // {ok, content, mime, size, path}
  await $mod.$page_fs.rm('/data.json')                           // 递归删除
```

### 注册 AI 指令通道（ai-box evts prop，推荐）

ai-box 内置 page_exec 生命周期管理：会话建立/切换自动 sub/unsub，外部只需声明 `evts` 对象：

```html
<ai-box v:id="sid" :evts="evts"></ai-box>
```

```js
  evts = {
    enable: true,                 // 默认 true；显式 {enable:false} 完全关闭 page 监听
    enable_fs: false,             // 默认 false；开启后 AI 可用 fs 8 action（read/write/edit/ls/rg/cp/mv/rm，本地 IndexedDB）
    enable_buildin_evts: '*',     // 默认 '*' 全部内建事件；逗号分隔白名单如 'open_url'；'' 全关
    commands: [                   // 自定义指令（与内建事件重名时用户优先）
      { name: 'get_selection', description: '获取选区文本',
        handler: async (argv) => window.Editor?.GetSelection?.() ?? '' },
    ],
  }
```

- 内建事件：`open_url`（--url 必填 http/https，--title，--tab new 新标签）与 `open_file`（--path 支持 page:/x、cloud:/x 前缀或会话空间相对路径，--fs page|cloud），打开的内容进 ai-box 右侧资源面板（v-show drawer，tabs 管理）
- handler 返回 string 或 `{content, attrs?}`；argv 为字符串数组原样透传
- **同一 sid 只允许一个注册方**（page_exec sub 为覆盖语义）：用了 evts 就不要再手动 sub
- 前端本地文件操作统一用 `$mod.$page_fs`（PageFS 单例，get/put/ls/rm/exists），不经事件通道

底层 API `$mod.$page_exec.sub(sid, commands, {enable_fs})` 仅在不使用 ai-box 的场景（自建会话）使用：

## 路径前缀：$mod.scoped 与 $mod.$cloud_fs

agentui 里有两个不同的 URL 根，分工明确、不可混用：

| 前缀 | 实际值 | 映射 | 用途 |
| --- | --- | --- | --- |
| `$mod.scoped` | `/aic/agents/{agent_id}` | `ufs:$AGENT/ui/` 的 web 根 | UI 自身资源（样例 json、图片、分页文件、ppt.js 等） |
| `$mod.$cloud_fs.fsPrefix` | `{origin}/aic/fs` | UFS 文件服务 | 会话文件（`/sessions/{sid}/...`）等 UFS 读写 |

- UI 目录内的资源：组件内 fetch 写相对路径（自动加 scoped）；给动态 img 用 `$mod.scoped` 拼绝对路径
- 会话目录文件：永远用 `$mod.$cloud_fs.fsPrefix + '/sessions/{sid}/...'` 全 URL（http 直通，两种场景都不会再加前缀），或直接用 `$mod.$cloud_fs.get/put`

## html->vhtml技巧