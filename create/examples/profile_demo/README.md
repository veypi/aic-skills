# 示例：一份桌面档案

`profile.json` 演示三类规则各一条：

| 规则 | 作用 | 注意 |
| --- | --- | --- |
| `alias` | `/ai/box.html` 的恒等规则（安全占位） | 真替换时把 `url` 改为**现存且接口兼容**的平台组件；白名单不代表组件可任意互换 |
| `slot` | 给 `/ai/box.html` 的真实 `footer` 插槽填自己的片段 | 片段必须**纯结构**（无脚本/无数据绑定）且放**本人空间** |
| `dock` | 侧栏用 `/os/dock.html`，停靠边自适应 | dock 目标不受"保留名单"限制 |

`layout` 段记的是窗口排布（窗口树 + 窗口记录）——改它立即生效；改 `rules` 需要 reload。

## 用起来

1. 先把一个纯结构片段（例如只有 `<div>自定义 footer</div>`）写到 `/u/{uid}/slot.html`，再把 `profile.json` 里 slot 的 `admin` 换成实际 uid；对应 URL 必须保持 `/fs/cloud/u/{uid}/slot.html` 形态。
2. 把改好的 `profile.json` 存到 `/u/{uid}/.profile/demo.json`（AI 用 fs 工具写）。
3. 切过去（页面上下文执行）：

```sh
exec 1host=page
profile apply demo
```

4. 想固化当前桌面：`profile save <name>`（会剥掉 `session_id` 等易失键，并留 `.bak` 备份）。

## 会踩的坑

- alias 目标写用户自己的文件 → **被拒**（白名单只放平台自带目录）。
- 档里出现 `..` 段 → **被拒**（不静默改写）。
- 同一组件被 alias 真正改指向后，旧组件的 slot 会变成死规则并被丢弃；本例是恒等 alias，不会使 slot 失效。
- 改完 rules 没生效 → 需要 reload（`profile apply` 会自动重载）。
- 排查：`profile inspect` 看生效规则表与被拒清单。
