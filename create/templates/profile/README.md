# 桌面档案模板

档案 = 一份 JSON 定制文档，决定桌面长什么样。**存用户云空间**：`/u/{uid}/.profile/<name>.json`。

| 文件 | 用途 |
| --- | --- |
| `default.json` | 空档（什么都没改）——新桌面的起点 |
| `rules-alias.json` | 恒等 alias 安全占位；真替换时改成现存且接口兼容的平台组件 |
| `rules-slot.json` | 给 `/ai/box.html` 的真实 `footer` 插槽填自己的片段 |
| `rules-dock.json` | 换侧栏组件与停靠边 |

使用 slot 模板前，先把纯结构片段写到 `/u/{uid}/slot.html`，并把 JSON 里的 `admin` 换成实际 uid；slot URL 保持 `/fs/cloud/u/{uid}/slot.html` 形态，不能写裸 `/u/...`。

写好后让 AI 执行（页面上下文）：

```sh
exec 1host=page
profile inspect          # 先看当前生效的规则与被拒清单
profile apply <name>     # 切档（规则变更需 reload）
profile save <name>      # 把当前桌面固化成正式档
```

约束（越界必被拒，详见 references/ui-profile.md）：alias/dock 目标只指向 `/ai/` `/os/` `/page/` `/layout/` `/shared/` `/widgets/` `/assets/`；
`/os/` `/layout/` `/vb` `/page/admin` 不可替换；slot 片段必须纯结构且放本人空间；
档内禁 `..` 段。路径通过白名单不代表组件接口兼容，真替换前必须自行确认。
