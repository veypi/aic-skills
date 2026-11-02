# 桌面档案（Profile）

> 面向 AI 的现行契约。Profile 是 typed registry + layout；不要写旧 `rules[]`、`kind:"dock"` 或 layout v5。

## 1. 存储与生效模型

Profile 分为：

- **saved registry**：档案里保存的期望状态，AI 可以直接编辑；
- **effectiveRegistry**：本次装载后实际生效的个人定制，带 `generation`、`rejected` 和 `diagnostics`；
- **layout**：窗口树与窗口记录，独立于贡献装配。

存储位置：

| 类型 | 位置 | 生命周期 |
| --- | --- | --- |
| 正式档 | `/u/{uid}/.profile/<name>.json` | 长期保存，同名覆盖前写 `.bak` |
| 临时档 | 页面 localStorage | 首次修改桌面时物化，保留最近 20 份 |

URL 参数：缺省读取 `default`；`?profile=none` 不读档；`?profile=<name>` 读取具名档；`?profile=tmp_<id>` 读取临时档。`tmp_` 是保留前缀。

## 2. 文档结构

```json
{
  "v": 1,
  "base": "default",
  "registry": {
    "components": { "os.dock": "your-skill:dock" },
    "openers": [
      { "match": { "extensions": ["docx"] }, "page": "office_studio:word" },
      { "match": { "schemes": ["http", "https"] }, "page": "browser:index" }
    ], 
    "aliases": [
      { "match": "/ai/box.html", "url": "/ai/box.html" }
    ],
    "slots": [
      {
        "component": "/ai/msg/tools/exec.html",
        "slot": "actions",
        "url": "/fs/cloud/u/admin/slot.html",
        "mode": "override"
      }
    ]
  },
  "layout": {
    "v": 1,
    "tree": { "k": "leaf", "id": "w-1" },
    "activeId": "w-1",
    "maximizedId": null,
    "windows": []
  }
}
```

| 字段 | 含义 | 当前生效方式 |
| --- | --- | --- |
| `registry.components` | point → 组件贡献引用 | 第一阶段只保存，不自动绑定 |
| `registry.openers[]` | 有序打开规则：`{match:{schemes/extensions/prefixes}, page:"<skill_id>:<page_id>"}` | 生效：顺序即优先级，第一个命中生效；用户表先于默认表（内置注册 + 包 manifest 聚合） |
| `registry.aliases[]` | 个人组件落点定制 | `apply` 后注册生效 |
| `registry.slots[]` | 个人插槽投影定制 | `apply` 后注册生效 |
| `layout` | v1 窗口树和窗口记录 | 由 OS 布局管道消费 |

**Profile 不复制 manifest 内容。** Skill 页面与组件声明以包根 `manifest.json` 为准；components 只保存贡献引用。openers 是有序规则表（规则 + 打开点），不再是贡献引用——默认表由内置注册应用与各包 manifest openers 聚合而成，用户表优先并可调序。

## 3. aliases 与 slots

### alias

| 字段 | 含义 |
| --- | --- |
| `match` | 被替换的平台组件路径；`.html` 结尾是精确键，否则是段边界前缀键 |
| `url` | 替换目标；精确键目标以 `.html` 结尾，前缀键目标不以 `.html` 结尾 |

### slot

| 字段 | 含义 |
| --- | --- |
| `component` | 宿主组件路径 |
| `slot` | 槽名，空串是默认槽 |
| `url` | 本人空间的片段 URL |
| `mode` | `override`（默认）或 `soft` |

现有装载约束继续有效：alias 目标是平台组件，slot 片段位于本人空间；禁止 `..` 穿越；平台保留组件不可被 alias 替换；真正改指向的 alias 与同一组件的 slot 互斥。无效项进入 `rejected`，不会伪装成已生效。

## 4. AI 编辑并生效

1. 先执行 `profile inspect`，确认当前 saved、effective 和 rejected。
2. 用 fs 写面编辑 `/u/{uid}/.profile/<name>.json`。
3. 执行 `profile apply <name>`。该命令显式切档并 reload，aliases/slots 随后生效。
4. 再执行 `profile inspect` 验收。

`generation` 每次成功装载递增；并发读取时只有最新一次 load 可以提交，旧异步结果不得覆盖新状态。保存到档案不等于 Skill 贡献已生效，必须区分 `registry` 与 `effectiveRegistry`。

## 5. 命令面

| 命令 | 作用 |
| --- | --- |
| `profile list` | 列出正式档 |
| `profile save <name>` | 保存当前 saved registry 与 layout，写 `.bak` 并清理临时档 |
| `profile apply <name>` | 切换到具名档并 reload |
| `profile revert` | 弃临时档，回到底档并 reload |
| `profile inspect` | 输出来源、saved registry、effectiveRegistry、generation 和 rejected |

## 6. 验收

- 文档只有 `registry`，没有旧 `rules`；layout 使用 `v:1`。
- AI 编辑正式档并 apply 后，alias/slot 出现在 effectiveRegistry。
- components 引用只保存不生效；openers 有序规则表生效，坏规则进 rejected。
- 无效个人定制能在 rejected 中看到原因。
- 保存后再次 inspect，base、临时档和 generation 符合预期。
