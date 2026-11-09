---
name: marker-underline-title
一句话: 标题落定后，关键词下方马克笔下划线一笔快速描画
适用: 标题强调单个关键词（new/free/AI…）；手写感人味调性
时长: 标题落定 +0.15s 起笔，划线 0.3–0.4s，总 1–1.5s
能量: 低（一笔点睛，不抢标题的戏）
依赖: svg draw
---

## 意图
打印体标题里突然出现一笔手绘马克笔，用材质反差把一个词从排版里拎出来——像人拿笔在海报上圈重点。命门：**快**（一笔呵成，慢了读作加载条）、**近**（贴着字底）。

## video_studio/1 配方

```jsonc
// 标题（关键词也可用 span highlight 替代下划线，二选一）
{ "id": "title", "type": "text", "x": 200, "y": 280, "w": 880, "h": 90,
  "html": "Research, on autopilot", "fontSize": 56, "fontWeight": 700, "color": "#fff",
  "fx": { "enter": "fade-up", "enterDur": 0.6 } },
// 下划线：粗笔形 path，draw 描边生长（关键词 autopilot 下方）
{ "id": "underline", "type": "svg", "x": 690, "y": 352, "w": 300, "h": 18,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 18'><path d='M4 12 C 60 6, 140 16, 296 9' fill='none' stroke='#ffd84d' stroke-width='7' stroke-linecap='round'/></svg>",
  "draw": { "dur": 0.35, "delay": 0.8, "easing": "bezier(0.65,0,0.35,1)" } }
```

## 已知坑
- 起笔时机 = 标题入场完成 +0.1~0.2s（delay 按标题 enterDur+delay 算）
- 划线 0.3–0.4s（8–12f）：>0.6s 读作加载条
- 线贴字底（字底下方 4–8px），宽 ≈ 关键词宽；stroke-linecap round + 微弧线才有手绘感
- 一词一笔，全片 ≤2 处；与 span highlight 不同时用在同一词上