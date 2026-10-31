package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestNaturalLessOrdersVersions(t *testing.T) {
	if !naturalLess("Blender 4.2", "Blender 4.10") {
		t.Fatal("4.10 must sort after 4.2")
	}
	if naturalLess("Blender 4.10", "Blender 4.2") {
		t.Fatal("4.2 must not sort after 4.10")
	}
}

func TestExpandVars(t *testing.T) {
	t.Setenv("AIC_TEST_ROOT", "/opt/blender")
	got := expandVars("{env:AIC_TEST_ROOT}/app")
	if got != "/opt/blender/app" {
		t.Fatalf("expandVars = %q", got)
	}
	home, _ := os.UserHomeDir()
	if got := expandVars("{home}/x"); got != filepath.Join(home, "x") {
		t.Fatalf("home expansion = %q", got)
	}
}

func TestAddonAddrPortOverride(t *testing.T) {
	t.Setenv("AIC_BLENDER_PORT", "9999")
	if got := addonAddr(); got != "127.0.0.1:9999" {
		t.Fatalf("addonAddr = %q", got)
	}
}

// 图片结果必须变成 MCP 图片内容，agent 才能直接看图。
func TestAddonResultImage(t *testing.T) {
	result := addonResult(map[string]any{
		"mime": "image/png", "image_base64": "aGVsbG8=", "bytes": 5,
	}, false)
	if len(result.Content) != 2 {
		t.Fatalf("content = %d items", len(result.Content))
	}
	image, ok := result.Content[0].(*mcp.ImageContent)
	if !ok {
		t.Fatalf("content[0] = %T, want image", result.Content[0])
	}
	// Data 必须是解码后的原始字节（SDK 序列化时会再 base64 一次）。
	if string(image.Data) != "hello" || image.MIMEType != "image/png" {
		t.Fatalf("image = %+v", image)
	}
	text, ok := result.Content[1].(*mcp.TextContent)
	if !ok || !strings.Contains(text.Text, "bytes") {
		t.Fatalf("metadata must accompany the image: %+v", result.Content[1])
	}
}

// 非法 base64 降级为文本错误，不能塞坏图给 agent。
func TestAddonResultInvalidBase64(t *testing.T) {
	result := addonResult(map[string]any{"image_base64": "!!!not-base64"}, false)
	if !result.IsError {
		t.Fatal("invalid base64 must surface as an error")
	}
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok || !strings.Contains(text.Text, "image_error") {
		t.Fatalf("expected text fallback with image_error: %+v", result.Content[0])
	}
}

// addon 自述的非法 schema 必须被拦下（SDK AddTool 对非 object schema 会 panic）。
func TestValidObjectSchema(t *testing.T) {
	valid := json.RawMessage(`{"type":"object","properties":{}}`)
	if !validObjectSchema(valid) {
		t.Fatal("object schema rejected")
	}
	for _, raw := range []string{`{"type":"string"}`, `{"properties":{}}`, `[1]`, `"x"`, `{`} {
		if validObjectSchema(json.RawMessage(raw)) {
			t.Fatalf("invalid schema accepted: %s", raw)
		}
	}
}

// 起一个假 addon：认证首行 + tools + call，验证客户端协议。
func fakeAddon(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				rd := bufio.NewReader(conn)
				for {
					line, err := rd.ReadBytes('\n')
					if err != nil {
						return
					}
					var req map[string]any
					if err := json.Unmarshal(line, &req); err != nil {
						return
					}
					var rep map[string]any
					switch {
					case req["auth"] != nil:
						if req["auth"] != "secret" {
							rep = map[string]any{"ok": false, "error": "bad token"}
						} else {
							rep = map[string]any{"ok": true}
						}
					case req["method"] == "tools":
						rep = map[string]any{"id": req["id"], "tools": []map[string]any{
							{"name": "ping", "description": "ping", "inputSchema": map[string]any{"type": "object"}},
						}}
					case req["method"] == "call":
						rep = map[string]any{"id": req["id"], "result": map[string]any{"pong": true}}
					default:
						rep = map[string]any{"id": req["id"], "error": "unknown method"}
					}
					data, _ := json.Marshal(rep)
					if _, err := fmt.Fprintf(conn, "%s\n", data); err != nil {
						return
					}
				}
			}(conn)
		}
	}()
	return listener.Addr().String()
}

func TestAddonClientRoundtrip(t *testing.T) {
	addr := fakeAddon(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, err := dialAddon(ctx, addr, "secret")
	if err != nil {
		t.Fatal(err)
	}
	defer client.close()
	tools, err := client.Tools(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 1 || tools[0].Name != "ping" {
		t.Fatalf("tools = %+v", tools)
	}
	result, isError, err := client.Call(ctx, "ping", map[string]any{})
	if err != nil || isError {
		t.Fatalf("call failed: %v", err)
	}
	if result.(map[string]any)["pong"] != true {
		t.Fatalf("result = %v", result)
	}
}

func TestAddonClientRejectsBadToken(t *testing.T) {
	addr := fakeAddon(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := dialAddon(ctx, addr, "wrong"); err == nil {
		t.Fatal("expected an auth error")
	}
}

// addon 源码按包根相对路径找到（cwd = 包根是 pod 的约定）。
func TestAddonSourceFromPackageRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "cli"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "cli", "aic_blender_bridge.py"), []byte("# addon\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	wd, _ := os.Getwd()
	defer func() { _ = os.Chdir(wd) }()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	data, err := addonSource()
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "# addon\n" {
		t.Fatalf("addon source = %q", data)
	}
}
