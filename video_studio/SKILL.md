---
name: video_studio
version: 1.1.10
nickname: 视频工坊
description: 浏览器内一站式视频制作：.video_studio 可迁移存档 + AI 文件驱动编辑 + 可视化舞台/时间轴，场景运镜、24 张实战镜头卡、判例式审美准则、声明式 SFX、节拍分析、真实 3D、AI 配音，WebCodecs 硬编导出 MP4
keywords: [video, 视频, 剪辑, 动画, 运镜, 镜头卡, 卡拍, 音效, 3D, MP4, 配音, TTS, 时间轴, WebCodecs]
icon: fa-solid fa-clapperboard
---

# Video Studio · 视频制作

浏览器端视频工作台：场景列表 + 舞台（点选/拖拽/双击改字）+ 属性面板 + 多轨时间轴，编辑实时保存，浏览器内直接导出 MP4/WebM（WebCodecs 硬编，无需后端渲染）。

核心工作模式是**文件驱动**：用户产物是一个 `.video_studio` JSON 主存档，场景与素材都在主文件目录内用相对路径引用。AI 撰写/修改文件，页面预览与可视化编辑。

**做片子不是写 JSON，是执行制作流程**：简报 → 分镜（镜头卡 + 能量曲线）→ 实现 → 声音 → 截帧自检 → 独立终检 → 交付。格式字段只是最后的落地手段。

## 何时读哪个文件

| 时机 | 读 |
|---|---|
| 接到"做视频"需求 | `references/pipeline.md`（六阶段流水线 + 两种创作模式） |
| 处理长录屏、操作实录、选择性加速 | `references/screen-recording.md`（连续 PTS 变速、完整操作保留、4K 分段编码与实长校准） |
| 分镜选镜头 | `references/shots/README.md` 索引 → 选中卡全文（24 张配方卡） |
| 写/改 JSON | `references/format.md`（字段契约：元素/动画/运镜/SFX/three/拆分） |
| 实现与自检全程 | `references/aesthetic-rules.md`（R/Q/S/C/P 判例式准则，逐条对照） |
| 画面锁定后配音效 | `references/sound-design.md`（词汇表/钉帧表/卡拍/混音） |
| 交付前 | `references/final-review.md`（独立 subagent 终检，首检不交给用户） |

## 片架与打开方式

片架首页提供：**打开存档、新建视频、最近打开、内置实样**。没有打开文档时不进入空白工作台；工作台不重复提供样例和项目弹窗。片架与 Studio 外壳使用大编号、衬线标题、克制分隔和文字动作，场景、舞台、时间轴与导出行为保持不变；窄容器收起次级文件与编辑动作，不把顶栏挤成多行。

1. 打开首页：`open /skills/cloud/{skill_id}`（HTTP API 与资源用返回的 `url_prefix`）。
2. 打开已有文件：首页选择器，或在平台文件管理器点击 `.video_studio`；AI 用平台 `open /fs/.../demo.video_studio`，由 manifest opener 进入 Studio。opener 复用已打开的 Studio 窗口时调用其 pageDesc `open` 指令。
3. 新建：通过 `$fs.pickSavePath` 选择任意 `/fs` 位置；AI 直接调用 `new_video --path ...`，不要先对尚不存在的目标调用 `open`。
4. 最近记录只是路径历史；移除/清空不会删除文件。文件移动后用「打开存档」选择新位置。
5. 样例只读，可「另存为」正式 `.video_studio` 后编辑。

## 存档与资源

默认新建位置为 `/fs/page/.video/`，也支持 `/fs/cloud/...` 和 `/fs/{host_id}/...`。编辑器只保存当前主文件路径，不关心真实存储端。

`/fs/page` 是当前浏览器的 OPFS 本地存储：不同浏览器之间不共享，切换浏览器后看不到另一个浏览器中的项目。需要跨浏览器继续制作时，使用 `/fs/cloud`，或显式迁移整个项目目录；不要把另一个浏览器里缺少文件误判为新建删除了文件。

```text
/fs/page/.video/demo/
├── demo.video_studio       # format = video_studio/1
├── assets/                 # 图片、音频、视频、字体等
├── scenes/scene_1.json     # 可选的场景拆分
├── brief.md                # 简报/分镜表
└── beats.json              # 可选的节拍分析产物
```

- 所有依赖使用相对于主文件目录的路径，如 `assets/cover.png`；禁止绝对路径、`..`、外部 URL 和大体积 base64。
- 素材面板可上传/拖拽插入；TTS 与节拍分析也写入当前存档目录。
- 另存为会复制素材和附属文件，相对引用不变；跨端复制使用 `$fs.transfer`。
- 迁移单位是**整个项目目录**。从 A 设备复制到 B 设备后，直接打开新位置的 `.video_studio`，无需修改 JSON。
- 文件删除、移动和目录管理交给平台文件管理器，工作台不提供项目删除功能。
- 导出由用户点顶部「导出」；渲染完成后直接触发浏览器下载 MP4/WebM/WAV，不写 `$fs`，也不需要选择保存位置。

## 打开与操控

