---
name: type-entrance-moves
一句话: 字符坠落——重力砸落、弹簧弹跳、歪斜站定，最后一拍集体立正归位
适用: 大标题/章节字卡入场；轻松调性的开场破冰
时长: 4–5s（动作 ~3s + hold ≥1s）
能量: 中高（物理趣味）
依赖: stagger(spring)
---

## 意图
物理喜剧感：字符从天而降砸地弹跳、歪歪扭扭站定，最后集体立正。与 blur-slide（默认解）、document-typewriter-reveal（打字机）同品类互斥选用。

## video_studio/1 配方

```jsonc
{ "id": "title", "type": "text", "x": 240, "y": 280, "w": 800, "h": 140,
  "html": "Shotcraft", "fontSize": 88, "fontWeight": 800, "color": "#fff",
  "align": "center", "valign": "middle",
  "stagger": { "by": "char", "step": 0.07, "delay": 0.3, "dur": 1.1,
               "dy": -180, "rotation": 8, "scaleFrom": 1.06,
               "easing": "spring(9,170,1)" } }   // 欠阻尼：砸落→过冲→回弹站定
// "集体立正"：rotation 奇偶交替歪斜由 stagger 内置（idx%2），spring 收干即立正
```

## 参数手感
| 参数 | 典型值 | 调节 |
|---|---|---|
| spring | (9,170,1) | damping <7 弹跳过多读作果冻；>14 无弹跳读作滑落 |
| dy | -160~-220px | 从画面上方砸入；正值则从下方升起（语义变"生长"） |
| rotation | 6–10° | 歪斜站定的喜剧感来源 |
| step | 0.07s | 逐字砸落节拍 |

## 已知坑
- 纯文本专用（含 html 标签退化）；字距别太紧，弹跳时字符会碰
- 落定后 hold ≥1s（R1）；SFX 配逐个轻 pop（音量阶梯递减，S2）不配重 impact
- 严肃品牌片不用此卡（调性不符），用 blur-slide