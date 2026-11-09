---
name: beat-cut-moves
一句话: 硬切当节拍乐器——三次白闪各硬切同一画面的一个裁切（全景→卡片→特写），停在特写收束
适用: 高光段落把"切"本身打成鼓点；关键信息的加冕
时长: 4–5s（活素材 1s + 三闪 0.6s + hold ≥2s）
能量: 高
依赖: overlay 白闪, camera focus, analyze_music
---

## 意图
多镜之间切点落拍：连闪定格给关键信息"加冕"。三次白闪是一个 set-piece，占一个全画面冲击名额（R4 按手法计数不按子事件）。

## video_studio/1 配方

```jsonc
// 单场景内用 camera 跳切三个景别 + overlay 白闪帧盖切点
"camera": { "keyframes": [
  { "t": 0, "zoom": 1 },
  { "t": 1.0, "zoom": 1 },
  { "t": 1.03, "zoom": 1.6, "focus": [640, 360], "easing": "linear" },   // 硬切景别2（0.03s≈1f）
  { "t": 1.43, "zoom": 1.6, "focus": [640, 360] },
  { "t": 1.46, "zoom": 2.4, "focus": [700, 320], "easing": "linear" },   // 硬切特写
  { "t": 4.5, "zoom": 2.4, "focus": [700, 320] }                          // 特写 hold
] }
// overlay 白闪：全片时间基准，每个切点一记 3f 白闪（opacity 0→0.9→0）
// overlay 元素：{type:shape, fill:#fff, 全屏, keyframes:[{t:切点-0.03,opacity:0},{t:切点,opacity:0.9},{t:切点+0.1,opacity:0}]}
```

## 已知坑
- 切点钉 beats.json 真实拍点（analyze_music）；三闪间隔 = 拍距，不凭感觉
- 景别跳切用 1f linear（不是缓动推近）；白闪盖切点藏跳变
- 全片只此一处连闪（R4 名额 + P4 手法去重）；SFX 快门/impact 三连钉闪帧
- 特写 hold ≥2s：加冕完要让观众看清