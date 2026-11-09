---
name: letterspace-materialize
一句话: 大字距字标全字符同时从两侧收敛结晶，齐收成词后长 hold
适用: 片头/片尾品牌字标登场；静谧高级感的收束帧
时长: 静置 0.5s + 描画/收敛 1.7s + hold ≥1s，全段 3–4s
能量: 低（静谧仪式感，一次呼吸完成）
依赖: stagger
---

## 意图
字标不是淡入也不是打字机，而是"结晶"：所有字母同时开始运动、同一瞬间齐收。大字距 + 细字重 + 慢收敛 = 高级感。

## video_studio/1 配方

```jsonc
{ "id": "wordmark", "type": "text", "x": 240, "y": 300, "w": 800, "h": 120,
  "html": "productname", "fontSize": 72, "fontWeight": 300, "letterSpacing": 18,
  "color": "#f5f7fa", "align": "center", "valign": "middle",
  "stagger": { "by": "char", "step": 0.02, "delay": 0.5, "dur": 1.6,
               "dx": 40, "dy": 0, "scaleFrom": 0.92, "easing": "bezier(0.16,1,0.3,1)" } }
// dx 交替方向靠 rotation 微扰替代：stagger 的 dx 统一值时奇偶字符同向——
// 要"两侧收敛"用两组文本（前半/后半）各设 dx ±40，delay 相同
```

## 参数手感
| 参数 | 典型值 | 调节 |
|---|---|---|
| step | 0.02s | 近乎同帧起笔；>0.06 读作打字机 |
| letterSpacing | 12–24px | 字距不够大读作普通标题 |
| fontWeight | 300–400 | 粗字重失去结晶感 |

## 已知坑
- 纯文本才能用 stagger（html 含标签会退化为普通入场）
- 收齐后 hold ≥1s（R1 品牌记忆点）；场景 duration 给足
- 全片只用一次（P4），与 type-entrance-moves 互斥