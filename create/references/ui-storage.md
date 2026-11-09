# UI 文件与存档（统一 `$fs`）

> 面向要创建编辑器、工作台、笔记、设计工具等 UI 的 AI。目标：用户产物是平台文件树里的真实文件，而不是某个页面私有的项目库。

## 1. 默认契约

**UI 创建、打开和编辑的用户产物，默认全部通过 `$fs` 持久化。** 包括文档、项目存档、导入素材、生成文件和导出结果。

不要再建一套应用私有文件系统：

- 不直接操作 OPFS、IndexedDB 或设备原生路径；
- 不用 `localStorage` 保存文档正文或素材；
- 不扫描私有目录生成「我的项目」，不在应用里重复实现文件管理器；
- 不自行实现跨端复制、移动或迁移协议，统一用平台文件管理器与 `$fs.transfer`。

`localStorage` 只保存少量界面偏好和最近打开记录，例如面板尺寸、主题选项、最近文件路径。需要按条件查询、共享或协同的结构化业务记录才使用技能数据表，见 [cloud-data.md](cloud-data.md)；文档和文件型项目不为了查询方便另存一份到表里。

## 2. 首页：打开、新建、最近记录

没有打开文档时显示首页，不显示空编辑器。首页至少提供：

1. **打开**：`$fs.pickFiles({ accept: ['.your_ext'] })`；
2. **新建**：`$fs.pickSavePath(...)` 选择目标，再写入初始文档；
3. **最近打开**：标题、完整 `/fs` 路径和打开时间；点击后重新打开文件。

最近记录只是历史索引，不是文件清单：

- 打开或新建保存成功后写入，按路径去重置顶；
- 「移除」「清空」只修改历史，不删除文件；
- 路径失效时显示错误并允许移除记录，不扫描目录猜测新位置；
- 不自动扫描目录，不提供「删除项目」「移动项目」等文件管理功能。

## 3. 路径：对外 `/fs`，内部完整树路径

用户、链接和页面指令统一使用：

```text
/fs/cloud/u/{uid}/docs/a.note
/fs/page/.notes/a/a.note
/fs/{host_id}/Users/name/Documents/a.note
```

`$fs` 方法接收完整树路径：去掉开头的 `/fs`，得到 `/cloud/...`、`/page/...` 或 `/{host_id}/...`。只在协议边界转换一次；应用内部始终保存完整树路径，不拆成设备、目录、项目名等多套状态。

```js
const toTree = path => String(path || '').replace(/^\/fs(?=\/)/, '')
const toRef = path => String(path || '').startsWith('/fs/') ? path : '/fs' + path
```

不要把 `/fs` 当成真实存储位置，也不要假设文件一定在云端或当前浏览器。对技能而言，它只是一个可由 `$fs` 读写的地址。

## 4. 文件型文档

单文件文档直接保存到用户选择的位置：

```js
// 打开
const picked = await $fs.pickFiles({
  accept: ['.note'],
  multiple: false,
  start: currentPath ? parentOf(currentPath) : '/page/.notes',
})
if (picked) await openDocument(picked.path)

// 新建或另存为；选择器只返回路径，写入由应用完成
const target = await $fs.pickSavePath({
  name: '未命名.note',
  ext: '.note',
  accept: ['.note'],
  start: currentPath ? parentOf(currentPath) : '/page/.notes',
})
if (target) await $fs.writeFile(target.path, serializeDocument())
```

文本读取必须同时处理 `string | Blob`；二进制直接传 `Blob`。媒体优先用 `$fs.resolve(path)` 取得 lease，使用 `lease.url`，结束后 `lease.close()`，不要把大文件转成 base64 写进 JSON。

## 5. 项目型存档：主文件 + 相对资源

项目包含场景、素材等多个文件时，用一个主存档文件作为唯一入口。建议自定义扩展名并在 JSON 中声明格式版本：

```json
{
  "format": "your_app/1",
  "title": "示例",
  "scenes": ["scenes/scene_1.json"],
  "assets": ["assets/cover.png"]
}
```

默认每个项目使用独立目录：

```text
/fs/page/.your-app/demo/
├── demo.your_app
├── scenes/
│   └── scene_1.json
└── assets/
    └── cover.png
```

路径规则：

- 主文件父目录是项目根；所有依赖只记录相对于该根的路径；
- 引用使用 `/` 分隔，禁止绝对路径、`/fs` 路径、`..` 和逃逸项目根的路径；
- 文档中不保存 host id、用户 id 或端特定的物理路径；
- 另存为到新目录时复制主文件、拆分文档和素材，相对引用保持不变；
- 跨端另存为或迁移使用 `$fs.transfer`，全部成功后再切换当前路径；
- 移动整个项目目录后无需改写主文件。迁移单位是项目目录，不是孤立的主文件。

缺少资源要暴露具体相对路径，不静默忽略。导出物不是编辑依赖，不应被主文档隐式引用。

## 6. 注册格式与统一打开入口

文件型 UI 在包根 `manifest.json` 注册扩展名：

```json
{
  "schema": 1,
  "ui": {
    "pages": {
      "index": { "desc": "打开、新建与最近记录" },
      "editor": { "desc": "文档编辑器" }
    },
    "openers": {
      "document": {
        "page": "editor",
        "name": "Your Editor",
        "match": { "extensions": ["your_app"] }
      }
    }
  }
}
```

编辑页必须：

1. 声明 `pageDesc.commands` 中的 `open`，接收 `/fs/...` 文件路径；
2. 初始化时读取 `$router.query.url`，调用与 `open` 相同的打开函数；
3. 监听后续同页打开请求，避免 query 改变后仍显示旧文档；
4. 首页、平台 opener 和 AI 指令共用同一个打开实现，不各写一套。

## 7. 保存与页面指令

- 已有路径时保存写回原路径；没有路径时进入另存为选择器；
- 自动保存串行执行，异步写入不能覆盖更新后的文档状态；
- 另存为失败时保留原路径和原存档，不先切换再补复制；
- 页面指令使用 `open --path /fs/...`、`save`、`save_as --path /fs/...`、`reload` 等文件语义，不使用私有项目名寻址；
- AI 写完文件后调用 `reload` 或重新 `open`，页面不假设能感知外部写入。

## 8. 验收

- 未打开文档时有可用首页，而不是空白编辑器；
- 能从 Page、Cloud 和至少一种 Host 路径打开、保存、另存为；
- 最近记录只索引真实路径，移除记录不会删除文件；
- 项目目录移动或跨端复制后，从新位置打开时所有相对资源仍可用；
- 存档中没有端特定绝对路径、base64 大素材或私有项目库副本；
- 文件管理器点击已注册扩展名能进入正确页面并打开目标；
- 页面没有自研目录扫描、项目删除、跨端迁移等文件管理器功能。
