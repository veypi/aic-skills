package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

type fakeCDP struct {
	mu            sync.Mutex
	attachCount   int
	activateCount int
	nextSession   int
	readyCalls    int
}

func (f *fakeCDP) session() string {
	f.nextSession++
	return "session-" + string(rune('A'+f.nextSession-1))
}

func newFakeBrowser(t *testing.T) (*Browser, *fakeCDP) {
	t.Helper()
	fake := &fakeCDP{}
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/devtools/page/") {
			fake.mu.Lock()
			fake.attachCount++
			fake.mu.Unlock()
		}
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
				ID        int64           `json:"id"`
				Method    string          `json:"method"`
				SessionID string          `json:"sessionId"`
				Params    json.RawMessage `json:"params"`
			}
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			result := map[string]any{}
			fake.mu.Lock()
			switch msg.Method {
			case "Target.attachToTarget":
				fake.attachCount++
				session := fake.session()
				var params struct {
					TargetID string `json:"targetId"`
				}
				_ = json.Unmarshal(msg.Params, &params)
				event, _ := json.Marshal(map[string]any{
					"method": "Target.attachedToTarget", "sessionId": session,
					"params": map[string]any{"sessionId": session, "targetInfo": map[string]any{"targetId": params.TargetID}},
				})
				_ = conn.WriteMessage(websocket.TextMessage, event)
				result["sessionId"] = session
			case "Target.activateTarget":
				fake.activateCount++
			case "Runtime.evaluate":
				fake.readyCalls++
				value := "complete"
				if fake.readyCalls == 1 {
					value = "loading"
				}
				result["result"] = map[string]any{"value": value}
			case "Target.getTargets":
				result["targetInfos"] = []map[string]any{{"targetId": "page-a", "type": "page"}}
			}
			fake.mu.Unlock()
			out, _ := json.Marshal(map[string]any{"id": msg.ID, "result": result})
			_ = conn.WriteMessage(websocket.TextMessage, out)
		}
	}))
	t.Cleanup(srv.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	b := &Browser{
		conn: conn, targetWSOrigin: "ws" + strings.TrimPrefix(srv.URL, "http"),
		pending: map[int64]chan cdpResponse{}, pendingSession: map[int64]string{},
	}
	go b.readLoop(conn, "")
	t.Cleanup(func() { _ = b.Close() })
	return b, fake
}

func TestAttachTargetReusesReadySession(t *testing.T) {
	b, fake := newFakeBrowser(t)
	s := &service{}
	first, err := s.attachTarget(context.Background(), b, "page-a")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.attachTarget(context.Background(), b, "page-a")
	if err != nil {
		t.Fatal(err)
	}
	if first == "" || first != second {
		t.Fatalf("sessions = %q / %q", first, second)
	}
	if fake.attachCount != 1 {
		t.Fatalf("attach count = %d, want 1", fake.attachCount)
	}
	if fake.activateCount != 0 {
		t.Fatalf("attach activated the browser window %d times", fake.activateCount)
	}
	b.forgetSession(first)
	third, err := s.attachTarget(context.Background(), b, "page-a")
	if err != nil {
		t.Fatal(err)
	}
	if third == first || fake.attachCount != 2 {
		t.Fatalf("detached session was not replaced: %q -> %q, calls=%d", first, third, fake.attachCount)
	}
}

// 页面销毁后：映射与当前绑定 session 必须清掉，空 target 的页面级调用重新
// 走选页路径，而不是复用死 session（No target with given id found 的来源）。
func TestTargetDestroyedClearsSessionAndMapping(t *testing.T) {
	b, fake := newFakeBrowser(t)
	s := &service{}
	session, err := s.attachTarget(context.Background(), b, "page-a")
	if err != nil {
		t.Fatal(err)
	}
	if got := b.onTargetDestroyed("page-a"); got != session {
		t.Fatalf("destroyed session = %q, want %q", got, session)
	}
	if b.TargetSession("page-a") != "" || b.Session() != "" || b.SessionReady(session) {
		t.Fatal("destroyed target left stale session state")
	}
	if _, err := s.pageSession(context.Background(), b, ""); err != nil {
		t.Fatal(err)
	}
	if fake.attachCount != 2 {
		t.Fatalf("attach count = %d, want 2 (re-attach after destroy)", fake.attachCount)
	}
}

func TestAttachTargetConcurrentCallsShareOneSession(t *testing.T) {
	b, fake := newFakeBrowser(t)
	s := &service{}
	const callers = 8
	sessions := make(chan string, callers)
	errors := make(chan error, callers)
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			session, err := s.attachTarget(context.Background(), b, "page-a")
			sessions <- session
			errors <- err
		}()
	}
	wg.Wait()
	close(sessions)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first string
	for session := range sessions {
		if first == "" {
			first = session
		}
		if session != first {
			t.Fatalf("concurrent attach created different sessions: %q / %q", first, session)
		}
	}
	if fake.attachCount != 1 {
		t.Fatalf("attach count = %d, want 1", fake.attachCount)
	}
}

func TestNavigateWaitsByDefaultAndSupportsExplicitNoWait(t *testing.T) {
	b, fake := newFakeBrowser(t)
	s := &service{browser: b}
	if _, _, err := s.toolNavigate(context.Background(), nil, navigateInput{targetInput: targetInput{TargetID: "page-a"}, URL: "https://example.test"}); err != nil {
		t.Fatal(err)
	}
	if fake.readyCalls < 2 {
		t.Fatalf("default navigate did not poll until complete: %d", fake.readyCalls)
	}
	fake.readyCalls = 0
	wait := false
	if _, _, err := s.toolNavigate(context.Background(), nil, navigateInput{targetInput: targetInput{TargetID: "page-a"}, URL: "https://example.test", Wait: &wait}); err != nil {
		t.Fatal(err)
	}
	if fake.readyCalls != 0 {
		t.Fatalf("wait=false still polled readyState: %d", fake.readyCalls)
	}
}
