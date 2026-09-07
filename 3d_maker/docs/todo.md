# 3D Maker 路线图（2026-09-06 用户定稿）

## 战略定位

目标：**比 Blender 更强**。但不在功能广度竞争（20 年迭代的 DCC 全家桶不可复刻），
只赢两个 Blender 没有（或做不到）的维度：

1. **AI 原生闭环**：Blender 是给人眼的软件；AI 建模最大的痛 = 写码→渲染→看不到结果→盲猜。
   3D Maker 以 AI 为第一操作者，必须提供 AI 可读的反馈（截图/审计 JSON）。
2. **B-Rep 精确 + CAD 互操作**：精确布尔/圆角/曲面 + STEP/IGES 导入导出；
   Blender 是网格近似内核，碰 CAD 文件要装插件。

策略：**不是替代 Blender，而是让 Blender 成为下游**——3D Maker 出精确几何 →
导出 GLB/STEP → Blender 精加工（雕刻/动画/渲染）。赢上游（AI 直接产出高质量可打印几何），
不碰下游（人的艺术加工）。

## 阶段 0：AI 视角闭环（最高性价比，先做）

- [x] `screenshot` 指令：渲染截图 base64 回传（`{win_id}.shot`），AI 直接看图迭代
  - **实现形态（2026-09-06）**：shot 只负责截图落盘 `/3d/`（平台图片投递收敛只认 fs.read，直接 attrs 回传会被 procs 剥掉），AI 两步 = shot → fs.read 读回；viewer.shot() 强制 render 后同帧 toBlob 产 JPEG Blob（preserveDrawingBuffer 默认关；不用 toDataURL+fetch，避免 base64 中转与 vhtml scoped 把 data: 前缀化）
- [x] `parts_audit` 指令：逐部件问题清单（非水密/悬空/干涉/壁厚），辅助 AI 修模
  - **实现形态（2026-09-06）**：viewer.audit() 逐部件 analyzePrintability + detectThinWalls（新增网格级壁厚近似：表面重心沿 -法线射线最近命中，DDA 体素遍历 + Möller–Trumbore）+ detectInterference 反查 conflicts；critical=非水密/非流形/薄壁（minWall<1.2mm），warning=悬空/干涉
- [x] 验收：AI 能"闭着眼睛"迭代模型到可打印，不再需要用户截图中转

## 阶段 1：有机形态（补表达力）

- [x] 网格级 API：`meshFromVerts(verts, faces)`、`loft(sections)`、`sweep(profile, path)`、
      `subdivide`、`displace(noise)`、`smooth`
  - **实现形态（2026-09-06）**：builtin 侧 kernel.js 纯网格实现（loft 截面重采样对齐+环绕向自动校正+端盖方向公式、sweep 平行传输帧、subdivide 中点细分、displace 顶点法线噪声、smooth 拉普拉斯）；有机 API 入口统一顶点焊接（_weldShape）保水密语义；node 实测 10+ 用例全绿（loft 圆柱 6243≈πr²h、sweep 弯管/环管、subdivide 形状不变、displace/smooth 后 watertight=true）
- [x] OCCT 侧镜像：B-Rep 从三角网格重建（BRepBuilderAPI 族），保持双内核语义一致（§13 约定）
  - **实现形态（2026-09-06）**：occt-kernel.js 新增 _occtFromMesh（每三角 MakePolygon→MakeFace→Sewing→MakeSolid，>2 万面拒绝）、_loftOCCT（ThruSections）、_sweepOCCT（MakePipeShell→MakePipe 兜底）；embind 重载探测（_pickCtor/_fn）自适应 opencascade.js 构建；subdivide/displace/smooth 经网格→builtin 变换→Sewing 重建。**待浏览器实测**（OCCT 内核跑有机案例验证布线）
- [x] 验收：AI 能做树/花瓶曲面/有机装饰（此前讨论的"方案 1"），原有能力全部保留（纯加法）
  - 验证：有机花瓶案例（loft+subdivide+displace，4544 面 watertight true）入 ui/examples/ 与工具栏案例菜单

## 架构纪事

### 2026-09-06 OCCT 内核整体 Worker 化（C1）+ UnifySameDomain 修复

- 动因一（报错）：opencascade.js@2.0.0-beta.533428a 未绑定 `BRepBuilderAPI_UnifySameDomain`
  （d.ts 全文核对只有底层 `ShapeUpgrade_UnifySameDomain`）→ 每次布尔都警告并跳过碎面合并，
  长链布尔面数腐坏累积。修复：`_unifySameDomain` 直用 `ShapeUpgrade_UnifySameDomain_2` +
  SetSafeInputMode（node 实测：并排 box fuse 10 面→6 面，体积不变）。
