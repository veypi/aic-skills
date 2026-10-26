# 界面（vhtml 页面与组件）

> 面向"不了解平台实现"的 AI。目标：独立写出一个能打开、能交互、AI 还能操作的界面。

## 1. 形态判定

| 需求 | 形态 | 落位 |
| --- | --- | --- |
| 只想看一个界面，不发布 | 独立页面 | 用户云空间 `/u/{uid}/name.html`（长期）或页面本地 OPFS `/name.html`（临时） |
| 界面要随技能包发布 | 包内页面 | 技能包 `ui/index.html`（裸入口加载它） |
| 同一份界面要被多处引用 | 可复用组件 | 包内 `ui/local/xxx.html`，用自定义标签引用 |
| 界面要能发布给别人 | 技能包 + UI | 见 [cloud-package.md](cloud-package.md) |

判错的后果：把独立页面硬塞进技能包 → 用户没法单独打开；把可复用组件写成巨型单页 → 改一处崩一片。

## 2. 文件形态（硬要求）

组件文件必须是**完整 HTML 文档**：

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>标题</title><style>/* 作用域样式 */</style></head>
<body>
  <!-- 模板 -->
  <script setup>
    // 状态声明
  </script>
</body>
</html>
```

只写 `<template>` / `<style>` / `<script>` 的**片段会静默不挂载**（还伴随一条误导性的
"Failed to load external script" 404）——看到那条 404，先怀疑文件不是完整文档。

自定义标签按路径映射：`<user-card>` → `/user/card.html`；`<agent-list>` → `/agent/list.html`。

## 3. 状态与模板语法

在 `<script setup>` 里：

- **裸赋值**（`count = 0`、`save = () => {}`）= 公开状态，模板、refs、父组件都能读；
  `const` / `let` / `function` 只在 setup 内部可见。
- 模板里可用：`{{ 表达式 }}` 插值、`:attr="expr"` 单向绑定、`v:value="expr"` 双向绑定
  （**没有 `v-model`**）、`@click="fn()"` 事件、`v-if` / `v-else-if` / `v-else`、`v-for="x in list"`。
- `v-for` **不要写 `:key`**（自动跟踪；写了是无效属性）。
- 双向绑定只接受静态属性路径；计算结果用事件处理器赋值。
- 列表行整体替换（`items[i] = {...}`）会销毁重建行 DOM（焦点丢失）——改字段或用数组 mutator。
- setup 阶段没有 DOM：需要 DOM 就用事件回调或 `<script>` 块，不要在 setup 里碰 `$refs`。

## 4. 样式（视觉统一）

平台基调是"轻量工作面板"：简洁、克制、信息密度中高。规则只有几条，但违反会明显跑偏：

- **颜色/字号/圆角/间距一律用平台设计 token**：`--color-primary`、`--color-success`、
  `--color-danger`、`--bg-color`、`--bg-color-secondary`、`--bg-color-tertiary`、
  `--text-color`（`-secondary`/`-tertiary`）、`--border-color`、`--radius-lg`、
  `--spacing-sm|md|lg`、`--font-size-xs|sm|md|lg`。**不要硬编码 `#0f1115`、`#fff` 这类色值。**
- **不要给页面设底色**：`body` 不写 `background`、不写 `color`、不写 `font-family`——
  平台已提供并自动适配亮/暗主题。要"面"就把 `--bg-color-secondary` / `-tertiary`
  用在具体元素（卡片、面板）上。
- **body 只写布局**：`body { height: 100%; display: flex; flex-direction: column; container-type: inline-size; }`
- **窗口宽度用 `@container`，不要用 `@media`**（窗口 ≠ 视口）。容器查询基于 `container-type` 建立的容器。
- 组件样式自动作用域化（只作用于本组件 DOM）；用 `body .x` 前缀可向下穿透到后代。
- 按钮：主操作实底 `--color-primary` + 文字 `--color-primary-text`；一般操作弱面
  `--bg-color-tertiary` + `1px --border-color`；危险操作用 `--color-danger`。
- 图标用内联 SVG 或 emoji，不引外部图标字体。
- 可点击元素用 `<button>` / `<a>`，别用 div 假装按钮。

