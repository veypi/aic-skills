/* VeriSim Pro - built-in single-file Verilog examples */
export default {
  counter: {
    top: 'counter',
    code: `// 4-bit 同步计数器：低有效异步复位 + 使能
module counter(clk, rst_n, en, q);
input  clk, rst_n, en;
output reg [3:0] q;
always @(posedge clk or negedge rst_n) begin
  if (!rst_n) q <= 4'd0;
  else if (en) q <= q + 1'b1;
end
endmodule

\`timescale 1ns/1ps
module tb;
reg clk, rst_n, en;
wire [3:0] q;
counter dut(.clk(clk), .rst_n(rst_n), .en(en), .q(q));

always #5 clk = ~clk;

initial begin
  clk = 0; rst_n = 0; en = 0;
  #12 rst_n = 1;
  #10 en = 1;
  repeat (16) @(posedge clk);
  $display("t=%0t  q=%0d (overflow check)", $time, q);
  #10 en = 0;
  #20 $display("仿真结束, 最终 q = %0d", q);
  $finish;
end
endmodule`
  },
  alu: {
    top: 'alu',
    code: `// 8-bit ALU：加 / 减 / 与 / 或
module alu(a, b, op, y, zero);
input  [7:0] a, b;
input  [1:0] op;
output reg [7:0] y;
output zero;
always @(*) begin
  case (op)
    2'd0: y = a + b;
    2'd1: y = a - b;
    2'd2: y = a & b;
    default: y = a | b;
  endcase
end
assign zero = (y == 8'd0);
endmodule

\`timescale 1ns/1ps
module tb;
reg  [7:0] a, b;
reg  [1:0] op;
wire [7:0] y;
wire zero;
alu dut(.a(a), .b(b), .op(op), .y(y), .zero(zero));
initial begin
  a = 8'd25; b = 8'd17;
  op = 0; #20 $display("%0d + %0d = %0d", a, b, y);
  op = 1; #20 $display("%0d - %0d = %0d", a, b, y);
  a = 8'hF0; b = 8'h0F;
  op = 2; #20 $display("%h & %h = %h", a, b, y);
  op = 3; #20 $display("%h | %h = %h", a, b, y);
  a = 8'd17; b = 8'd17;
  op = 1; #20 $display("%0d - %0d = %0d, zero=%b", a, b, y, zero);
  $finish;
end
endmodule`
  },
  fsm: {
    top: 'seqdet',
    code: `// 序列检测 FSM：检测 1011（Moore，重叠检测）
module seqdet(clk, rst_n, din, found);
input clk, rst_n, din;
output reg found;
reg [2:0] state;
localparam S0=0, S1=1, S10=2, S101=3, S1011=4;
always @(posedge clk or negedge rst_n) begin
  if (!rst_n) begin state <= S0; found <= 1'b0; end
  else begin
    case (state)
      S0:    state <= din ? S1 : S0;
      S1:    state <= din ? S1 : S10;
      S10:   state <= din ? S101 : S0;
      S101:  state <= din ? S1011 : S10;
      S1011: state <= din ? S1 : S10;
      default: state <= S0;
    endcase
    found <= (state == S1011);
  end
end
endmodule

\`timescale 1ns/1ps
module tb;
reg clk, rst_n, din;
wire found;
seqdet dut(.clk(clk), .rst_n(rst_n), .din(din), .found(found));
always #5 clk = ~clk;
task send;
  input d;
  begin din = d; #10; end
endtask
initial begin
  clk = 0; rst_n = 0; din = 0;
  #12 rst_n = 1;
  send(1); send(0); send(1); send(1);
  send(0); send(1); send(1); send(0);
  #20 $finish;
end
always @(posedge found) $display(">>> t=%0t 检测到序列 1011!", $time);
endmodule`
  },
  adder: {
    top: 'adder4',
    code: `// 门级 1-bit 全加器 + 4-bit 行波进位加法器
module full_adder(a, b, cin, sum, cout);
input a, b, cin;
output sum, cout;
assign sum  = a ^ b ^ cin;
assign cout = (a & b) | (b & cin) | (a & cin);
endmodule

module adder4(a, b, sum, cout);
input  [3:0] a, b;
output [3:0] sum;
output cout;
wire c0, c1, c2;
full_adder fa0(.a(a[0]), .b(b[0]), .cin(1'b0), .sum(sum[0]), .cout(c0));
full_adder fa1(.a(a[1]), .b(b[1]), .cin(c0),   .sum(sum[1]), .cout(c1));
full_adder fa2(.a(a[2]), .b(b[2]), .cin(c1),   .sum(sum[2]), .cout(c2));
full_adder fa3(.a(a[3]), .b(b[3]), .cin(c2),   .sum(sum[3]), .cout(cout));
endmodule

\`timescale 1ns/1ps
module tb;
reg  [3:0] a, b;
wire [3:0] sum;
wire cout;
adder4 dut(.a(a), .b(b), .sum(sum), .cout(cout));
integer i, j;
initial begin
  for (i = 0; i < 16; i = i + 1)
    for (j = 0; j < 16; j = j + 1) begin
      a = i; b = j; #5;
      if ({cout, sum} !== i + j)
        $display("错误: %0d+%0d => cout=%b sum=%0d", i, j, cout, sum);
    end
  $display("全部 256 组加法测试完成");
  $finish;
end
endmodule`
  }
};

