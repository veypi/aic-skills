---
name: gradient-word-sweep
一句话: 黑底标语里关键词被渐变彩光快速扫过"充能"，填满后稳态泛光
适用: 标语里给单个动词/卖点词充能；能量高潮段的文字戏
时长: 扫充 0.5–0.7s（要快）+ 稳态 1.5–2s
能量: 高（一词爆点，前后都该让位）
依赖: colorGradient, sheen
---

## 意图
整句白字里只有关键词被"通电"：渐变彩光从左到右扫过字符像能量注入。一词爆点，前后镜头让位。

## video_studio/1 配方

```jsonc
// 整句白字 + 关键词独立元素（渐变填充 + 扫光）
{ "id": "line-a", "type": "text", "x": 180, "y": 320, "w": 430, "h": 90,
  "html": "Make it", "fontSize": 64, "fontWeight": 800, "color": "#fff",
  "align": "right", "fx": { "enter": "fade", "enterDur": 0.4 } },
{ "id": "word", "type": "text", "x": 630, "y": 320, "w": 470, "h": 90,
  "html": "supercharged", "fontSize": 64, "fontWeight": 800,
  "colorGradient": { "angle": 90, "stops": [ { "pos": 0, "color": "#7b5cff" }, { "pos": 0.5, "color": "#ff5c8a" }, { "pos": 1, "color": "#ffb65c" } ] },
  "fx": { "enter": "fade", "enterDur": 0.3, "delay": 0.2 },
  "sheen": { "t": 0.5, "dur": 0.6, "color": "rgba(255,255,255,0.5)", "width": 0.3 },
  "keyframes": [
    { "t": 0.5, "scale": 1 },
    { "t": 0.75, "scale": 1.06, "easing": "easeOut" },   // 充能脉冲
    { "t": 1.1, "scale": 1, "easing": "easeInOut" }
  ] }
```

## 已知坑
- 扫充 0.5–0.7s 要快；慢了读作加载进度
- 只有关键词渐变，整句渐变读作廉价（C3）；sheen 一次不群发（Q4）
- 黑底才成立：背景 #0b0e14 级暗场，亮底上彩光看不见
- SFX：sparkle 钉扫充完成帧；计入全片冲击名额时注意这是元素层不算（R4）