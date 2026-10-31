package main

import (
	"os"
	"path/filepath"
	"testing"
)

// setHome 同时设 HOME 与 USERPROFILE：Windows 上 os.UserHomeDir 读后者，
// 只设 HOME 会让用例在 Windows 拿到真实 home。
func setHome(t *testing.T, home string) {
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

// 默认资料目录必须是固定路径：登录态靠它跨重启保留。
func TestResolveProfileDirDefault(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)
	got, err := resolveProfileDir("")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, ".aic", "chrome-profile")
	if got != want {
		t.Fatalf("default profile = %q, want %q", got, want)
	}
	if info, err := os.Stat(got); err != nil || !info.IsDir() {
		t.Fatalf("profile dir was not created: %v", err)
	}
}

// ~ 要展开：exec 不会替我们展开，用户直接写 ~/... 也必须能用。
func TestResolveProfileDirExpandsHome(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)
	got, err := resolveProfileDir("~/custom-profile")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, "custom-profile"); got != want {
		t.Fatalf("profile = %q, want %q", got, want)
	}
}

// 显式绝对路径原样使用，并确保目录存在。
func TestResolveProfileDirAbsolute(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "profile")
	got, err := resolveProfileDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != dir {
		t.Fatalf("profile = %q, want %q", got, dir)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatalf("profile dir was not created: %v", err)
	}
}
