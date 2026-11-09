---
name: outro-group-photo-launch
一句话: 全片元素从四面八方飞来围住字标合影，相机落机位 + 舞台光，发布会收场
适用: 多功能产品的全家福终镜
时长: 4.5–5s（飞入 1.8s + 字标 0.8s + hold ≥1.5s）
能量: 峰值（全片最高点）
依赖: keyframes 多方向, camera, reveal
---

## 意图
把看过的每个功能各抽一个代表元素叫回来合影，字标压轴——观众离场前最后记住"这些东西属于同一个产品"。规格必须发布会级：初版收尾几乎总是偏保守，默认加码一档（Q8）。

## video_studio/1 配方

```jsonc
{
  "id": "s-outro", "duration": 5, "transition": "fade", "background": "#0b0e14",
  "camera": { "keyframes": [
    { "t": 0, "zoom": 1.25 },
    { "t": 2.2, "zoom": 1, "easing": "easeInOut" },        // crane 落机位
    { "t": 5, "zoom": 1 }
  ] },
  "elements": [
    // 舞台光底（椭圆柔光）
    { "id": "stage", "type": "shape", "shape": "ellipse", "x": 240, "y": 420, "w": 800, "h": 260,
      "fill": "rgba(123,92,255,0.12)", "blur": 50, "z": -1 },
    // 代表元素 ×N：从屏幕外多方向飞入字标周围槽位（每功能一个）
    { "id": "rep-0", "type": "image", "src": "assets/feat-dashboard.png", "x": 200, "y": 200, "w": 180, "h": 110, "radius": 10,
      "keyframes": [
        { "t": 0.2, "x": -220, "y": 80, "opacity": 0, "rotation": -8 },
        { "t": 1.0, "x": 200, "y": 200, "opacity": 1, "rotation": 0, "easing": "bezier(0.16,1,0.3,1)" }
      ] }
    // rep-1 从右（x:1500）delay 0.35 / rep-2 从上（y:-160）delay 0.5 / rep-3 从下 delay 0.65 …
    // 字标压轴：遮罩揭示
    { "id": "wordmark", "type": "text", "x": 390, "y": 300, "w": 500, "h": 100,
      "html": "Product", "fontSize": 72, "fontWeight": 800, "color": "#fff", "align": "center",
      "reveal": { "dur": 0.7, "delay": 1.6, "dir": "up" } },
    { "id": "tagline", "type": "text", "x": 340, "y": 410, "w": 600, "h": 50,
      "html": "一句具体收益标语", "fontSize": 28, "color": "rgba(255,255,255,0.7)", "align": "center",
      "fx": { "enter": "fade-up", "enterDur": 0.6, "delay": 2.3 } }
  ]
}
```

## 已知坑
- 每个已展示功能都要有代表元素（P4 功能清单对照）；漏一个 = 返工
- 飞入方向 ≥4 个、错峰 0.15s；终点围住字标不遮挡（Q9 槽位）
- 字标 hold ≥1s、标语达 Q11 字高线；能量不够就加粒子（shape 小圆 kfLoop 漂移）
- SFX：多方向 whoosh 错峰 + 字标落定 impact + sparkle 收尾（全片最强一组）