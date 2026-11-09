//go:build !darwin

package main

import "os/exec"

func startChrome(opts launchOptions, profile string, tail *tailBuffer) (*exec.Cmd, error) {
	cmd := exec.Command(opts.ChromePath, buildChromeArgs(opts, profile)...)
	cmd.Stderr = tail
	return cmd, cmd.Start()
}

func chromeProfilePID(profile string) (int, error) {
	return 0, nil
}
