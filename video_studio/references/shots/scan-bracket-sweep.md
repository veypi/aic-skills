---
name: scan-bracket-sweep
一句话: 文档弹到中央，四角 L 形取景括号锁定，扫描光带往复扫——文档全程静止，只有光在读它
适用: "正在解析/校验这份内容"的过程镜头；上传→分析链路中段
时长: 4–5s（括号 0.5s + 扫描 2–3 趟 + hold）
能量: 中低（机械克制，节奏在往复扫掠的呼吸上）
依赖: keyframes, sheen/shape 光带
---

## 意图
让观众看懂"这份东西正在被机器逐行读过"。括号宣布检查对象，光带宣布检查过程。命门：**文档本身完全静止**——一旦文档也在动，观众分不清是"被检查"还是"在加载"。

## video_studio/1 配方

```jsonc
// 文档（静止）+ 四角括号（从外扩收拢锁定）+ 扫描光带（kfLoop 往复）
{ "id": "doc", "type": "image", "src": "assets/report.png", "x": 390, "y": 120, "w": 500, "h": 480,
  "fx": { "enter": "zoom", "enterDur": 0.5 } },
{ "id": "bracket-tl", "type": "svg", "x": 370, "y": 100, "w": 40, "h": 40,
  "markup": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><path d='M2 38 V2 H38' fill='none' stroke='#4ecdc4' stroke-width='4'/></svg>",
  "keyframes": [
    { "t": 0.3, "x": 330, "y": 60, "opacity": 0 },
    { "t": 0.8, "x": 370, "y": 100, "opacity": 1, "easing": "bezier(0.16,1,0.3,1)" }
  ] }
// tr/bl/br 三角镜像（svg path 旋转），同 delay 收拢
{ "id": "scan", "type": "shape", "shape": "rect", "x": 392, "y": 120, "w": 496, "h": 26,
  "fill": "rgba(78,205,196,0.18)", "blur": 2,
  "keyframes": [ { "t": 0, "y": 120 }, { "t": 1.4, "y": 574 } ], "kfLoop": true }
```

## 已知坑
- 文档入场后零关键帧零 fx——静止是语义（别加漂移/呼吸）
- 光带用 kfLoop 往复（单程取模会跳回顶部；要往复写 0→底→0 三段关键帧再 loop）
- 括号收拢后锁定不动；扫描 2–3 趟即停（loop 场景 duration 裁断）
- SFX：轻 scan/hum 循环垫底，音量 0.15