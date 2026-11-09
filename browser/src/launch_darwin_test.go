//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChromeAppBundle(t *testing.T) {
	got, err := chromeAppBundle("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
	if err != nil || got != "/Applications/Google Chrome.app" {
		t.Fatalf("app=%q err=%v", got, err)
	}
	if _, err := chromeAppBundle("/usr/bin/chromium"); err == nil {
		t.Fatal("non-app executable accepted for visible macOS launch")
	}
}

func TestChromeProfilePID(t *testing.T) {
	dir := t.TempDir()
	if err := os.Symlink("host-12345", filepath.Join(dir, "SingletonLock")); err != nil {
		t.Fatal(err)
	}
	pid, err := chromeProfilePID(dir)
	if err != nil || pid != 12345 {
		t.Fatalf("pid=%d err=%v", pid, err)
	}
}
