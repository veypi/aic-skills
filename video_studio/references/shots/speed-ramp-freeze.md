---
name: speed-ramp-freeze
一句话: 流动中干脆停下来——定格圈注重点再走，速度反差本身即节奏
适用: 卡片流/长横移中把一个重点"停下给人看"；教学解说
时长: 5s 级（流动 1.5s + 定格 ≥1.5s + 解冻 1s）
能量: 中高（速度反差即 energy beat）
依赖: keyframes 缓动分段, svg 圈注
---

## 意图
匀速流读作 PPT（R2），全程快流观众抓不住重点（R3）。定格标注在一条运动里干脆停下来——马克笔圈出重点再走。语义是"停课划重点"。

## video_studio/1 配方

```jsonc
// 横移卡片流：快 → 急刹停（定格）→ 缓起。关键帧斜率即速率
{ "id": "strip", "type": "image", "src": "assets/cards-strip.png", "x": 0, "y": 260, "w": 2400, "h": 200,
  "keyframes": [
    { "t": 0, "x": 0 },
    { "t": 1.2, "x": -700, "easing": "linear" },          // 匀速流
    { "t": 1.5, "x": -820, "easing": "easeOut" },         // 急刹（0.3s 减速段）
    { "t": 3.2, "x": -820 },                              // 定格 1.7s（≥45f）
    { "t": 4.5, "x": -1400, "easing": "easeIn" }          // 解冻加速走
  ] }
// 定格段圈注：svg 手绘椭圆 draw 描边（delay 1.6，dur 0.4）+ 注记文字 reveal
{ "id": "circle", "type": "svg", "x": 500, "y": 240, "w": 300, "h": 240,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 240'><path d='M150 12 C260 8 292 70 288 120 C284 190 210 232 140 228 C60 224 8 180 12 110 C16 50 80 16 150 12' fill='none' stroke='#ffd84d' stroke-width='5' stroke-linecap='round'/></svg>",
  "draw": { "dur": 0.4, "delay": 1.6, "easing": "easeOut" } }
```

## 已知坑
- 定格段 ≥1.5s：观众要读完圈注（R3）；急刹段 0.2–0.3s，慢了读作普通减速
- 圈注坐标按定格后的画面位置算（strip x=-820 时目标卡的屏幕坐标）
- 解冻用 easeIn 重新加速，别直接跳回匀速