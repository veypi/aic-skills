---
name: notes
nickname: 笔记示例
description: 文件驱动型示例：页面浏览/编辑用户空间的 .md 文件（$fs 读写 + 打开/另存为对话框 + pageDesc 指令），演示"AI 写文件、页面展示"的协作模式
keywords: [示例, 文件, $fs, markdown, 指令]
ui:
  - path: index.html
    desc: 笔记浏览/编辑器
---

# notes（文件驱动示例）

内容以文件为准（不是数据库）：默认目录 `/cloud/u/{uid}/notes/`（`/u/{uid}/notes/` 的 $fs 树路径写法），页面可切换其它目录。
这是 ppt / drawio 一类「文件即数据」模式的最小版：**AI 用 fs 工具写文件 → 页面指令刷新展示；用户页面编辑 → 保存落盘**。

> **复制改造**：把本目录复制为 `/u/{uid}/skills/{你的名字}/`，同步修改：目录名、本文件 frontmatter 的 `name`、`nickname`/`description`。

## 页面与指令

打开：`open {url_prefix}/index`

| 指令 | 说明 |
| --- | --- |
| `notes_status` | `{ok, ready, dir, current, files}` |
| `notes_list [--dir <路径>]` | 列当前目录文件（传 --dir 先切目录） |
| `notes_open --path <路径>` | 打开文件到编辑区（接受 `/cloud/u/...`、`/u/...` 或目录内文件名） |
| `notes_save [--path <路径>]` | 保存编辑区到当前文件（传 --path 另存） |
| `notes_new [--name <文件名>]` | 新建空笔记并打开（自动补 `.md`） |
| `notes_set_dir --dir <路径>` | 切换工作目录 |

## AI 协作范式

```
fs 工具写文件：/u/{uid}/notes/会议记录.md
notes_open --path /u/{uid}/notes/会议记录.md     # 让用户在页面上看到
（用户在页面上编辑，点保存 / notes_save 落盘）
```

## 文件说明

- `ui/index.html`：侧栏文件列表 + 编辑区；演示 `$fs.ls/get/put/open/save_as` 全套文件交互。
- 无 tables/api：数据在文件里，不需要 sqlx。
