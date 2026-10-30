package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestBuildChromeArgs(t *testing.T) {
	opts := launchOptions{
		ChromePath:    "/bin/true",
		Headless:      true,
		Proxy:         "http://127.0.0.1:7897",
		SecureOrigins: stringList{"http://a.internal", "http://b.internal"},
		ExtraArgs:     stringList{"--window-size=1280,720"},
	}
	args := buildChromeArgs(opts, "/tmp/profile")
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"--remote-debugging-port=0",
		"--user-data-dir=/tmp/profile",
		"--use-mock-keychain",
		"--headless=new",
		"--proxy-server=http://127.0.0.1:7897",
		"--window-size=1280,720",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("chrome args missing %q: %v", want, args)
		}
	}
	// 一条 origin 一个参数：Chrome 的该开关写成逗号列表时只有第一项生效。
	secure := 0
	for _, arg := range args {
		if strings.HasPrefix(arg, "--unsafely-treat-insecure-origin-as-secure=") {
			secure++
		}
	}
	if secure != 2 {
		t.Fatalf("want one switch per secure origin, got %d: %v", secure, args)
	}
}

func TestBuildChromeArgsWithoutHeadless(t *testing.T) {
	args := buildChromeArgs(launchOptions{}, "/tmp/profile")
	for _, arg := range args {
		if strings.HasPrefix(arg, "--headless") {
			t.Fatalf("headless must be opt-out: %v", args)
		}
	}
}

func TestBrowserCallRoutesResponseByID(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg struct {
				ID     int64  `json:"id"`
				Method string `json:"method"`
			}
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			out, _ := json.Marshal(map[string]any{
				"id":     msg.ID,
				"result": map[string]any{"method": msg.Method},
			})
			_ = conn.WriteMessage(websocket.TextMessage, out)
		}
	}))
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial fake devtools: %v", err)
	}
	b := &Browser{conn: conn, pending: map[int64]chan cdpResponse{}}
	go b.readLoop()
	defer b.Close()

	result, err := b.Call(context.Background(), "Page.navigate", map[string]any{"url": "https://example.com"}, "")
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	var payload struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if payload.Method != "Page.navigate" {
		t.Fatalf("unexpected result: %s", string(result))
	}
}

func TestBrowserCallReportsCDPError(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg struct {
				ID int64 `json:"id"`
			}
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			out, _ := json.Marshal(map[string]any{
				"id":    msg.ID,
				"error": map[string]any{"code": -32000, "message": "boom"},
			})
			_ = conn.WriteMessage(websocket.TextMessage, out)
		}
	}))
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial fake devtools: %v", err)
	}
	b := &Browser{conn: conn, pending: map[int64]chan cdpResponse{}}
	go b.readLoop()
	defer b.Close()

	if _, err := b.Call(context.Background(), "Page.navigate", nil, ""); err == nil {
		t.Fatal("want cdp error surfaced as a tool error")
	} else if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("unexpected error: %v", err)
	}
}
