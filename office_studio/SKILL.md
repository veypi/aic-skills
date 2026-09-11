---
name: office_studio
nickname: Office Studio
description: Office 文档工作台：打开、编辑、保存真实 office 文件（docx/xlsx/pptx），AI 与用户共用同一编辑器协作。当前已接入 Excel（xlsx）
keywords: [office, excel, xlsx, 表格, 文档, 电子表格, 编辑器, 工作簿]
icon: fa-solid fa-file-excel
ui:
  - path: index.html
    desc: Office Studio 工作台（Excel：打开 / 编辑 / 保存 xlsx；AI 经窗口指令读写）
---

# Office Studio（开发中 · Phase 0）

Office 文件工作台：在平台窗口里打开真实 office 文件（零复制，直接读写 /fs 路径的文件本体），
用户经 Univer 界面编辑；AI 经窗口指令读写同一工作簿并保存回原文件。

当前支持：**Excel（.xlsx）**。Word（.docx）与 PPT（.pptx）按计划后续接入。

## 与文件的约定

- 打开的文件 = 一个 `/fs/...` 路径（cloud / page / host 任意端，应用不区分），读写全走平台 `$fs`
- 打开方式：文件管理器双击 / `$os.open` / AI `open` 命令（同一链路）
- 保存 = 把当前工作簿导出 xlsx **写回打开时的路径**（覆盖原文件）
- 页面与用户共用同一编辑器实例：AI 的每次读写用户界面实时可见

## 指令表（开发版）

所有指令返回 `{content: "<JSON>"}` 信封：成功 `{ok:true, ...}`，失败 `{ok:false, error}`。
未就绪时除 `status` 外一律报错；先 `status` 看 `ready`。

| 指令 | 说明 | 参数 |
| --- | --- | --- |
| `open` | 打开 /fs 路径的 xlsx（也用于平台打开协议派发） | `--path` 或第一位置参数，如 `/fs/cloud/u/admin/office-test/sample.xlsx` |
| `status` | 页面状态（唯一未就绪也可调） | 无。返回 `{ready, boot_err, path, status}` |
| `read_range` | 读活动工作表范围值 | `--range A1:D5`（缺省 A1:Z60） |
| `set_range` | 写范围值（二维数组 JSON） | `--range A1:B2 --values '[[1,2],[3,4]]'` |
| `set_cell` | 写单格（值或公式） | `--cell B2 --value 42` 或 `--cell D2 --formula "=B2*C2"` |
| `save` | 导出并写回打开路径 | 无；可选 `--path` 另存 |

典型协作流程：

1. 用户/文件管理器打开一个 xlsx（或 AI `open /fs/...`）
2. AI `read_range` 读数据 → 计算 → `set_range` / `set_cell` 写回 → 界面实时可见
3. `save` 写回原文件；用户也可以在页面上直接改，AI 再读即得最新值

## 开发状态

- Phase 0 spike：xlsx 打开 / 编辑 / 导出 / 写回闭环已在真实平台验证
- 待办：Word（SuperDoc）与 PPT 接入、命令扩展（批注/公式/图表等）、SKILL.md 正式化
