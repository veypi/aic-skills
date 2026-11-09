package main

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRunningDevToolsEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	dir := t.TempDir()
	content := fmt.Sprintf("%d\n/devtools/browser/test\n", port)
	if err := os.WriteFile(filepath.Join(dir, "DevToolsActivePort"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	gotPort, gotPath, ok := runningDevToolsEndpoint(dir)
	if !ok || gotPort != port || gotPath != "/devtools/browser/test" {
		t.Fatalf("port=%d path=%q ok=%t", gotPort, gotPath, ok)
	}
}
