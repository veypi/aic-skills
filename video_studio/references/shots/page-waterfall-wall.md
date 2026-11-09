---
name: page-waterfall-wall
一句话: 页面截图切 3 列差速反向无限滚动，视差 + 缓推做"内容多到流不完"的一览
适用: "多页面/多功能/多模板"体量感段落；montage 铺陈
时长: 4–6s（无限循环体，按时长裁）
能量: 中（流动陈列型）
依赖: kfLoop, camera
---

## 意图
流动式一览：几秒内"看到很多页面流过"，读感是体量而非细节。与 outro-group-photo-launch 分工：那是聚拢式（属于同一产品），本卡是流动式（多到流不完）。

## video_studio/1 配方

```jsonc
// 每列 = 一张长截图（3-4 屏高），kfLoop 垂直滚动；相邻列反向 + 差速
{ "id": "col-0", "type": "image", "src": "assets/pages-col0.png",
  "x": 100, "y": 0, "w": 340, "h": 2160, "fit": "cover",
  "keyframes": [ { "t": 0, "y": 0 }, { "t": 6, "y": -1440 } ], "kfLoop": true }
{ "id": "col-1", "type": "image", "src": "assets/pages-col1.png",
  "x": 470, "y": -1440, "w": 340, "h": 2160,
  "keyframes": [ { "t": 0, "y": -1440 }, { "t": 7.5, "y": 0 } ], "kfLoop": true }  // 反向+慢速
{ "id": "col-2", "type": "image", "src": "assets/pages-col2.png",
  "x": 840, "y": 0, "w": 340, "h": 2160,
  "keyframes": [ { "t": 0, "y": 0 }, { "t": 5, "y": -1440 } ], "kfLoop": true }
"camera": { "keyframes": [ { "t": 0, "zoom": 1.08 }, { "t": 5, "zoom": 1, "easing": "easeInOut" } ] }
```

## 已知坑
- 截图截真实页面（Q1），每列内容不同；列宽按 size 三等分留缝
- kfLoop 循环接缝：滚动距离 = 截图内容周期高度，否则跳帧
- 差速（5/6/7.5s 周期）才有视差；同速读作一张图在动
- 此镜观众不读字（纹理态 Q11），别配解说字幕抢注意力