---
name: verisim
nickname: VeriSim · 数字电路仿真综合
description: 浏览器内真实运行 Icarus Verilog 仿真与 Yosys 综合的数字 IC 设计验证工作台：波形 / 原理图 / 网表 / 面积报告，12+ FPGA 工艺 + ASIC Liberty
keywords: [verilog, ic, fpga, asic, 仿真, 综合, yosys, iverilog, vcd, 波形, 数字电路, eda]
icon: fa-solid fa-microchip
ui:
  - path: index.html
    desc: VeriSim 工作台（代码编辑 / 仿真波形 / 原理图 / 综合报告 / 网表 + 控制台）
---

# VeriSim 操控手册

## 是什么

VeriSim = 浏览器里的数字 IC 设计验证工作台：写 Verilog → **真实运行** Icarus Verilog 仿真
（WASM）与 Yosys 综合（WASM），看 `$display` 输出、VCD 波形、门级网表 + 原理图、
单元/触发器/线网面积报告。计算全在页面端完成，结果是真实工具链输出，不是模拟。

- **AI 不内嵌**：页面零 ai-box、零会话；操控面 = setup 块声明的 `pageDesc` 指令集，
  平台 OS/page 通道按 `{win_id}.{cmd}` 自动采集。
- **本地文件根 `/verisim/`**（OPFS）：与 AI `fs` 工具（1host=page）同一存储——
  你经 fs 写的文件页面立即可读，反之亦然。
- 引擎分发：国内/海外 CDN 镜像优先（revision pin 在包内 `js/sources.js`）；
  yosys 引擎（52MB wasm）**仅走 CDN**（jsDelivr npm，pin 版本），不做本地兜底——
  首次综合需下载，之后浏览器缓存零网络。
- 多工艺：FPGA `ice40/ecp5/nexus/gowin/xilinx/gatemate/intel_alm/anlogic/efinix/sf2/greenpak4/coolrunner2`；
  ASIC `lib:builtin:nangate45`（内置 NanGate 45nm）或 `lib:user:<名>`（用户导入的 Liberty，只存浏览器）。

## 操作方式

1. 打开页面：`open {url_prefix}/index.html`（`url_prefix` = skill 列表返回的包前缀，
   形如 `/skills/local/{name}`（正式条目 `/skills/public/{id}`）；随部署/平台可变，**勿硬编码**）
   （用户亦可从 agent 详情「关联技能」点击开窗）。
2. 首开先 `exec 1host=page {win_id}.veri_status` 确认 `ready:true`（引擎/脚本异步加载，
   未就绪时除 `veri_status` 外一律返回错误）。
3. 代码传递两条路：
   - **fs 文件（推荐）**：`fs write`（1host=page）写入 `/verisim/xxx.v` →
     `sim_file --file /verisim/xxx.v` / `synth_file --file /verisim/xxx.v`；
   - **短代码直传**：`sim_code --code '<verilog>'`（一次性小代码，避免长参数）。
4. 迭代闭环：读返回的 `error` / `output_tail` 定位 → fs 修码 → 重跑；
   页面与控制台同步展示全过程，用户实时可见。

## 指令表

返回统一 `{content: "<JSON 字符串>"}`：成功 `{ok:true, ...}`，失败 `{ok:false, error}`。
argv 风格 `--key val`；`show_pane` 也接受位置参数。指令**不要并行调用**，一轮一个。

| 指令 | 说明 | 参数 | 返回要点 |
| --- | --- | --- | --- |
| `veri_status` | 页面状态（**唯一未就绪可调用**） | 无 | `{ok, ready, busy, activePane, tech, topModule, codeLength, sourceLabel, fileCount}` |
| `veri_files` | 列出 `/verisim/` 源文件 | 无 | `{ok, root, files:[{name, size, mod_time}]}`（v/sv/txt） |
| `veri_open` | 本地文件载入编辑器（写完展示用） | `--file <路径>` | `{ok, file, code_length, top}` |
| `sim_code` | 直接仿真一段 Verilog（设计+tb 可同文件） | `--code <源码> [--top] [--pane wave]` | `{ok, text, signals, duration, timescale, warnings, output_tail}`；自动注入 `$dumpfile` 波形记录 |
| `sim_file` | 仿真本地文件（可附独立 tb） | `--file <路径> [--tb <路径>] [--top] [--pane wave]` | 同 sim_code |
| `synth_file` | Yosys 综合本地文件 | `--file <路径> [--top] [--tech <工艺>] [--pane synth]` | `{ok, text, top, cells, wires, dff, output_tail}` |
| `show_pane` | 切换页签 | `--pane code\|wave\|sch\|synth\|netlist\|console` | `{ok, text}` |
| `clear_console` | 清空控制台 | 无 | `{ok, text}` |