## 5. 平台能力（共享服务）

平台壳向页面注入这些共享服务（可直接用，也可经 `$mod` 读同名服务）：`$fs` `$auth` `$ai`
`$hosts` `$os` `$skills` `$account` `$catalog` `$pageExec`。细节见 [materials.md](materials.md)。

包内 API 用 `$fetch('api/xxx')`——相对地址会自动补上包服务前缀。包外资源用 `$mod.scoped`
前缀或相对路径；**不要手拼前缀、不要写死技能 id**（fork/换部署会 404）。

JS 参数用 camelCase；后端 DTO 与工具协议字段保留 snake_case。

## 6. 页面指令（让 AI 操作你的界面）

在 `<script setup>` 里声明 `pageDesc`，AI 通过窗口指令调用：

```js
pageDesc = {
  desc: '待办清单页面',
  commands: [
    {
      name: 'todo_status', desc: '待办统计', help: '无参数。返回 {"ok","total"}',
      handler: async () => {
        await load()
        return { content: JSON.stringify({ ok: true, total: items.length }) }
      },
    },
    {
      name: 'todo_add', desc: '新增待办', help: '--title <标题>（必填）',
      handler: async (argv) => {
        const i = argv.indexOf('--title')
        const title = i >= 0 ? argv[i + 1] : ''
        if (!title) return { content: '缺少 --title' }
        await add(title)
        return { content: '已添加 ' + title }
      },
    },
  ],
}
```

约定：

- 返回 `{ content: '...' }`；出错也返回可读文本（不要抛裸异常）。
- 参数从 `argv` 取；复杂数据用 stdin（`ctx.stdin`）走 JSON。
- 命令在页面内注册，AI 通过页面命令通道发现与调用；窗口命令命名空间是 `{窗口ID}.{命令名}`。
- 同页重复注册由后注册者覆盖；跨标签通过 session queue 单次投递。

## 7. 组件复用与插槽

- 组件通过属性传参：`<user-card name="Tom" :age="userAge" v:score="score" disabled></user-card>`
  （静态值 / 单向 / 双向 / 布尔存在即 true）。
- 宿主组件可以用 `<slot>` 留出口，父级投影内容进去；投影内容不是组件的一部分，作用域仍属父级。
- 往插槽里放**自定义片段**走档案规则（slot），见 [ui-profile.md](ui-profile.md)——片段是纯结构的。

## 8. 高频坑

1. 文件不是完整 HTML 文档 → 静默不挂载（伴随误导性 404）。
2. 模板里用了 setup 里的 `const` → 引用不到（公开状态一律裸赋值）。
3. `v-for` 上写 `:key` → 无效属性，删掉。
4. `@media` 做窗口响应式 → 改用 `@container`。
5. 自己设页面底色/字体 → 与平台割裂，且不随主题。
6. 手拼前缀或写死技能 id → fork / 换部署后 404。
7. 双向绑定写 `v-model` → 没有这个语法，用 `v:value`。
8. 数字输入框拿到的是字符串 → 提交前自己 `Number()`。
9. 页内导航写 `news.html` → 写相对页面名 `news`（`$router.push('news')`）。
10. 同页 query 变化不会重建组件 → 监听 `$router.onChange(...)` 自己刷新。
11. 运行时创建的元素用相对路径 → 不会被加前缀，用 `$mod.scoped + '/x.png'`。
12. 自带 `env.js` → 平台有固定出口，不生效；逻辑别写 env.js。
13. 包页面里的 `<a href="/绝对路径">` → 会被路由器拦下并按包作用域重写，跳不出去；改用按钮 + `$mod.$os.open(url)`。

## 9. 验收

- 页面能打开，控制台无错误占位（挂载失败会显示红色 `[vhtml] ... failed`）。
- 资源无 404；相对路径在包内与用户空间两种落位都成立。
- 亮色/暗色主题下都可读（只用 token 就自动成立）。
- 声明了 pageDesc 的命令能被 AI 调通，返回可读文本。
- 交互元素可用键盘聚焦，悬停/聚焦有可见反馈。
