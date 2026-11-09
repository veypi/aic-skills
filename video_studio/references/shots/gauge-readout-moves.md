---
name: gauge-readout-moves
一句话: 仪表仪式——指针/进度先甩满量程自检，再弹簧回落定格真值，盘下数字弹出
适用: dashboard 开场仪式/性能指标揭晓；开机感
时长: 4–5s（满弧 0.8s + 回落 0.7s + 读数 + hold）
能量: 中高（机械仪式型）
依赖: svg draw, rotation keyframes, countUp
---

## 意图
把"报数值"做成仪表的身体动作：汽车点火自检——先甩满全弧宣誓量程，再回落真值。先亮量程再报数。

## video_studio/1 配方

```jsonc
// 表盘弧：svg 圆环 path，draw 快速描满 → 回退到真值比例（dashoffset 关键帧不可用，
// 用两段 draw 近似：满弧描边 + 真值弧叠加）
{ "id": "gauge-bg", "type": "svg", "x": 480, "y": 180, "w": 320, "h": 320,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'><path d='M40 260 A150 150 0 1 1 280 260' fill='none' stroke='rgba(255,255,255,0.1)' stroke-width='18' stroke-linecap='round'/></svg>" },
{ "id": "gauge-sweep", "type": "svg", "x": 480, "y": 180, "w": 320, "h": 320,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'><path d='M40 260 A150 150 0 1 1 280 260' fill='none' stroke='#3a6ff7' stroke-width='18' stroke-linecap='round'/></svg>",
  "draw": { "dur": 0.8, "delay": 0.2, "easing": "easeIn" },
  "keyframes": [ { "t": 1.0, "opacity": 1 }, { "t": 1.4, "opacity": 0.25 } ] },   // 自检弧退为底
{ "id": "gauge-val", "type": "svg", "x": 480, "y": 180, "w": 320, "h": 320,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'><path d='M40 260 A150 150 0 0 1 250 60' fill='none' stroke='#4ecdc4' stroke-width='18' stroke-linecap='round'/></svg>",
  "draw": { "dur": 0.7, "delay": 1.1, "easing": "spring(11,130,1)" } },            // 回落真值（弧长按真值画）
{ "id": "readout", "type": "text", "x": 500, "y": 300, "w": 280, "h": 70,
  "html": "99.9%", "fontSize": 48, "fontWeight": 800, "color": "#fff", "align": "center",
  "fx": { "countUp": true, "countUpDur": 0.8, "delay": 1.5 } }
```

## 已知坑
- 真值弧的 path 终点按真值比例算（run_js 算圆弧坐标），不是满弧
- 多表盘错峰 0.2s 成波浪；落定同帧读数弹出
- 读数 hold ≥1s；SFX：whoosh 甩弧 + 轻 impact 落定