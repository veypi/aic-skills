---
name: device_tool
version: 0.1.0
description: 示例：设备侧命令怎么写——正文写清安装/依赖/路径/调用，包内 cli/ 只放源码与服务声明。
keywords: [device, cli, 命令, 设备, 示例]
icon: fa-solid fa-terminal
---

# 设备侧命令示例

这个包演示"设备侧命令"在技能包里长什么样：**说明书在云端，程序在设备上**。

## 适用场景

需要在用户的电脑/手机上多一条命令（读文件、跑脚本、调某个工具），并且用户愿意自己装一次。

## 不适用

只想在 AIC 里做事、不涉及用户自己机器的——那是界面或云端接口的活。

## 步骤

1. 构建程序（源码在 `cli/main.go`，Go 1.21+）：

```sh
go build -o ./mytool ./cli
```

2. 放到固定路径并加入 PATH（示例：`/usr/local/bin/mytool`；Windows 放 `%LOCALAPPDATA%\mytool`）。

3. 调用：

```sh
echo '{"cmd":"ping"}' | mytool
```

## 依赖与权限

- 依赖：Go 1.21+（构建期）；运行期无外部依赖。
- 权限：读用户目录下的文件需要用户自己的权限；不碰设备沙箱外的东西。

## 验收

- `echo '{"cmd":"ping"}' | mytool` 输出 `{"content":"pong","isError":false}`。
- 参数经 stdin 传 JSON（不要拼进命令行）。

## 服务形态（可选）

需要常驻状态（连接、窗口、快照）时，把 `cli/manifest.json` 一起带上：声明服务别名、
启动方式、程序解析规则。**注意**：服务声明的自动注册目前只对官方内建包生效；
给普通用户分发时，仍以"自己装 + 正文写清"为主。