- 动因二（卡顿）：每次 `new factory()` 的 embind 注册 + OCCT 静态构造在主线程同步跑 ~1.8s
  （实测：编译仅 55ms、实例化 29ms，两级 IndexedDB 缓存都省不掉这 1.8s）——页面每次打开冻结。
- 形态：`occt-worker.js`（内核 + run-core 执行分析管线全在 worker）+ `occt-client.js`
  （主线程门面，viewer 以 `kernel.worker` 标记识别）；mesh 结果经 transferable 零复制回主线程，
  重建内置 `Shape(positions, indices)` 供渲染/交互（精确统计已由 worker 用 B-Rep 算进 result）；
  `run-core.js` = 从 viewer.run 提取的共享执行+分析管线（双内核/双线程同一实现源）；
  abort = terminate + 后台重建；超时 = client 看门狗；viewer.dispose 级联 client.dispose 防泄漏。
- 验证：node e2e 9 项全绿（真实 OCCT 经 file:// dist + fetch shim 驱动：最小盒/fuse+unify 水密/
  多部件干涉/NO_RETURN 映射/重建超限匹配 fallback 正则/builtin 路径/乐高双内核体积偏差 0.05%/
  builtin 路径/乐高双内核体积偏差 0.05%（builtin 67588 面 vs OCCT 860 面）/TIMEOUT 语义）。
- 遗留观察：OCCT WASM 对象无显式 delete（沿既有风格，页面生命周期内有界）；embind 初始化耗时
  根本解 = C2 定制裁剪构建（发布 16MB 闸门时再谈）。

## 阶段 2：CAD 生态纵深（Blender 硬短板）

- [ ] STEP/IGES 导入（用户工程模型 → 质检/手术/打印准备）+ 导出
- [ ] OCCT 全 API 暴露：变半径圆角、抽壳、偏移加厚、螺旋、放样曲面
- [ ] 验收：用户导入 STEP 齿轮箱，AI 检测水密/干涉并给出修模建议

## 阶段 3：展示与产出（给"人"看的部分）

- [ ] PBR 材质 + 环境光渲染（EEVEE 级别即可，WebGPU）
- [ ] 爆炸视图动画 / 旋转展示（现有 explode，加关键帧）
- [ ] 批量生成：AI 参数空间搜索（`--variant` 生成 N 个变体渲染对比）
- [ ] 验收：AI 输出"设计展示"像产品图

## 阶段 4：性能与规模

- [ ] 大型模型（100 万面+）性能优化（wasm 线程）
- [ ] 协作/版本：AI 生成历史、模型 diff

## 不做清单（明确放弃，保住定位）

- 雕刻（sculpting）：笔刷领域，代码表达不了，AI 也雕不细腻
- 骨骼绑定/动画/粒子：DCC 红海，对"AI 建模第一入口"定位零增益
- 物理/流体模拟：同理
- 渲染引擎全家桶（Cycles 级）：无头渲染替代不了产品图场景，EEVEE 级即可

## 各场景选型速查

| 目标 | 方案 |
| --- | --- |
| 精密零件/机械件/可打印工程件 | 现状 + 阶段 0 增强 |
| 树/有机装饰/艺术雕塑（展示级） | 阶段 1（网格 API） |
| 逼真人物/动物（写实级） | 阶段 2 互操作 + 外部雕刻/AI 生成源头；3D Maker 只做质检/打印准备 |
| 参数化人形（游戏 NPC/手办粗模） | 阶段 1 能做，别期待写实 |

## 已确认的事实（沉淀）

- 3D Maker = 给 AI 用的、代码化的、为 3D 打印而生的 CAD 内核助手；Blender = 给**人**用的全能 3D 内容工作室
- 纯功能对比 Blender 是超集（B-Rep 精度除外）；生态位 = AI 友好的极简 DSL + 结构化返回 + 打印检测闭环
- AI 的调用成本决定工具选择：极简 DSL（`return box(20,15,10);`）+ JSON 反馈是 Blender bpy 十倍效率
- 内核形态差异根源：3D Maker = B-Rep CAD（OCCT）+ CSG 特征建模；Blender = 多边形网格平台（一切皆网格）；
  树的曲面语言在 Blender 是主场，在 3D Maker 只能靠阶段 1 网格 API 补充
