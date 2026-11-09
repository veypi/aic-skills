//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// startChrome uses open -g for a visible browser so launching the app cannot
// steal the user's foreground input. Headless Chrome remains a direct child.
func startChrome(opts launchOptions, profile string, tail *tailBuffer) (*exec.Cmd, error) {
	args := buildChromeArgs(opts, profile)
	if opts.Headless {
		cmd := exec.Command(opts.ChromePath, args...)
		cmd.Stderr = tail
		return cmd, cmd.Start()
	}
	app, err := chromeAppBundle(opts.ChromePath)
	if err != nil {
		return nil, err
	}
	openArgs := []string{"-g", "-n", app, "--args"}
	openArgs = append(openArgs, args...)
	cmd := exec.Command("/usr/bin/open", openArgs...)
	cmd.Stderr = tail
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("background launch chrome: %w", err)
	}
	return nil, nil
}

func chromeAppBundle(executable string) (string, error) {
	dir := filepath.Dir(executable)
	for dir != "/" && dir != "." {
		if strings.EqualFold(filepath.Ext(dir), ".app") {
			return dir, nil
		}
		dir = filepath.Dir(dir)
	}
	return "", fmt.Errorf("visible Chrome on macOS requires an .app executable path, got %q", executable)
}

func chromeProfilePID(profile string) (int, error) {
	lock := filepath.Join(profile, "SingletonLock")
	target, err := os.Readlink(lock)
	if err != nil {
		data, readErr := os.ReadFile(lock)
		if readErr != nil {
			return 0, err
		}
		target = strings.TrimSpace(string(data))
	}
	pid, err := strconv.Atoi(target[strings.LastIndex(target, "-")+1:])
	if err != nil || pid <= 0 {
		return 0, fmt.Errorf("cannot determine Chrome pid from %s", lock)
	}
	return pid, nil
}
