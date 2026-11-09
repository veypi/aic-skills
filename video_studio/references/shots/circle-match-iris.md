---
name: circle-match-iris
一句话: 光圈从前景圆形元素的圆心炸开，圈内新场景的圆形主体接在同一圆上
适用: 前景有圆形元素（头像/图标）、后景有圆形主体（donut 图）的接缝
时长: 场景转场 0.6–0.8s + 新场景定睛
能量: 中高
依赖: transition iris, 布局匹配
---

## 意图
普通 iris 从任意点开圈只读到"换页了"。匹配剪辑给光圈语义锚点：从前景一个真实圆形元素的圆心炸开，新场景的圆形图表恰好接在同一个圆上。

## video_studio/1 配方

```jsonc
// 前场景末：圆形元素（如 donut 图标）居画面中心
{ "id": "icon", "type": "shape", "shape": "ellipse", "x": 580, "y": 300, "w": 120, "h": 120, "fill": "#3a6ff7" }
// 后场景：transition iris（引擎从中心缩放进入），圆形主体放画面中心同尺寸起步
{ "id": "s-next", "duration": 4, "transition": "iris", "transitionIn": 0.7,
  "elements": [
    { "id": "donut", "type": "chart", "x": 440, "y": 160, "w": 400, "h": 400,
      "option": { "series": [ { "type": "pie", "data": [62, 38] } ], "color": ["#3a6ff7", "#1a2130"] },
      "fx": { "enter": "zoom", "enterDur": 0.6 } }
  ] }
```

## 已知坑
- 引擎 iris 固定从画面中心开圈——前场景圆形元素必须移到/布局在中心（keyframes 归中）
- 前后两个圆同色同轴，观众才读到"同一个圆长大了"
- 转场 0.6–0.8s；新场景圆形主体入场后 hold 再展开内容