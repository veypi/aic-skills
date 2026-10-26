---
name: hello
version: 1.0.1
description: 普通原生 CLI 示例：参数、stdin、工作目录和取消。
---

下载本技能后，在本目录执行 `go build -o ./hello ./scripts/hello.go`。
执行 `./hello argv 'a b' ''`、`printf hi | ./hello pipe`、`./hello cwd`。

- `./hello probe-write <path>` 是文件写权限探针：输出 `ok` 或 `denied: ...`，用于观察设备 fs 策略。
- `./hello sleep 30` 用于观察 exec 超时转后台与取消；后台任务用 `bg kill <id>` 终止。取消由 exec 层结束进程，程序自身不做信号处理。

这是独立命令，可自行放入 PATH；不需要技能注册表、manifest 或 MCP。
