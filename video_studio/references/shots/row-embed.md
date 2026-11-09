---
name: row-embed
一句话: 内容行从空中降下嵌入页面布局，嵌入瞬间底边亮一道强调色缝
适用: "结构化数据长进页面"的详情页/列表镜头；行级批量入场
时长: 约 2s（行间隔 0.12s，每行 0.5s）
能量: 中
依赖: keyframes, shape(缝光)
---

## 意图
行不是"显示出来"而是"长进去"——严丝合缝嵌入布局，嵌入瞬间的强调色缝是"咔哒"扣上的视觉拟音。

## video_studio/1 配方

```jsonc
// 每行 = 行本体 + 底边缝光（两个元素同 delay）
{ "id": "row-0", "type": "shape", "shape": "rect", "x": 340, "y": 180, "w": 600, "h": 56,
  "fill": "#1a2130", "radius": 8,
  "keyframes": [
    { "t": 0.2, "y": 120, "opacity": 0, "scale": 1.03 },
    { "t": 0.7, "y": 180, "opacity": 1, "scale": 1, "easing": "bezier(0.16,1,0.3,1)" }
  ] },
{ "id": "seam-0", "type": "shape", "shape": "rect", "x": 348, "y": 234, "w": 584, "h": 3,
  "fill": "#3a6ff7", "radius": 2,
  "keyframes": [
    { "t": 0.62, "opacity": 0 }, { "t": 0.7, "opacity": 0.9 },
    { "t": 1.1, "opacity": 0, "easing": "easeOut" }          // 缝光亮起即衰
  ] }
// row-1 delay +0.12s，y 终点 +64px；依此类推
```

## 已知坑
- 行终点 y = 上一行 y + 行高 + 间距，严丝合缝不重叠（Q9）
- 缝光只在嵌入瞬间亮 0.4s 即衰——常亮读作分割线不是拟音
- 行内文字随行一起动（文字元素同 keyframes 或同行 group 坐标），别文字先到位行后到
- SFX：每行轻 pop/click，音量阶梯递减（S2）