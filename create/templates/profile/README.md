# typed Profile 模板

档案 = 一份 typed registry + layout JSON 文档，存用户云空间 `/u/{uid}/.profile/<name>.json`。

| 文件 | 用途 |
| --- | --- |
| `default.json` | 空档（什么都没改）——新桌面的起点 |
| `alias.json` | 恒等 alias 安全占位；真替换时改成现存且接口兼容的平台组件 |
| `slot.json` | 给 `/ai/msg/tools/exec.html` 的真实 `actions` 插槽填自己的片段 |
| `components.json` | `components["os.dock"]` 保存示例；第一阶段不自动绑定 |
| `openers.json` | 有序打开规则表示例（数组顺序 = 优先级，第一个命中生效；合并进 `registry.openers`） |

使用 slot 模板前，先把纯结构片段写到 `/u/{uid}/slot.html`，并把 JSON 里的 `admin` 换成实际 uid；slot URL 保持 `/fs/cloud/u/{uid}/slot.html` 形态，不能写裸 `/u/...`。

写好后让 AI 执行（页面上下文）：

```sh
exec _host=page
profile inspect          # 先看 saved / effective / rejected / slot hit
profile apply <name>     # 切档并 reload
profile save <name>      # 把当前桌面固化成正式档
```

约束（越界必被拒，详见 [../../references/ui-profile.md](../../references/ui-profile.md)）：alias 目标只指向 `/ai/` `/os/` `/page/` `/layout/` `/shared/` `/widgets/` `/assets/`；
`/os/` `/layout/` `/vb` `/page/admin` 不可替换；slot 片段必须纯结构且放本人空间；
档内禁 `..` 段。路径通过白名单不代表组件接口兼容，真替换前必须自行确认。
