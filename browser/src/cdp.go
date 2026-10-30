package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// launchOptions 描述一次 Chrome 启动：二进制、资料目录与启动参数。
type launchOptions struct {
	ChromePath    string
	ProfileDir    string
	Headless      bool
	Proxy         string
	SecureOrigins stringList
	ExtraArgs     stringList
	WindowSize    string // 视口尺寸，如 "1280x720"（默认 720p）
}

// Browser 持有一个 Chrome 进程与一条 DevTools Protocol 连接。
type Browser struct {
	cmd    *exec.Cmd
	conn   *websocket.Conn
	stderr *tailBuffer

	mu             sync.Mutex
	writeMu        sync.Mutex
	closeOnce      sync.Once
	nextID         int64
	pending        map[int64]chan cdpResponse
	session        string
	closed         bool
	eventMu        sync.Mutex
	handlers       []func(method string, sessionID string, params json.RawMessage)
	readySessions  map[string]bool   // Chrome 已确认就绪的会话
	targetSessions map[string]string // targetId → 会话 id
}

type cdpResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *cdpError       `json:"error"`
}

type cdpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

// buildChromeArgs 组装 Chrome 启动参数。
//
// secure-origin 必须逐条重复同一个开关：Chrome 的该开关按值列表累积，
// 但写成逗号列表时只有第一项生效（实测），所以这里一条 origin 一个参数。
func buildChromeArgs(opts launchOptions, profile string) []string {
	args := []string{
		"--remote-debugging-port=0",
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		// Chromium 的 Safe Storage 默认走 macOS 钥匙串：每次启动都会弹授权窗
		// （无头/重启场景下反复弹）。测试构建用 mock keychain，不碰系统钥匙串。
		"--use-mock-keychain",
		"--disable-background-networking",
		"--disable-backgrounding-occluded-windows",
		"--disable-component-update",
		"--disable-sync",
		"--disable-extensions",
		"--no-service-autorun",
		"--password-store=basic",
	}
	if opts.Headless {
		args = append(args, "--headless=new")
	}
	for _, origin := range opts.SecureOrigins {
		args = append(args, "--unsafely-treat-insecure-origin-as-secure="+origin)
	}
	if opts.Proxy != "" {
		args = append(args, "--proxy-server="+opts.Proxy)
	}
	// 视口尺寸固定：画面比例要稳定（默认 720p），否则截出来的帧比例随窗口变。
	if size := strings.TrimSpace(opts.WindowSize); size != "" {
		args = append(args, "--window-size="+strings.ReplaceAll(size, "x", ","))
	}
	return append(args, opts.ExtraArgs...)
}

// Launch 启动 Chrome 并连上它的 DevTools 端点。
func Launch(ctx context.Context, opts launchOptions) (*Browser, error) {
	if strings.TrimSpace(opts.ChromePath) == "" {
		return nil, errors.New("chrome path is required: pass -chrome or set AIC_BROWSER_PATH")
	}
	profile := opts.ProfileDir
	if profile == "" {
		dir, err := os.MkdirTemp("", "browser-profile-")
		if err != nil {
			return nil, fmt.Errorf("create profile dir: %w", err)
		}
		profile = dir
	}
	cmd := exec.Command(opts.ChromePath, buildChromeArgs(opts, profile)...)
	// Chrome 的 stderr 保留尾巴：它在沙箱里起不来时，日志是唯一的死因线索。
	tail := &tailBuffer{}
	cmd.Stdout = nil
	cmd.Stderr = tail
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start chrome: %w", err)
	}
	port, path, err := waitDevToolsEndpoint(ctx, profile)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("%w (chrome stderr: %s)", err, tail.String())
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("dial devtools: %w (chrome stderr: %s)", err, tail.String())
	}
	b := &Browser{cmd: cmd, conn: conn, pending: map[int64]chan cdpResponse{}, stderr: tail}
	go b.readLoop()
	return b, nil
}

// tailBuffer 保留写入内容的最后若干字节（Chrome 日志可能很大）。
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

