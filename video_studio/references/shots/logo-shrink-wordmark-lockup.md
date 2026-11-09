---
name: logo-shrink-wordmark-lockup
一句话: 满屏图形能量收束成小图标，图标左移让位，字标逐字滑入完成 lockup，标语押尾
适用: 片尾品牌定妆：从演出态到标准态
时长: 4–4.5s（收束 1s + 让位 0.6s + 字标 0.7s + 标语 0.5s + hold ≥1s）
能量: 中（收束段有冲击力，整体沉稳落定）
依赖: keyframes scale, stagger
---

## 意图
片尾的"盖章"：满屏图形携能量坍缩成一枚小图标（演出态→标准态），然后按品牌 lockup 规范一步步落位——图标让位、字标进场、标语押尾。品牌从动态里"站定"。

## video_studio/1 配方

```jsonc
// 大环收束成图标
{ "id": "ring", "type": "shape", "shape": "ellipse", "x": 340, "y": 60, "w": 600, "h": 600,
  "fill": "transparent", "stroke": "#7b5cff", "strokeWidth": 14,
  "keyframes": [
    { "t": 0.1, "scale": 1, "opacity": 1 },
    { "t": 1.1, "scale": 0.16, "opacity": 1, "easing": "easeIn" },     // 加速坍缩
    { "t": 1.25, "scale": 0.14, "easing": "easeOut" },                 // 过冲刹车
    { "t": 1.5, "x": 440, "y": 310, "scale": 0.14, "easing": "easeInOut" } // 让位到 lockup 左端
  ] }
// 字标逐字滑入（图标右侧）
{ "id": "wordmark", "type": "text", "x": 560, "y": 310, "w": 420, "h": 80,
  "html": "product", "fontSize": 56, "fontWeight": 700, "color": "#fff",
  "stagger": { "by": "char", "step": 0.05, "delay": 1.8, "dur": 0.5, "dx": 26, "dy": 0, "easing": "bezier(0.16,1,0.3,1)" } }
// 标语押尾
{ "id": "tagline", "type": "text", "x": 560, "y": 390, "w": 420, "h": 40,
  "html": "具体收益标语", "fontSize": 24, "color": "#7b5cff",
  "fx": { "enter": "fade-up", "enterDur": 0.5, "delay": 2.8 } }
```

## 已知坑
- 收束 easeIn 加速 + 过冲刹车（scale 终点回 2–4%），匀速缩小读作泄气
- lockup 间距按品牌规范：图标-字标 1 个字高、标语在字标基线下 0.5 字高
- 最终 lockup hold ≥1s（R1）；这是全片最后一帧的印象
- 与 outro-group-photo-launch 二选一做终镜（P4），别两个收尾叠用