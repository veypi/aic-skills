---
name: list-reveal
一句话: 列表逐项 scale 找位（软 back 过冲），同时整个容器全程慢速漂移——两层不相干的运动
适用: 导航/侧边栏/设置面板入场；旁白铺垫时的低能量底
时长: 3–4s（6 项 × 0.33s 间隔）
能量: 低（稳定节拍，靠漂移维持画面不死）
依赖: stagger, kfLoop
---

## 意图
逐项淡入最容易死板：每项动完就停，两项之间画面钉死。解法是给容器一层与逐项入场无关的慢速漂移——局部在"找位"，整体在"呼吸"。

## video_studio/1 配方

```jsonc
// 容器漂移：overlay 不行（场景内用一个大包裹元素不现实）——用每项共享的
// kfLoop 微漂移叠加 stagger 入场（两层运动独立）
{ "id": "item-0", "type": "text", "x": 420, "y": 160, "w": 440, "h": 44,
  "html": "Dashboard", "fontSize": 26, "color": "#f5f7fa",
  "stagger": { "by": "word", "step": 0, "delay": 0.3, "dur": 0.6, "dy": 14, "scaleFrom": 0.9, "easing": "backOut" } }
// item-1 delay 0.63 / item-2 0.96 …（间隔 0.33s）
// 整体漂移：给每个 item 加 kfLoop 关键帧（同参数 → 视觉上整列同步漂移）
// "keyframes": [{"t":0,"y":160},{"t":4,"y":148}], "kfLoop": true —— 与 stagger 叠加
```

## 参数手感
| 参数 | 典型值 | 调节 |
|---|---|---|
| 项间隔 | 0.33s（10f） | 稳定节拍，不加速（此卡语义是"从容"不是"涌入"） |
| 过冲 | backOut / scaleFrom 0.9 | 软过冲；spring 太弹读作果冻 |
| 漂移幅度 | 10–14px / 4s | 观众 barely 察觉但画面不死 |

## 已知坑
- 与 deck-deal-flyin 语义互斥：此卡低能量从容，彼卡高能量涌入；同片别都用
- 漂移是 kfLoop 环境动画，入场是 stagger——两层时间基准不同，别合并成一组关键帧