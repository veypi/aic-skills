package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// loadBrowserConfig 读取设备 owner 的应用配置。它不是 pod 的命令配置面：
// Chrome 路径、origin、代理等应用语义全部由 browser 自己解释。
func loadBrowserConfig() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	file, err := os.Open(filepath.Join(home, ".aic", "browser", "config.env"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" || strings.ContainsAny(key, " \t") {
			continue
		}
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, strings.TrimSpace(value))
		}
	}
	return scanner.Err()
}
