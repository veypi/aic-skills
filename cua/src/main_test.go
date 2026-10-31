package main

import (
	"path/filepath"
	"testing"
)

// 显式路径优先于一切解析。
func TestResolveDriverFromEnv(t *testing.T) {
	t.Setenv("AIC_CUA_DRIVER_PATH", "/opt/cua/cua-driver")
	if got := resolveDriver(); got != "/opt/cua/cua-driver" {
		t.Fatalf("driver = %q", got)
	}
}

// 发行物目录按平台布局拼接。
func TestResolveDriverFromBundle(t *testing.T) {
	t.Setenv("AIC_CUA_DRIVER_PATH", "")
	root := t.TempDir()
	t.Setenv("AIC_CUA_BUNDLE_DIR", root)
	want := filepath.Join(root, filepath.FromSlash(driverBinary()))
	if got := resolveDriver(); got != want {
		t.Fatalf("driver = %q, want %q", got, want)
	}
}

func TestDriverBinaryIsNotEmpty(t *testing.T) {
	if driverBinary() == "" {
		t.Fatal("driver binary must be defined for this platform")
	}
}
