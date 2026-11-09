---
name: document-typewriter-reveal
一句话: 暗场里的真排版文档在光标后逐字"写"出来，相机从特写后撤到全窗
适用: 文档/报告/笔记类功能镜头；信息密度最高的一拍
时长: 5s（写入 2.5s + 相机后撤 1.5s + hold 1s）
能量: 低中（节奏放稳让观众读字）
依赖: stagger(char), camera
---

## 意图
说服力全在"文档是真的"（Q10）：原生排版灌满真实密度的 mock 内容，打字机写入把静态页面变成"正在被写出来的文档"。

## video_studio/1 配方

```jsonc
{
  "id": "s-doc", "duration": 5, "transition": "fade", "background": "#0b0e14",
  "camera": { "keyframes": [
    { "t": 0, "zoom": 1.5, "focus": [640, 280] },                 // 标题区特写
    { "t": 2.5, "zoom": 1.5, "focus": [640, 280] },
    { "t": 4, "zoom": 1, "easing": "easeInOut" },                 // 后撤到全窗
    { "t": 5, "zoom": 1 }
  ] },
  "elements": [
    { "id": "win", "type": "shape", "shape": "rect", "x": 320, "y": 100, "w": 640, "h": 520,
      "fill": "#161b26", "radius": 12, "stroke": "rgba(255,255,255,0.08)", "strokeWidth": 1 },
    { "id": "doc-title", "type": "text", "x": 360, "y": 140, "w": 560, "h": 50,
      "html": "Weekly Research Report", "fontSize": 30, "fontWeight": 700, "color": "#f5f7fa",
      "stagger": { "by": "char", "step": 0.045, "delay": 0.3, "dur": 0.12, "dy": 0, "easing": "linear" } },
    { "id": "doc-body", "type": "text", "x": 360, "y": 210, "w": 560, "h": 360,
      "html": "本周共追踪 42 篇新论文……（真实密度 mock，铺满）", "fontSize": 19,
      "lineHeight": 1.7, "color": "rgba(245,247,250,0.85)",
      "stagger": { "by": "char", "step": 0.02, "delay": 1.2, "dur": 0.1, "dy": 0, "easing": "linear" } }
  ]
}
```

## 已知坑
- 打字机 = step 小 + dur 极短 + linear（出现即定，不弹）；与 blur-slide 的弹簧语义完全不同
- mock 内容出版级（Q10）：文字铺满、版式完整，"贴图+标语"级返工
- 正文字号小是"纹理"豁免（Q11）——但相机特写段观众会读，字号按特写后有效字高达标
- SFX：keyboard 拟音裁到与写入等长（S4），音量 0.25 垫底