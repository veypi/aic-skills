---
name: draw-svg-trace
一句话: 一条墨线沿元素轮廓跑一圈把它"画"出来，闭合后内容淡入
适用: 单个卡片/图表/标题的被点名入场；纸墨审美
时长: 3–4s（描边 1.3s + 交棒 0.5s + hold ≥1s）
能量: 中
依赖: svg draw
---

## 意图
元素不是飞进来也不是淡进来，而是被一支看不见的笔当场描出来。描边是"预告"，内容淡入是"交棒"。

## video_studio/1 配方

```jsonc
// 轮廓描边（rect 圆角轮廓 path）+ 内容本体延迟淡入
{ "id": "trace", "type": "svg", "x": 430, "y": 230, "w": 420, "h": 260,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 420 260'><path d='M20 2 H400 Q418 2 418 20 V240 Q418 258 400 258 H20 Q2 258 2 240 V20 Q2 2 20 2 Z' fill='none' stroke='#ffd84d' stroke-width='3'/></svg>",
  "draw": { "dur": 1.3, "delay": 0.2, "easing": "bezier(0.65,0,0.35,1)" },
  "keyframes": [ { "t": 1.5, "opacity": 1 }, { "t": 1.9, "opacity": 0 } ] },  // 描完交棒即隐
{ "id": "card", "type": "image", "src": "assets/hero.png", "x": 440, "y": 240, "w": 400, "h": 240, "radius": 16,
  "fx": { "enter": "fade", "enterDur": 0.4, "delay": 1.5 } }                  // 闭合瞬间内容接管
```

## 已知坑
- 描边路径与内容轮廓对齐（坐标差 ≤10px），否则"画出来的"和"长出来的"不是同一个
- 交棒重叠 0.2–0.3s：描边未隐内容先入，无缝；断档读作两个动画
- 一镜一次；下划线变体见 marker-underline-title