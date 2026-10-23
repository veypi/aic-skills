# 桌面档案模板

档案 = 一份 JSON 定制文档，决定桌面长什么样。**存用户云空间**：`/u/{uid}/.profile/<name>.json`。

| 文件 | 用途 |
| --- | --- |
| `default.json` | 空档（什么都没改）——新桌面的起点 |
| `rules-alias.json` | 换掉某个组件的落点 |
| `rules-slot.json` | 给组件的插槽填自己的片段 |
| `rules-dock.json` | 换侧栏组件与停靠边 |

写好后让 AI 执行（页面上下文）：

```sh
exec 1host=page
profile inspect          # 先看当前生效的规则与被拒清单
profile apply <name>     # 切档（规则变更需 reload）
profile save <name>      # 把当前桌面固化成正式档
```

约束（越界必被拒，详见 references/ui-profile.md）：目标只指向平台自带目录；
`/os/` `/layout/` `/vb` `/page/admin` 不可替换；slot 片段必须纯结构且放本人空间；
档内禁 `..` 段。
