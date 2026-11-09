---
name: spotlight-hero-card
一句话: 暗场里相机慢推锁定一张主角卡，卡弹起悬浮、单点扫光检视、落回原位 hold
适用: "单一主角"式产品开场；把一个核心对象立成全片主角
时长: 5–6s（锁定 1s → 悬浮 2.5s → 归位 0.7s → hold ≥1s）
能量: 中（质感最高的一镜，慢而稳）
依赖: camera, sheen
---

## 意图
开场只讲一件事：这张卡就是产品的原子单位。推近替观众做视线引导，悬浮给它重量，扫光是"检视"隐喻，落回原位表示它属于这个页面。

## video_studio/1 配方

```jsonc
{
  "id": "s-open", "duration": 5.5, "transition": "none", "background": "#0b0e14",
  "camera": { "keyframes": [
    { "t": 0, "zoom": 1 },
    { "t": 1, "zoom": 1.35, "focus": [640, 360], "easing": "easeInOut" },
    { "t": 4.2, "zoom": 1.42, "focus": [640, 360], "easing": "linear" },  // 悬浮期极缓 creep
    { "t": 5.5, "zoom": 1.42, "focus": [640, 360] }
  ] },
  "elements": [
    { "id": "hero", "type": "image", "src": "assets/hero-card.png",
      "x": 440, "y": 240, "w": 400, "h": 240, "radius": 16,
      "fx": { "enter": "fade", "enterDur": 0.6 },
      "sheen": { "t": 2.2, "dur": 1.0, "color": "rgba(255,220,150,0.28)" },
      "keyframes": [
        { "t": 1.0, "y": 240, "scale": 1 },
        { "t": 1.8, "y": 216, "scale": 1.04, "easing": "spring(11,120,1)" },  // 弹起悬浮
        { "t": 3.6, "y": 216, "scale": 1.04 },                                // 悬浮 hold
        { "t": 4.3, "y": 240, "scale": 1, "easing": "easeInOut" }             // 归位
      ] },
    { "id": "amb", "type": "shape", "shape": "ellipse", "x": 340, "y": 140, "w": 600, "h": 440,
      "fill": "rgba(255,200,120,0.05)", "blur": 60, "z": -1 }                 // 聚光氛围底
  ]
}
```

## 参数手感
| 参数 | 典型值 | 调节 |
|---|---|---|
| 推近 zoom | 1.3–1.5 | >1.8 读作急推，冲击感串味 |
| 悬浮幅度 | 20–30px + scale 1.04 | 过大读作飘 |
| 扫光 | 悬浮中段一次 | 给主角，不群发（Q4） |

## 已知坑
- 归位后必须 hold ≥1s（R1）：duration 减去动作段剩余 ≥1s
- 主角素材按推近后显示尺寸 2x 准备（Q2），否则特写糊字
- 开场只有这一个主角（Q5），别加第二组入场元素抢戏