`--tech` 缺省 = 页面当前选择（通用 techmap）；FPGA 填表上 12 种之一；ASIC 填
`lib:builtin:nangate45` 或 `lib:user:<文件名>`。综合会自动剔除 `tb`/`*_tb`/含系统任务的模块，
被剔除名单见控制台日志；`--top` 缺省自动推断。

## 事件契约

- 调用：`exec 1host=page {win_id}.{指令}`，argv 字符串数组（`["--file","/verisim/main.v"]`）。
- 页面未打开时指令无响应：先 `open`，`list` 确认窗口与事件后再调用。
- 未就绪（引擎初始化中）：除 `veri_status` 外返回 `{ok:false, error:'页面初始化中…'}`；
  引擎加载失败时 `veri_status.ready=false` 且 `sourceLabel` 带错误，向用户说明并提示刷新。
- 仿真/综合是真实 WASM 计算：首次跑 yosys 需下载引擎（CDN 慢时十几秒，页面有进度遮罩），
  之后浏览器缓存零网络；超时类错误提示用户稍后重试，不要连续重发。
- 文件监听：你经 fs 写文件后页面**不会自动刷新**编辑器，需要 `veri_open` 载入展示；
  `sim_file/synth_file` 会直接读文件内容运行，不依赖编辑器当前代码。

## 工作规则

1. **先取数，再回答**：仿真/综合结论只来自指令返回（`ok/output_tail/warnings/cells/dff`），
   禁止凭印象编造结果；区分「已运行验证的事实」与「未验证的推断」。
2. **先仿真，后综合**：功能代码必须 `sim_code/sim_file` 验证通过；涉及硬件实现评估再
   `synth_file` 看面积/触发器/映射。
3. **失败要定位**：每次失败读 `error` 与 `output_tail`，定位到具体模块/行/信号后修码重跑，
   不要只复述报错。
4. **设计与测试台分离**：迭代文件存 `/verisim/`；交付综合的设计保持干净（综合层会自动剔 tb）。
5. 需求不清先确认端口、位宽、时钟/复位、时序协议与验收标准；合理假设写进代码注释和回复。
6. 简单一次性代码用 `sim_code --code`；需要保留或多次迭代的用 fs 写 `/verisim/` 后 `sim_file`。
7. 页面调用超时/失败或返回 `ok:false` 时向用户说明原因；用户没开页面时不要强行调用，
   先发页面链接（agent 详情「关联技能」可开）。

## Verilog 工程约定（写码遵守）

### 可综合设计

- 时序逻辑 `always @(posedge clk)` 或 `always @(posedge clk or negedge rst_n)`；组合逻辑
  `always @(*)` 或连续赋值；时序用非阻塞 `<=`，组合用阻塞 `=`，不混用。
- 组合逻辑覆盖所有分支（`if/else` 补全、`case` 给 `default`），避免意外 latch。
- 复位策略一致：异步低有效 `negedge rst_n`；同步复位不进敏感列表；跨时钟先两级触发器同步。
- 设计模块避免 `initial`、延时 `#`、`$display/$finish/$dump*`、`real/time`、不可静态展开的循环；
  测试台可用这些仿真语法。
- 显式位宽；有符号用 `signed/$signed` 并说明溢出策略；移位/拼接/比较注意宽度匹配。
- 循环必须静态可展开；数组/存储器推断说明映射预期（触发器/LUT/BRAM）。

### 常见结构

- FSM：`localparam` 定义状态，明确默认态与非法态恢复；区分状态寄存器/次态/输出逻辑；
  说明 Moore 还是 Mealy。
- 计数器/定时器：位宽、使能、加载、饱和/回绕策略明确；溢出用进位位或比较器显式表达。
- ALU/数据通路：操作码 `localparam/parameter`；零标志/进位/溢出定义一致。
- 握手：ready/valid 说明何时采样、何时回压；FIFO 注意满空阈值、读写同域/跨域。
- 外设接口：UART/SPI/I2C 先确认时钟分频、采样边沿、帧格式、空闲电平、错误处理。

### 测试台

- 写清 `` `timescale``、时钟周期、复位释放时间、激励顺序、结束条件。
- 需要波形写 `$dumpfile("dump.vcd"); $dumpvars(0);`；缺省前端自动注入 dump 模块。
- 尽量自检：参考模型/golden 比较并打印失败原因；覆盖复位、正常、边界值、溢出、回压/空闲。
- `$display` 输出含时间、关键信号、期望值，便于从 `output_tail` 判断问题。

### 工具结果阅读

- Icarus 编译告警区分语法错误/位宽告警/隐式线网/未驱动信号；仿真失败优先看首个 ERROR 之前上下文。
- Yosys 综合失败常见于把测试台/系统任务交给设计、顶层推断错误、不可综合语法。
- 综合报告重点看 `cells/cell bits/dff/wires/wire bits` 与单元映射；触发器数量异常通常说明
  时序/复位/位宽理解有偏差。
