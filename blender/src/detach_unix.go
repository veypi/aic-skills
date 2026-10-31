//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

// detach 让 GUI 进程脱离本服务的进程组：pod 重启/回收本服务时按进程组杀，
// 不该把用户正在用的 Blender 一起带走。
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
