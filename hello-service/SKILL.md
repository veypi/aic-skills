---
name: hello-service
version: 0.1.0
description: 最小 service provider 示例，演示每连接一次调用或一条双向流。
---

# Hello service

本包只运行 cli/bin/hello-service，通过 sdk/go/skillproc.ServeConn 接收 invoke 与 echo 流。公开流端点是 `hello-service.echo`；关闭连接取消当前工作，service 由包管理器停止，不进入 bg。

在本包目录运行 `go build -o cli/bin/hello-service ./provider/service`，将 SKILL.md 与 cli/ 打成 ZIP 后安装。service 使用设备权限，只安装可信代码。
