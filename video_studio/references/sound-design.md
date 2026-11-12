# 声音设计

画面锁定后做声音（S3）。三条轨：music（BGM 垫底）、voice（TTS 解说）、sfx（钉帧音效表）+ 未静音 media 元素原声。

## 1. 词汇表（S1）

| 类别 | 用途 | 典型素材名 |
|---|---|---|
| whoosh | 运镜/飞入/转场 | whoosh-short / whoosh-deep |
| impact | 落位/撞停/重音 | impact-soft / impact-deep |
| riser | 铺垫→揭晓 | riser-2s |
| sparkle | 光效/数字落定 | sparkle / chime |
| 拟音 | 画面真实动作 | keyboard / click-camera / paper / pop |

禁游戏音包音色（合成 bloop/卡通弹跳/提示音阶）；**禁音色不禁动作**——画面有点击/打字就配真实物件拟音。判别：像真实世界那个物件的声音，还是游戏引擎反馈音？

## 2. 素材来源

- 用户指定的音乐/音效始终优先
- 免费来源：Freesound（CC0 优先，下载时复核许可）、Mixkit、Pixabay——把链接给用户下载后上传素材 tab（AI 不能代下外部素材）
- BGM 选强鼓点强节奏的电子底（tech-house 类）；候选曲必须垫进成片试听，单听曲子判断不了气质
- TTS 解说走 `gen_voice`（按文本 hash 缓存，限流约 3s/个）

## 3. 钉帧表（S2）

```jsonc
"sfx": [
  { "src": "assets/riser-2s.mp3",  "t": 0.2,  "volume": 0.35, "dur": 1.9, "note": "S1 开场蓄势→主角揭晓" },
  { "src": "assets/whoosh.mp3",    "t": 1.05, "volume": 0.45, "dur": 0.35,"note": "S1 相机急推" },
  { "src": "assets/impact.mp3",    "t": 1.12, "volume": 0.6,  "note": "S1 撞停震屏（全片冲击 1/3）" },
  { "src": "assets/sparkle.mp3",   "t": 1.5,  "volume": 0.3,  "note": "S1 主角扫光" }
]
```

- 每条 note 注释对应画面动作；t 用 beats/onsets 或关键帧时间点，不凭感觉
- 句式：riser → impact → sparkle（铺垫→落地→余韵）
- 连发防机枪三招：双样本交替（pop-a/pop-b）、音量阶梯递减（0.40→0.25）、间隔跟随动画加速
- 拟音裁到与动作严格等长（dur/srcOffset）；impact 保留自然尾音不截

## 4. 混音基准

- BGM volume 0.2–0.35（有人声解说时 0.15–0.25）；voice 1.0；SFX 0.3–0.6
- 轻音素材（峰值低）volume 可 >1，以成片听感为准
- 峰值重叠：同一帧多条 impact 会爆音——错开 ≥0.05s 或降音量

## 5. 卡拍片（有强节奏 BGM）

1. 先 `win(id).analyze_music({src: 'assets/bgm.mp3'})` → 读 beats.json
2. confidence ≥0.3 才按网格分镜；否则人工核对或放弃卡拍
3. 切点/动效触发 t 写 beats/onsets 的真实秒数（减场景起点换算场景内时间）；稀疏重音钉 onsets 不钉网格插值点
4. **卡拍管时机不放大幅度**（R4）：全画面/相机层冲击全片 ≤3 处、钉最强 onsets、间隔 ≥16 拍；其余拍点只动元素层
5. 交付可选两版：带 BGM 版 + 无 BGM 版（保留 SFX）——复制项目改 music 即可，方便用户后期自配音乐

## 6. 对齐检查（S5）

- scene.voice.offset：本幕内旁白起点；每幕 gen_voice 返回独立 duration，按本幕时长校验
- 素材峰值不在文件头（听感"慢半拍"）：用 srcOffset 跳过前导静音
- 改过任何场景时长/顺序：sfx 全表 t 逐条重对（S3）

## 7. 讲解音频（voice）

旁白是叙事轨，不是音乐/音效的替代品。只要画面需要观众理解“为什么”，就在简报阶段决定是否有旁白、语气和称呼，并把每幕旁白句写进分镜表。

1. **逐场景写稿**：一幕只生成与本幕动画对应的一段话，一句只讲一件事；用句读写出停顿。禁止先生成全局长语音，再让各场景被动迁就它。
2. **逐场景生成**：把播放头置于目标场景，`win(id).gen_voice({text: '本幕讲解', name: 'voice-s1', set: 'voice'})`，自动写入该 scene.voice。每幕独立文件、独立试听；产品名、数字、单位发音不对就只重写本幕。
3. **逐场景对齐**：`scene.voice.offset` 是场景内秒数；必须满足 `duration + offset ≤ scene.duration`。超出时精修本幕稿，或只延长本幕 hold/调整本幕动画，并重钉后续 SFX；禁止裁尾句或明显加速。
4. **人声优先混音**：voice 通常 1.0；有人声时 BGM 降到 0.15–0.20；SFX 通常 0.25–0.45，强 impact 尽量落在句子间隙，不压关键字。
5. **分幕 + 整片双重审听**：本幕检查文画对应与尾句完整，整片检查语气连贯、换幕不抢、品牌名一致；只确认音频存在不算验收。

内置 `Lumen · 从想法到成片` 使用 `voice-s1.mp3`…`voice-s7.mp3` 七段独立旁白，每幕分别配置 offset；全片 39.5s，BGM 0.18。