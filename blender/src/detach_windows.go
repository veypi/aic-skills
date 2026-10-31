//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// detachedProcess 让 GUI 进程脱离本服务的控制台与进程组（同 Unix 的 Setsid）。
const detachedProcess = 0x00000008

func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | syscall.CREATE_NEW_PROCESS_GROUP,
	}
}
