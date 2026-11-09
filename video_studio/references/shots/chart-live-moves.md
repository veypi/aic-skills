---
name: chart-live-moves
一句话: 图表当剧情——柱图从底生长、折线描边写入、数字滚动落定，真轴标真数据
适用: 数据叙事段落；增长/实时性/规模感的揭晓
时长: 4–5s（生长 1.5s + 读数 1s + hold ≥1.5s）
能量: 中高（数据即剧情）
依赖: chart, scaleY+origin, countUp, draw
---

## 意图
图表不是插图是剧情。共同前提（实测判例）：**必须真图表语境**——真轴标/真数据/真文案，灰阶占位条测不出数据叙事的表达力。

## video_studio/1 配方

```jsonc
// 柱图生长：scaleY 0→1 + origin bottom，逐柱错峰
{ "id": "bar-0", "type": "shape", "shape": "rect", "x": 240, "y": 260, "w": 70, "h": 280,
  "fill": "#3a6ff7", "radius": 6, "origin": "bottom",
  "keyframes": [ { "t": 0.3, "scaleY": 0 }, { "t": 1.1, "scaleY": 1, "easing": "bezier(0.16,1,0.3,1)" } ] }
// bar-1 delay +0.15s、高度按数据比例；轴标/网格线先入场（fx fade delay 0）
// 折线写入：chart option.draw
{ "id": "trend", "type": "chart", "x": 200, "y": 180, "w": 880, "h": 380,
  "option": { "draw": 1.6, "xAxis": { "data": ["Q1","Q2","Q3","Q4"] },
              "series": [ { "type": "line", "data": [120, 200, 340, 580] } ], "color": ["#3a6ff7"] } }
// 大数字揭晓：countUp + 落定脉冲
{ "id": "kpi", "type": "text", "x": 440, "y": 100, "w": 400, "h": 80,
  "html": "+380%", "fontSize": 60, "fontWeight": 800, "color": "#fff", "align": "center",
  "fx": { "countUp": true, "countUpDur": 1.4, "delay": 0.5 } }
```

## 已知坑
- origin:"bottom" 漏写 → 柱图从中心缩放，生长语义全错
- 数字滚动落定后 hold ≥1s（R1）；SFX sparkle 钉落定帧
- 数据要"装得下"：最大值柱高 ≤ 图表区 85%，轴标留白