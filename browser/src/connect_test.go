package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// 完整 ws 端点原样使用，不再去问 /json/version。
func TestResolveCDPURLWebSocketPassthrough(t *testing.T) {
	const raw = "ws://127.0.0.1:9222/devtools/browser/abc"
	got, err := resolveCDPURL(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if got != raw {
		t.Fatalf("url = %q, want %q", got, raw)
	}
}

// http 与裸 host:port 都要经 /json/version 换成浏览器级 WebSocket。
func TestResolveCDPURLFromHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/json/version" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, `{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/xyz"}`)
	}))
	defer srv.Close()
	for _, raw := range []string{srv.URL, strings.TrimPrefix(srv.URL, "http://")} {
		got, err := resolveCDPURL(context.Background(), raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if got != "ws://127.0.0.1:9222/devtools/browser/xyz" {
			t.Fatalf("%s: url = %q", raw, got)
		}
	}
}

// 端点应答异常要报出来，不能静默退回自启动。
func TestResolveCDPURLHTTPErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	if _, err := resolveCDPURL(context.Background(), srv.URL); err == nil {
		t.Fatal("expected an error for a non-200 endpoint")
	}

	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{}`)
	}))
	defer empty.Close()
	if _, err := resolveCDPURL(context.Background(), empty.URL); err == nil {
		t.Fatal("expected an error when webSocketDebuggerUrl is missing")
	}
}

// TestConnectLive 接真实浏览器：BROWSER_TEST_CDP=http://127.0.0.1:9222 时运行。
// 验证 attach 能读到对方的页面，且 Close 之后对方仍然活着（不是我们的进程）。
func TestConnectLive(t *testing.T) {
	addr := os.Getenv("BROWSER_TEST_CDP")
	if addr == "" {
		t.Skip("set BROWSER_TEST_CDP to attach to a live browser")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	b, err := Connect(ctx, addr)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Call(ctx, "Target.getTargets", nil, ""); err != nil {
		t.Fatalf("attached browser did not answer: %v", err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	// Close 只断开我们这条连接：对方的调试端点必须还在。
	probe, err := resolveCDPURL(context.Background(), addr)
	if err != nil {
		t.Fatalf("browser did not survive our Close: %v", err)
	}
	if probe == "" {
		t.Fatal("empty devtools endpoint after Close")
	}
}

// attach 模式不持有本地进程：Close 只断连，没有进程可杀。
func TestConnectDoesNotOwnAProcess(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	b, err := Connect(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"))
	if err != nil {
		t.Fatal(err)
	}
	if b.cmd != nil {
		t.Fatal("attach mode must not hold a Chrome process")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	if !b.IsClosed() {
		t.Fatal("browser should be closed")
	}
}
