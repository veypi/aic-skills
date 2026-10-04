package cua

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"math"
	"os/exec"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/veypi/aic-skills/sdk/go/ui"
)

type coordinateCall struct {
	Name string         `json:"name"`
	Args map[string]any `json:"arguments"`
}

// Exercise Run -> CLI decoding -> JSON fields -> native actor -> MCP JSON.
// The fake driver captures actual wire arguments without touching the desktop.
func coordinateCLI(t *testing.T) (*Service, func() []coordinateCall) {
	t.Helper()
	requests, stdin := io.Pipe()
	stdout, responses := io.Pipe()
	m := newCuaMcp("coordinate-fixture", t.Logf)
	m.stdin, m.cmd, m.alive = stdin, &exec.Cmd{}, true
	s := &Service{driver: m, native: newNativeUI()}
	s.native.identity = func(context.Context, int) (string, error) { return "fixture", nil }
	var mu sync.Mutex
	var calls []coordinateCall
	var shot bytes.Buffer
	if err := png.Encode(&shot, image.NewRGBA(image.Rect(0, 0, 200, 100))); err != nil {
		t.Fatal(err)
	}
	go m.readLoop(stdout)
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(requests)
		encoder := json.NewEncoder(responses)
		for scanner.Scan() {
			var req struct {
				ID     int            `json:"id"`
				Params coordinateCall `json:"params"`
			}
			if json.Unmarshal(scanner.Bytes(), &req) != nil {
				return
			}
			mu.Lock()
			calls = append(calls, req.Params)
			mu.Unlock()
			data := map[string]any{"status": "ok"}
			var content []mcpContent
			switch req.Params.Name {
			case "list_windows":
				data = map[string]any{"windows": []any{map[string]any{"pid": 1344, "window_id": 132168, "app_name": "Fixture", "title": "Coordinates", "bounds": map[string]any{"x": 10, "y": 20, "width": 200, "height": 100}}}}
			case "get_window_state":
				data = map[string]any{"elements": []any{map[string]any{"role": "AXButton", "label": "Save", "element_token": "token", "element_index": 1}}, "element_count": 1}
				if req.Params.Args["include_screenshot"] == true {
					content = []mcpContent{{Type: "image", MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(shot.Bytes())}}
				}
			}
			if encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"structuredContent": data, "content": content}}) != nil {
				return
			}
		}
	}()
	t.Cleanup(func() {
		stdin.Close()
		requests.Close()
		responses.Close()
		stdout.Close()
		<-done
	})
	return s, func() []coordinateCall {
		mu.Lock()
		defer mu.Unlock()
		var actions []coordinateCall
		for _, call := range calls {
			if call.Name != "list_windows" && call.Name != "get_window_state" {
				actions = append(actions, call)
			}
		}
		return actions
	}
}

