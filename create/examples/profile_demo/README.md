# 示例：一份 typed Profile

`profile.json` 演示个人 aliases/slots 与独立 layout v1；Profile 不复制 Skill manifest 内容。

| 部分 | 作用 | 注意 |
| --- | --- | --- |
| `registry.aliases` | `/ai/box.html` 的恒等 alias（安全占位） | 真替换时把 `url` 改为**现存且接口兼容**的平台组件；白名单不代表组件可任意互换 |
| `registry.slots` | 给 `/ai/msg/tools/exec.html` 的真实 `actions` 插槽填自己的片段 | 片段必须**纯结构**（无脚本/无数据绑定）且放本人空间；apply 后用 `profile inspect` 确认 `hit:true` |
| `layout` | 窗口树与窗口记录 | 独立于 registry，由 OS 布局管道消费 |

Launcher/components/openers 若在 registry 中保存贡献引用，第一阶段只保存、不自动装配；aliases/slots 的修改需要 apply/reload。

## 用起来

1. 先把一个纯结构片段（例如只有 `<div>自定义 actions</div>`）写到 `/u/{uid}/slot.html`，再把 `profile.json` 里 slot 的 `admin` 换成实际 uid；对应 URL 必须保持 `/fs/cloud/u/{uid}/slot.html` 形态。
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
- 同一组件被 alias 真正改指向后，旧组件的 slot 不会生效，并会进入 `rejected`；本例是恒等 alias，不会使 slot 失效。
- 改完 aliases/slots 没生效 → 需要 reload（`profile apply` 会自动重载）。
- 排查：`profile inspect` 看 saved/effective、slot `hit` 与被拒清单。
