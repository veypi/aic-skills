---
name: impact-feedback
一句话: 命中反馈——落位帧顿一下 + 元素 scale 过冲 + 相机震屏，把"砸到了"传给观众
适用: 元素砸入/撞停的"命中一瞬"；寄生在落位动作上
时长: 元素级技法，0.3–0.5s
能量: 高（瞬时冲击）
依赖: camera shakes, keyframes
---

## 意图
元素砸到位却没有"砸到了"的一瞬，落位读作 PPT 飞入。命中的那几帧把时间咬住（顿帧），冲量才传到观众手上。

## video_studio/1 配方

```jsonc
// 元素：快速砸落 → 到位帧 scale 压扁过冲 → 回弹站定
{ "id": "card", "type": "image", "src": "assets/card.png", "x": 440, "y": 240, "w": 400, "h": 240,
  "keyframes": [
    { "t": 0.4, "y": -260, "scale": 1.05, "opacity": 0 },
    { "t": 0.45, "opacity": 1 },
    { "t": 0.75, "y": 240, "scale": 1, "easing": "easeIn" },        // 加速砸落
    { "t": 0.82, "y": 248, "scale": 1.06, "easing": "easeOut" },    // 顿帧压扁（8% 过冲）
    { "t": 1.0, "y": 240, "scale": 1, "easing": "spring(12,160,1)" }
  ] }
// 相机震屏钉到位帧（强度阶梯：轻落 amp 6 / 重砸 amp 12）
"camera": { "shakes": [ { "t": 0.75, "amp": 10, "decay": 0.05, "dur": 0.2 } ] }
// 重砸加冲击波环：shape ellipse 描边从落点外扩 + opacity 衰减（0.3s）
```

## 已知坑
- 顿帧 = 到位后 2–3 帧的压扁/停驻，不是真的停播；scale 过冲 6–10%
- 震屏计入全画面冲击 ≤3 处名额（R4）；轻落只给元素过冲不给相机震
- SFX impact 钉到位帧（不是起点）；音量按强度阶梯