func coordinateInvoke(t *testing.T, s *Service, argv ...string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var out, errOut bytes.Buffer
	if code := s.Run(ctx, append(argv, "--json"), "", &out, &errOut); code != 0 {
		t.Fatalf("%v: exit=%d stderr=%s", argv, code, &errOut)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func coordinateWindow(t *testing.T, s *Service) string {
	t.Helper()
	r := coordinateInvoke(t, s, "window.list")
	return r["data"].([]any)[0].(map[string]any)["id"].(string)
}

func TestCLICoordinatesReachDriver(t *testing.T) {
	s, calls := coordinateCLI(t)
	window := coordinateWindow(t, s)
	for _, tc := range []struct {
		name, op, tool string
		flags          []string
		want           []map[string]any
	}{
		{"click-space", "click", "click", []string{"--at", "25,30"}, []map[string]any{{"x": 25.0, "y": 30.0}}},
		{"click-equals-zero", "click", "click", []string{"--at=0,0"}, []map[string]any{{"x": 0.0, "y": 0.0}}},
		{"type", "type", "type_text", []string{"--at=25.5,30.25", "--text", "hello"}, []map[string]any{{"x": 25.5, "y": 30.25, "text": "hello"}}},
		{"press", "press", "press_key", []string{"--at=25,30", "--key", "Enter"}, []map[string]any{{"x": 25.0, "y": 30.0, "key": "return"}}},
		{"move", "move", "move_cursor", []string{"--at=25,30"}, []map[string]any{{"x": 25.0, "y": 30.0}}},
		{"scroll-both-axes", "scroll", "scroll", []string{"--at=25,30", "--dx", "-120", "--dy", "80"}, []map[string]any{{"x": 25.0, "y": 30.0, "direction": "left", "amount": 3.0}, {"x": 25.0, "y": 30.0, "direction": "down", "amount": 2.0}}},
		{"drag", "drag", "drag", []string{"--from_at", "0,0", "--to_at=199,99"}, []map[string]any{{"from_x": 0.0, "from_y": 0.0, "to_x": 199.0, "to_y": 99.0}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			obs := coordinateInvoke(t, s, "window.observe", window, "--image")["observation"].(map[string]any)
			before := len(calls())
			argv := []string{"window." + tc.op, window, "--snapshot", obs["snapshot"].(string)}
			coordinateInvoke(t, s, append(argv, tc.flags...)...)
			got := calls()[before:]
			if len(got) != len(tc.want) {
				t.Fatalf("actions=%+v", got)
			}
			for i, call := range got {
				if call.Name != tc.tool {
					t.Fatalf("tool=%s, want %s", call.Name, tc.tool)
				}
				target := call.Args
				if tc.op == "move" {
					target = call.Args["target"].(map[string]any)
				}
				if target["pid"] != 1344.0 || target["window_id"] != 132168.0 || call.Args["session"] == nil {
					t.Fatalf("target/session lost: %+v", call.Args)
				}
				for key, want := range tc.want[i] {
					if !reflect.DeepEqual(call.Args[key], want) {
						t.Fatalf("%s=%v, want %v; args=%v", key, call.Args[key], want, call.Args)
					}
				}
			}
		})
	}
}

func TestCLIInvalidCoordinatesNeverDispatch(t *testing.T) {
	s, calls := coordinateCLI(t)
	window := coordinateWindow(t, s)
	for _, tc := range []struct {
		name, op, code string
		flags          []string
	}{
		{"fake-snapshot", "click", "stale_ref", []string{"--snapshot", "BOGUS", "--at=25,30"}},
		{"press-fake-snapshot", "press", "stale_ref", []string{"--snapshot", "BOGUS", "--at=25,30", "--key", "Enter"}},
		{"negative", "click", "invalid_argument", []string{"--at=-1,20"}},
		{"edge", "click", "invalid_argument", []string{"--at=200,100"}},
		{"press-outside", "press", "invalid_argument", []string{"--at=9999,9999", "--key", "Enter"}},
		{"nan", "click", "invalid_argument", []string{"--at=NaN,20"}},
		{"infinity", "press", "invalid_argument", []string{"--at=20,+Inf", "--key", "Enter"}},
		{"short", "click", "invalid_argument", []string{"--at=20"}},
		{"fill", "fill", "unsupported", []string{"--at=20,30", "--text", "hello"}},
		{"set", "set", "unsupported", []string{"--at=20,30", "--value", "hello"}},
		{"drag-fake-snapshot", "drag", "stale_ref", []string{"--snapshot", "BOGUS", "--from_at=0,0", "--to_at=20,30"}},
		{"drag-bad-end", "drag", "invalid_argument", []string{"--from_at=0,0", "--to_at=200,100"}},
		{"drag-infinity", "drag", "invalid_argument", []string{"--from_at=0,0", "--to_at=20,Inf"}},
		{"scroll-zero", "scroll", "invalid_argument", []string{"--at=20,30", "--dy", "0"}},
		{"scroll-nan", "scroll", "invalid_argument", []string{"--at=20,30", "--dy", "NaN"}},
		{"scroll-limit-before-first-axis", "scroll", "invalid_argument", []string{"--at=20,30", "--dx", "40", "--dy", "20001"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			obs := coordinateInvoke(t, s, "window.observe", window, "--image")["observation"].(map[string]any)
			before := len(calls())
			argv := []string{"window." + tc.op, window, "--snapshot", obs["snapshot"].(string)}
			out, stderr, code := runCLI(t, s, append(argv, tc.flags...)...)
			if code != 1 || out != "" || !strings.Contains(stderr, tc.code+":") {
				t.Fatalf("exit=%d out=%s err=%s", code, out, stderr)
			}
			if len(calls()) != before {
				t.Fatalf("invalid action reached driver: %+v", calls()[before:])
			}
		})
	}
}

func TestNativeCoordinateRepresentationsAndScaling(t *testing.T) {
	e := newNativeUI()
	session := &nativeSession{driverSession: "fixture"}
	target := &nativeTarget{pid: 1344, window: 132168, snapshot: &nativeSnapshot{id: "snap", width: 200, height: 100, rawWidth: 800, rawHeight: 300}}
	for _, value := range []any{[]float64{25.5, 30}, []any{25.5, 30.0}} {
		args, _, err := e.resolve(context.Background(), session, target, nil, map[string]any{"at": value, "snapshot": "snap"}, nil, nil)
		if err != nil || args["x"] != 102.0 || args["y"] != 90.0 {
			t.Fatalf("%T: args=%v err=%v", value, args, err)
		}
	}
	for _, value := range []any{nil, "25,30", []any{}, []float64{1}, []any{1.0, 2.0, 3.0}, []any{"1", 2.0}, []any{nil, 2.0}, []float64{math.NaN(), 2}, []any{1.0, math.Inf(1)}} {
		_, _, err := e.resolve(context.Background(), session, target, nil, map[string]any{"at": value, "snapshot": "snap"}, nil, nil)
		if ue, ok := err.(*ui.Error); !ok || ue.Code != "invalid_argument" {
			t.Fatalf("malformed point %v admitted: %v", value, err)
		}
	}
	target.bounds = map[string]any{"width": 300}
	_, _, err := e.resolve(context.Background(), session, target, nil, map[string]any{"at": []any{25.0, 30.0}, "snapshot": "snap"}, nil, nil)
	if ue, ok := err.(*ui.Error); !ok || ue.Code != "stale_ref" {
		t.Fatalf("geometry change admitted: %v", err)
	}
}

func TestCLICoordinateSnapshotLifecycle(t *testing.T) {
	s, _ := coordinateCLI(t)
	window := coordinateWindow(t, s)
	obs := coordinateInvoke(t, s, "window.observe", window, "--image")["observation"].(map[string]any)
	snapshot := obs["snapshot"].(string)
	for range 2 {
		coordinateInvoke(t, s, "observation.image.read", window, snapshot)
	}
	r := coordinateInvoke(t, s, "window.click", window, "--snapshot", snapshot, "--at=25,30", "--after", "image")
	next := r["observation"].(map[string]any)["snapshot"].(string)
	if next == snapshot {
		t.Fatal("action reused old snapshot")
	}
	coordinateInvoke(t, s, "observation.image.read", window, next)
	if _, _, code := runCLI(t, s, "observation.image.read", window, snapshot); code == 0 {
		t.Fatal("old image survived action")
	}
	coordinateInvoke(t, s, "window.click", window, "--snapshot", next, "--at=25,30")
	if _, stderr, code := runCLI(t, s, "window.click", window, "--snapshot", next, "--at=25,30"); code != 1 || !strings.Contains(stderr, "stale_ref:") {
		t.Fatalf("old coordinates reused: %d %s", code, stderr)
	}
}
