---
name: hello
version: 1.0.0
description: 普通原生 CLI 示例：参数、stdin、工作目录和取消。
---

下载本技能后，在本目录执行 `go build -o ./hello ./scripts/hello.go`。
执行 `./hello argv 'a b' ''`、`printf hi | ./hello pipe`、`./hello cwd`。
这是独立命令，可自行放入 PATH；不需要技能注册表、manifest 或 MCP。
