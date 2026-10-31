// Command cua 启动官方 cua-driver 的 MCP 服务。
//
// 这个包只是官方 CuaDriver 的预装启动器：可执行文件的解析规则全部在本包内，
// pod 不需要知道 cua 是什么（统一 commands 机制按 manifest 拉起本程序）。
//
// 解析顺序：AIC_CUA_DRIVER_PATH → 发行物 bundle（AIC_CUA_BUNDLE_DIR 或包根的
// cua/ 目录，可执行文件在 bin/ 下）→ PATH → macOS 的 /Applications/CuaDriver.app。
// 进程模型：stdio 原样直通，退出码透传；pod 按进程组回收时启动器与驱动同组。
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// driverBinary 是发行物内 cua-driver 的相对路径（按平台）。
func driverBinary() string {
	switch runtime.GOOS {
	case "darwin":
		return "CuaDriver.app/Contents/MacOS/cua-driver"
	case "windows":
		return "cua-driver.exe"
	default:
		return "cua-driver"
	}
}

// bundleRoot 找发行物目录：env 优先，否则看包根有没有 cua/ 目录
// （本程序是 <pkg>/bin/cua，发行物在 <pkg>/cua/）。
func bundleRoot() string {
	if v := os.Getenv("AIC_CUA_BUNDLE_DIR"); v != "" {
		return v
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", "cua"))
	if st, err := os.Stat(root); err == nil && st.IsDir() {
		return root
	}
	return ""
}

// resolveDriver 定位 cua-driver；找不到返回 ""（由调用方给安装指引）。
func resolveDriver() string {
	if v := os.Getenv("AIC_CUA_DRIVER_PATH"); v != "" {
		return v
	}
	if root := bundleRoot(); root != "" {
		return filepath.Join(root, filepath.FromSlash(driverBinary()))
	}
	if _, err := exec.LookPath("cua-driver"); err == nil {
		return "cua-driver"
	}
	if runtime.GOOS == "darwin" {
		return "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
	}
	return ""
}

func main() {
	driver := resolveDriver()
	if driver == "" {
		fmt.Fprintln(os.Stderr, "cua-driver not found: install the official CuaDriver, or set AIC_CUA_DRIVER_PATH")
		os.Exit(1)
	}
	cmd := exec.Command(driver, "mcp")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	// 上游的更新检查与遥测默认关掉：这是自动化通道，不是交互安装。
	cmd.Env = append(os.Environ(),
		"CUA_DRIVER_RS_UPDATE_CHECK=false",
		"CUA_DRIVER_RS_TELEMETRY_ENABLED=false",
	)
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			code := exit.ExitCode()
			if code < 0 {
				// 被信号杀死时 ExitCode 返回 -1，os.Exit(-1) 实际退出码是
				// 255；跨平台拿不到信号号，归一为 1 而不是误导性的 255。
				code = 1
			}
			os.Exit(code)
		}
		fmt.Fprintf(os.Stderr, "cua-driver: %v\n", err)
		os.Exit(1)
	}
}
