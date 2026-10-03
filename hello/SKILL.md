---
name: hello
version: 0.1.0
description: 最小 process provider 示例，验证参数、stdin、cwd 和取消。
---

# Hello

每次调用启动 cli/bin/hello-process。使用 `hello argv 'a b' ''` 验证参数，`printf hi | hello pipe` 验证 stdin。

在本包目录运行 `go build -o cli/bin/hello-process ./provider/process`，将 SKILL.md 与 cli/ 打成 ZIP 后经统一安装入口安装。
