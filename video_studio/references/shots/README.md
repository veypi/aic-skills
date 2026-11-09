# 镜头卡索引

翻译自 video-shotcraft 124 张实战镜头卡，适配 video_studio/1 引擎。每卡 = 意图 + JSON 配方 + 参数手感 + 已知坑。
**用法**：分镜时按能量曲线选卡 → 读卡全文 → 按配方写元素/关键帧/运镜 → 截帧自检。
配方是调校过的起点，允许适配性改动，但"已知坑"标注的参数不得降档。

## 按能量选卡

| 能量 | 卡 |
|---|---|
| 低（铺垫/呼吸） | blur-slide · list-reveal · marker-underline-title · letterspace-materialize · document-typewriter-reveal |
| 中（叙事主力） | spotlight-hero-card · row-embed · card-stack · draw-svg-trace · scan-bracket-sweep · page-waterfall-wall · chart-live-moves · logo-shrink-wordmark-lockup |
| 中高（爬升） | deck-deal-flyin · type-entrance-moves · gauge-readout-moves · speed-ramp-freeze · circle-match-iris · white-flash-logo-simplify-cut |
| 高（峰值，全片 sparingly） | crash-zoom-punch · impact-feedback · gradient-word-sweep · beat-cut-moves · outro-group-photo-launch |

## 按用途选卡

- **开场**：spotlight-hero-card（单主角）· letterspace-materialize（品牌字标）· type-entrance-moves（轻松破冰）
- **文字入场**：blur-slide（默认解）· type-entrance-moves（物理喜剧）· document-typewriter-reveal（文档感）——同品类互斥选用
- **批量/UI 入场**：deck-deal-flyin（量感）· row-embed（嵌入）· list-reveal（低能量底）· card-stack（先整体后个体）· page-waterfall-wall（流动一览）
- **点名/强调**：crash-zoom-punch（急推）· draw-svg-trace（描边）· scan-bracket-sweep（解析感）· marker-underline-title（关键词）· gradient-word-sweep（充能）
- **数据叙事**：chart-live-moves · gauge-readout-moves
- **节奏**：beat-cut-moves（硬切当鼓点）· speed-ramp-freeze（定格划重点）
- **转场**：circle-match-iris · white-flash-logo-simplify-cut
- **收尾**：outro-group-photo-launch（发布会合影）· logo-shrink-wordmark-lockup（品牌定妆）

## 全片纪律

- 一种手法只当一次主角（P4）；急推 ≤2 次；全画面冲击 ≤3 处（R4）
- 每张卡的动作段后留 hold（R1）；初版放慢一档（R3）
- 卡名写进 brief.md 分镜表，终检按卡还原度审查