const maxTailBytes = 16 << 10

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > maxTailBytes {
		t.buf = t.buf[len(t.buf)-maxTailBytes:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

// waitDevToolsEndpoint 等待 Chrome 写出 DevToolsActivePort（端口 + 浏览器路径）。
func waitDevToolsEndpoint(ctx context.Context, profile string) (int, string, error) {
	file := filepath.Join(profile, "DevToolsActivePort")
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return 0, "", err
		}
		data, err := os.ReadFile(file)
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(lines) >= 2 {
				var port int
				if _, err := fmt.Sscanf(strings.TrimSpace(lines[0]), "%d", &port); err == nil && port > 0 {
					return port, strings.TrimSpace(lines[1]), nil
				}
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return 0, "", fmt.Errorf("chrome devtools endpoint did not appear in %s", file)
}

// cdpMessage 是从 CDP 读到的一条消息：带 id 的是响应，不带的是事件。
type cdpMessage struct {
	ID        int64           `json:"id"`
	Method    string          `json:"method"`
	SessionID string          `json:"sessionId"`
	Params    json.RawMessage `json:"params"`
	Result    json.RawMessage `json:"result"`
	Error     *cdpError       `json:"error"`
}

// eventSession 取事件所属的 CDP 会话 id。
//
// 扁平会话（Target.attachToTarget 的 flatten:true）下，Chrome 把会话 id 放在
// params.sessionId，顶层 sessionId 是空的。两种模式都兼容：顶层有就用顶层，
// 否则从 params 里取。取错会让带会话的命令带着空 id 发出去，Chrome 直接断连。
//
// 注意：Page.screencastFrame 的 params.sessionId 是「帧会话 id」（整数），
// 不是 CDP 会话 id——它不能用作 CDP 会话。它的 CDP 会话在顶层 sessionId。
func eventSession(msg cdpMessage) string {
	if msg.SessionID != "" {
		return msg.SessionID
	}
	if msg.Method == "Page.screencastFrame" {
		return ""
	}
	var params struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(msg.Params, &params); err == nil {
		return params.SessionID
	}
	return ""
}

// readLoop 分发 CDP 响应：带 id 的进等待队列，事件交给处理器。
func (b *Browser) readLoop() {
	for {
		_, data, err := b.conn.ReadMessage()
		if err != nil {
			b.failAll(err)
			return
		}
		var msg cdpMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("browser: decode cdp message failed: %v (len=%d)", err, len(data))
			continue
		}
		if msg.ID == 0 {
			// 扁平会话（flatten:true）下，事件的会话 id 在 params.sessionId，
			// 顶层 sessionId 是空的。取错会让后续命令带着空会话发出去，
			// Chrome 直接断连（1006），事件通道随之死掉。
			session := eventSession(msg)
			if msg.Method == "Target.attachedToTarget" {
				// 会话就绪信号：收到它之前往该会话发命令会让 Chrome 断连。
				b.markSessionReady(session)
				var p struct {
					SessionID  string `json:"sessionId"`
					TargetInfo struct {
						TargetID string `json:"targetId"`
					} `json:"targetInfo"`
				}
				if json.Unmarshal(msg.Params, &p) == nil {
					b.rememberTargetSession(p.TargetInfo.TargetID, p.SessionID)
				}
			}
			if msg.Method == "Target.detachedFromTarget" {
				b.forgetSession(session)
			}
			b.dispatchEvent(msg.Method, session, msg.Params)
			continue // 事件：交给处理器，不进等待队列
		}
		b.mu.Lock()
		ch, ok := b.pending[msg.ID]
		b.mu.Unlock()
		if !ok {
			continue
		}
		ch <- cdpResponse{Result: msg.Result, Error: msg.Error}
	}
}

// OnEvent 注册 CDP 事件处理器（对话框、screencast 帧之类的事件要靠它才知道）。
// sessionID 是事件所属的会话：扁平会话下事件带自己的 sessionId，ack 必须回原会话。
func (b *Browser) OnEvent(fn func(method string, sessionID string, params json.RawMessage)) {
	b.eventMu.Lock()
	defer b.eventMu.Unlock()
	b.handlers = append(b.handlers, fn)
}

// AwaitSession 等某个会话真正就绪：扁平会话下 Target.attachToTarget 的响应
// 先回，会话随后才由 Target.attachedToTarget 事件确认。在事件到达前就往该
// 会话发命令，Chrome 会直接断连（1006）。
func (b *Browser) AwaitSession(ctx context.Context, session string, timeout time.Duration) error {
	if session == "" {
		return errors.New("session id is required")
	}
	deadline := time.Now().Add(timeout)
	for {
		if b.sessionReady(session) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("cdp session %s did not become ready within %s", session, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// sessionReady 报告会话是否已被 Chrome 确认。
func (b *Browser) sessionReady(session string) bool {
	b.eventMu.Lock()
	defer b.eventMu.Unlock()
	return b.readySessions[session]
}

// SessionReady 报告会话是否已就绪。
func (b *Browser) SessionReady(session string) bool {
	return b.sessionReady(session)
}

// markSessionReady 记录一个已就绪的会话。
func (b *Browser) markSessionReady(session string) {
	if session == "" {
		return
	}
	b.eventMu.Lock()
	defer b.eventMu.Unlock()
	if b.readySessions == nil {
		b.readySessions = map[string]bool{}
	}
	b.readySessions[session] = true
}

// rememberTargetSession 记住 targetId 与会话的对应关系。
func (b *Browser) rememberTargetSession(targetID, session string) {
	if targetID == "" || session == "" {
		return
	}
	b.eventMu.Lock()
	defer b.eventMu.Unlock()
	if b.targetSessions == nil {
		b.targetSessions = map[string]string{}
	}
	b.targetSessions[targetID] = session
}

// TargetSession 查某个 target 已有的会话（没有则空）。
func (b *Browser) TargetSession(targetID string) string {
	b.eventMu.Lock()
	defer b.eventMu.Unlock()
	return b.targetSessions[targetID]
}

// forgetSession 使关闭/分离的会话立即失效，并清除它的当前页身份。
func (b *Browser) forgetSession(session string) {
	if session == "" {
		return
	}
	b.eventMu.Lock()
	delete(b.readySessions, session)
	for targetID, candidate := range b.targetSessions {
		if candidate == session {
			delete(b.targetSessions, targetID)
		}
	}
	b.eventMu.Unlock()
	b.mu.Lock()
	if b.session == session {
		b.session = ""
	}
	b.mu.Unlock()
}

// dispatchEvent 把 CDP 事件分发给已注册的处理器。
func (b *Browser) dispatchEvent(method, sessionID string, params json.RawMessage) {
	if method == "" {
		return
	}
	b.eventMu.Lock()
	handlers := make([]func(string, string, json.RawMessage), len(b.handlers))
	copy(handlers, b.handlers)
	b.eventMu.Unlock()
	for _, fn := range handlers {
		fn(method, sessionID, params)
	}
}

func (b *Browser) failAll(err error) {
	b.mu.Lock()
	pending := b.pending
	b.pending = map[int64]chan cdpResponse{}
	b.closed = true
	b.mu.Unlock()
	for _, ch := range pending {
		ch <- cdpResponse{Error: &cdpError{Code: -1, Message: err.Error()}}
	}
}

// Call 发一条 CDP 命令并等它的响应。sessionID 为空表示浏览器级命令。
func (b *Browser) Call(ctx context.Context, method string, params map[string]any, sessionID string) (json.RawMessage, error) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil, errors.New("browser connection is closed")
	}
	b.nextID++
	id := b.nextID
	ch := make(chan cdpResponse, 1)
	b.pending[id] = ch
	msg := map[string]any{"id": id, "method": method}
	if len(params) > 0 {
		msg["params"] = params
	}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		delete(b.pending, id)
		b.mu.Unlock()
		return nil, err
	}
	conn := b.conn
	b.mu.Unlock()

	b.writeMu.Lock()
	err = conn.WriteMessage(websocket.TextMessage, raw)
	b.writeMu.Unlock()
	if err != nil {
		b.mu.Lock()
		delete(b.pending, id)
		b.mu.Unlock()
		return nil, fmt.Errorf("send %s: %w", method, err)
	}
	select {
	case <-ctx.Done():
		b.mu.Lock()
		delete(b.pending, id)
		b.mu.Unlock()
		return nil, ctx.Err()
	case resp := <-ch:
		if resp.Error != nil {
			return nil, fmt.Errorf("cdp %s failed: %s (code %d)", method, resp.Error.Message, resp.Error.Code)
		}
		if len(resp.Result) == 0 {
			return json.RawMessage("{}"), nil
		}
		return resp.Result, nil
	}
}

// Session 返回当前绑定的页面 session（空表示未绑定）。
func (b *Browser) Session() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.session
}

// SetSession 绑定当前页面 session。
func (b *Browser) SetSession(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.session = id
}

// IsClosed 报告连接是否已断（Chrome 崩了/被杀）。
func (b *Browser) IsClosed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.closed
}

// Stderr 返回 Chrome 日志尾巴。
func (b *Browser) Stderr() string {
	if b.stderr == nil {
		return ""
	}
	return b.stderr.String()
}

// Close 结束连接与 Chrome 进程。连接读循环先标记 closed 也必须能回收资源。
func (b *Browser) Close() error {
	b.closeOnce.Do(func() {
		b.mu.Lock()
		b.closed = true
		conn := b.conn
		cmd := b.cmd
		b.mu.Unlock()
		if conn != nil {
			_ = conn.Close()
		}
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
		}
	})
	return nil
}
