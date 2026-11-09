---
name: white-flash-logo-simplify-cut
一句话: 华丽字标静置流光，一记白闪过曝，曝光回落时同一位置已是扁平版字标——一次闪白完成质感降维
适用: 品牌段收束（华丽演绎→干净定妆）；情绪从炫技切到正式宣告
时长: 3–4s（演出 1s + 蓄力 0.4s + 冲白 0.3s + 回落 0.7s + hold ≥1s）
能量: 中高（一次脉冲重音，前后静场）
依赖: overlay 白闪, sheen, 同位替换
---

## 意图
先给足华丽（渐变字 + 一次扫光），再用白闪"净化"成扁平单色字标——"演出结束，这就是它的正式形象"。两版同字号同位置，读作同一个字标被净化，不是换了张图。

## video_studio/1 配方

```jsonc
// 华丽版（渐变 + sheen）与扁平版（纯白）同坐标，白闪峰值帧交棒
{ "id": "logo-fancy", "type": "text", "x": 340, "y": 300, "w": 600, "h": 100,
  "html": "BRAND", "fontSize": 80, "fontWeight": 800, "align": "center",
  "colorGradient": { "angle": 90, "stops": [ {"pos":0,"color":"#7b5cff"}, {"pos":1,"color":"#ff5c8a"} ] },
  "sheen": { "t": 0.4, "dur": 0.8 },
  "keyframes": [ { "t": 1.4, "opacity": 1 }, { "t": 1.5, "opacity": 0 } ] },   // 冲白峰值隐
{ "id": "logo-flat", "type": "text", "x": 340, "y": 300, "w": 600, "h": 100,
  "html": "BRAND", "fontSize": 80, "fontWeight": 800, "align": "center", "color": "#ffffff",
  "keyframes": [ { "t": 1.4, "opacity": 0 }, { "t": 1.5, "opacity": 1 } ] }    // 白闪掩护下接管
// overlay 白闪：t 1.35→1.5 opacity 0→1→0（0.3s 三角脉冲），盖住交棒
```

## 已知坑
- 两版必须同字号同字距同坐标（逐字段对齐），差一点读作换图
- 白闪计入全画面冲击名额（R4）；全片一次
- 扁平版落定后 hold ≥1s（R1 品牌记忆点）；SFX：蓄力 riser + 冲白 impact + 余韵 sparkle