1. 打开页面后，从 `events` 查看 `*_video`、`open`、`save_video`、`save_as_video`、`gen_voice`、`analyze_music`、`run_js`。
2. 页面指令走 `exec _host=page {win_id}.<cmd>`，路径参数使用 `/fs/...`。
3. AI 可用对应端的 fs 工具直接修改主存档、场景和素材；写完调用 `reload_video`。
4. `shot_video` 返回截图的 `/fs` 路径，再按该路径所属端读取。

## 典型工作流

详见 `references/pipeline.md`。骨架：

1. **简报**：功能清单、素材盘点、视觉 tokens、数据口径 → 写 `brief.md`；共同创作模式在此与用户确认方向。
2. **分镜**：能量曲线 + 功能→镜头映射；有强节奏 BGM 先 `analyze_music`；分镜表给用户确认。
3. **实现**：直接 `new_video --path /fs/.../demo.video_studio` → 写主存档/场景 → `reload_video` → 每场景 `shot_video` 自检；新建前不要尝试 `open` 不存在的目标。
4. **声音**：逐场景生成旁白并写入对应 `scene.voice`；画面锁定后钉 SFX 表，人声优先混音。
5. **终检**：aesthetic-rules 逐条自检 + delegate 独立 subagent 终检。
6. **交付**：总结时长/场景/亮点，提醒用户点「导出」直接下载成品。

用户说「来个样例看看」：打开技能首页，直接点击内置样例；不要在工作台寻找样例弹窗。

## pageDesc 指令

指令仅在对应页面打开时响应。成功 `{ok:true,...}`，失败 `{ok:false,error}`。

| 指令 | 参数 | 说明 |
|---|---|---|
| `open` | `--path /fs/.../demo.video_studio` | 在 Studio 中打开存档并等待加载完成；平台 opener 复用 Studio 窗口时也走此指令。首页不提供打开指令 |
| `new_video` | `--path` 可选；`--title`/`--width`/`--height` 可选 | 新建并打开；省略路径时使用 `/fs/page/.video/{名称}/{名称}.video_studio` |
| `save_video` | — | 保存当前存档 |
| `save_as_video` | `--path /fs/.../copy.video_studio` | 另存为并复制素材与附属文件 |
| `reload_video` | — | 重新读取当前主存档、场景与素材 |
| `run_video` / `stop_video` | `run_video --path` 可选 | 预览播放 / 停止 |
| `shot_video` | `--frame`/`--name`/`--scale 0.25~2` | 截帧到当前存档 `screenshots/`，返回 `/fs` 路径；截关键帧而非未显现的入场起点 |
| `gen_voice` | `--text` 必填，`--name`/`--set voice\|music` 可选 | TTS 写入当前 `assets/`；voice 配置到当前场景，music 配置为全片音乐 |
| `analyze_music` | `--src assets/bgm.mp3` 必填，`--name` 可选 | 相对当前存档读取音频，输出 BPM/拍点/onsets 到 `beats.json` |
| `run_js` | `--code` | 软沙箱数值计算：M 数学包 + T three 数学几何 |
| `get_video` | — | 当前存档路径、只读状态、时长、场景等信息 |
| 首页 `list_video` | — | 最近记录 + 样例清单，不扫描文件系统 |

## 制作纪律（摘要，全文见 aesthetic-rules.md）

1. **先读后改**：改前读取当前存档；不确定路径时看首页最近记录或询问用户，不按项目名猜路径。
2. **镜头卡先读全文再写**：配方是调校过的起点，「已知坑」参数不得降档。
3. **节奏宁慢勿快**：关键信息落定 hold ≥1s、批量入场加速 + 收尾 0.5s 静止、开场动作弧 ≥3s。
4. **运镜克制**：急推全片 ≤2 次；全画面级冲击 ≤3 处；信息密集镜头正视。
5. **光效不群发**：sheen 每镜头最多主角一次；批量入场靠运动本身。
6. **文字有效字高**：字幕 ≥5% 帧高、辅助 ≥3%（按 fontSize×scale×zoom 后的最终像素）。
7. **素材**：只用存档内相对路径；外部素材先下载并导入，不引用外链。
8. **声音后做**：画面锁定后钉 SFX；改时长/顺序 → SFX 全表重钉。
9. **写完即所见**：写文件后 `reload_video`；每幕截入场/动作/hold 三帧实际查看，首检不交给用户。
10. **坐标合理**：基于 size 布局不越界；文字框给足高度（fontSize 64 标题至少 h=100）。

## 常见问题

- 指令超时/无响应：确认首页或工作台已打开，再重试。
- 最近记录路径失效：文件可能已移动；用「打开存档」选择新位置，旧记录可安全移除。
- 缺素材：工作台会列出缺失的相对路径；迁移时应复制整个项目目录。
- 导出需最新版 Chrome/Edge（WebCodecs）；支持 4K UHD，4K 导出耗时与内存占用较高，建议单片 ≤60s。
- 浏览器预览配乐优先使用 MP3；若只有音乐配置却听不到声音，先检查素材是否实际加载，再转成 MP3 复验。
- 视频剪辑：时间轴绿色块左缘切入/右缘切出/块体拖开始；media 的 trimStart/trimEnd 是源裁剪。
- 运镜编辑：inspector 场景页「运镜 Camera」；SFX 在 inspector 项目页与时间轴黄色条编辑。
