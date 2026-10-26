# 示例：一份桌面档案

`profile.json` 演示三类规则各一条：

| 规则 | 作用 | 注意 |
| --- | --- | --- |
| `alias` | 把 `/ai/box.html` 换成 `/ai/mybox.html` | 键带 `.html` = 精确替换；目标也必须是平台组件 |
| `slot` | 给 `/ai/panel.html` 的 `aside` 插槽填自己的片段 | 片段必须**纯结构**（无脚本/无数据绑定）且放**本人空间** |
| `dock` | 侧栏用 `/os/dock.html`，停靠边自适应 | dock 目标不受"保留名单"限制 |

`layout` 段记的是窗口排布（窗口树 + 窗口记录）——改它立即生效；改 `rules` 需要 reload。

## 用起来

1. 存到用户云空间：`/u/{uid}/.profile/demo.json`（AI 用 fs 工具写）。
2. 切过去（页面上下文执行）：

```sh
exec 1host=page
profile apply demo
```

3. 想固化当前桌面：`profile save <name>`（会剥掉 `session_id` 等易失键，并留 `.bak` 备份）。

## 会踩的坑

- alias 目标写用户自己的文件 → **被拒**（白名单只放平台自带目录）。
- 档里出现 `..` 段 → **被拒**（不静默改写）。
- 同一组件既 alias 又 slot → slot 变成死规则，告警丢弃。
- 改完 rules 没生效 → 需要 reload（`profile apply` 会自动重载）。
- 排查：`profile inspect` 看生效规则表与被拒清单。
