package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	// CDPURL 非空时接入已经在运行的浏览器（BROWSER_CDP_URL），不起本地进程；
	// 上面的启动参数只在自启动模式生效。
	CDPURL string
}

// Browser 持有一个 Chrome 进程与一条 DevTools Protocol 连接。
type Browser struct {
	cmd            *exec.Cmd
	pid            int // open -g 启动的可见实例不是当前进程的子进程
	conn           *websocket.Conn
	targetWSOrigin string
	stderr         *tailBuffer

	mu             sync.Mutex
	writeMu        sync.Mutex
	closeOnce      sync.Once
	nextID         int64
	pending        map[int64]chan cdpResponse
	session        string
	closed         bool
	eventMu        sync.Mutex
	handlers       []func(method string, sessionID string, params json.RawMessage)
	readySessions  map[string]bool            // Chrome 已确认就绪的会话
	targetSessions map[string]string          // targetId → 会话 id
	directSessions map[string]*websocket.Conn // 页面直连 session → 页面 WebSocket
	directSeq      uint64
	pendingSession map[int64]string // 等待中的调用所属 session（直连故障单独回收）
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
		// 可见实例也不能在启动阶段创建窗口并自行激活；页面随后由 CDP 后台创建。
		"--no-startup-window",
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

// defaultBrowserProfile 是默认的 Chrome 资料目录。
//
// 用固定目录而不是临时目录：登录态、cookies、站点权限都活在资料目录里，
// 临时目录意味着每次重启浏览器都从零开始。可用 BROWSER_PROFILE / --profile 改。
const defaultBrowserProfile = "~/.aic/chrome-profile"

// resolveProfileDir 展开 ~ 并建好资料目录（exec 不会替我们展开 ~）。
func resolveProfileDir(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = defaultBrowserProfile
	}
	if dir == "~" || strings.HasPrefix(dir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		dir = filepath.Join(home, strings.TrimPrefix(dir, "~"))
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create chrome profile dir: %w", err)
	}
	return dir, nil
}

// Launch 启动 Chrome 并连上它的 DevTools 端点。
func Launch(ctx context.Context, opts launchOptions) (*Browser, error) {
	if strings.TrimSpace(opts.ChromePath) == "" {
		return nil, errors.New("chrome path is required: pass -chrome or set AIC_BROWSER_PATH")
	}
	profile, err := resolveProfileDir(opts.ProfileDir)
	if err != nil {
		return nil, err
	}
	log.Printf("browser: chrome profile=%s headless=%v", profile, opts.Headless)
	// open -g 的可见实例不属于服务进程组；若服务被强制重启，接管同 profile
	// 的存活实例，而不是重复启动或报 profile in use。
	if port, pagePath, ok := runningDevToolsEndpoint(profile); ok {
		pid, pidErr := chromeProfilePID(profile)
		if pidErr != nil {
			return nil, pidErr
		}
		conn, _, dialErr := websocket.DefaultDialer.DialContext(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", port, pagePath), nil)
		if dialErr == nil {
			b := &Browser{
				pid: pid, conn: conn, targetWSOrigin: fmt.Sprintf("ws://127.0.0.1:%d", port),
				pending: map[int64]chan cdpResponse{}, pendingSession: map[int64]string{},
			}
			go b.readLoop(conn, "")
			log.Printf("browser: adopted running Chrome pid=%d", pid)
			return b, nil
		}
	}
	// 固定资料目录下，上一实例留下的 DevToolsActivePort 是过期端点：不删掉就会
	// 在新 Chrome 写出端点之前读到旧端口，去 dial 一个已经死掉的地址。但文件
	// 也可能属于活着的实例（profile 被另一个 Chrome 占用）：先探端口，只在
	// 确认不可达时才删。
	if err := removeStaleDevToolsPort(profile); err != nil {
		return nil, err
	}
	// Chrome 的 stderr 保留尾巴：它在沙箱里起不来时，日志是唯一的死因线索。
	tail := &tailBuffer{}
	cmd, err := startChrome(opts, profile, tail)
	if err != nil {
		return nil, fmt.Errorf("start chrome: %w", err)
	}
	cleanup := func() {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
			return
		}
		if pid, pidErr := chromeProfilePID(profile); pidErr == nil && pid > 0 {
			if process, processErr := os.FindProcess(pid); processErr == nil {
				_ = process.Kill()
			}
		}
	}
	port, path, err := waitDevToolsEndpoint(ctx, profile)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("%w (chrome stderr: %s)", err, tail.String())
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("dial devtools: %w (chrome stderr: %s)", err, tail.String())
	}
	pid := 0
	if cmd == nil {
		pid, err = chromeProfilePID(profile)
		if err != nil {
			_ = conn.Close()
			cleanup()
			return nil, err
		}
	}
	b := &Browser{
		cmd: cmd, pid: pid, conn: conn, targetWSOrigin: fmt.Sprintf("ws://127.0.0.1:%d", port),
		pending: map[int64]chan cdpResponse{}, pendingSession: map[int64]string{}, stderr: tail,
	}
	go b.readLoop(conn, "")
	return b, nil
}

// Connect 接入一个已经在运行的浏览器（BROWSER_CDP_URL）。
//
// 与 Launch 相对：不起本地进程，Close 只断开连接，绝不动用户的浏览器进程。
// 用户的 Chrome 必须自己带着 --remote-debugging-port 启动（Chrome 136+ 还要求
// 非默认 --user-data-dir，默认资料目录的调试开关会被直接忽略）。
func Connect(ctx context.Context, rawURL string) (*Browser, error) {
	wsURL, err := resolveCDPURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial devtools %s: %w", wsURL, err)
	}
	u, err := url.Parse(wsURL)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("parse devtools websocket: %w", err)
	}
	b := &Browser{
		conn: conn, targetWSOrigin: u.Scheme + "://" + u.Host,
		pending: map[int64]chan cdpResponse{}, pendingSession: map[int64]string{},
	}
	go b.readLoop(conn, "")
	log.Printf("browser: attached to %s", wsURL)
	return b, nil
}

// AttachPage 直连页面级 WebSocket，不使用会在可见 Chrome 上激活窗口的
// Target.attachToTarget。返回值仍是内部 session id，后续所有页面命令无差别复用。
func (b *Browser) AttachPage(ctx context.Context, targetID string) (string, error) {
	if b.targetWSOrigin == "" {
		return "", errors.New("browser target websocket origin is unavailable")
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx,
		b.targetWSOrigin+"/devtools/page/"+targetID, nil)
	if err != nil {
		return "", fmt.Errorf("connect page target %s: %w", targetID, err)
	}
	b.mu.Lock()
	b.directSeq++
	session := fmt.Sprintf("direct-%d-%s", b.directSeq, targetID)
	if b.directSessions == nil {
		b.directSessions = map[string]*websocket.Conn{}
	}
	b.directSessions[session] = conn
	b.mu.Unlock()
	b.rememberTargetSession(targetID, session)
	b.markSessionReady(session)
	go b.readLoop(conn, session)
	return session, nil
}

func ensurePendingSessions(current map[int64]string) map[int64]string {
	if current == nil {
		return map[int64]string{}
	}
	return current
}

func runningDevToolsEndpoint(profile string) (int, string, bool) {
	data, err := os.ReadFile(filepath.Join(profile, "DevToolsActivePort"))
	if err != nil {
		return 0, "", false
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) < 2 {
		return 0, "", false
	}
	var port int
	if _, err := fmt.Sscanf(strings.TrimSpace(lines[0]), "%d", &port); err != nil || port <= 0 {
		return 0, "", false
	}
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 500*time.Millisecond)
	if err != nil {
		return 0, "", false
	}
	_ = conn.Close()
	return port, strings.TrimSpace(lines[1]), true
}

// removeStaleDevToolsPort 清理 profile 里的过期 DevToolsActivePort。文件指向
// 的端口仍在应答说明它是活实例的端点：宁可报错也不删（删了会让那个实例的
// 后续 attach 失败）。
func removeStaleDevToolsPort(profile string) error {
	path := filepath.Join(profile, "DevToolsActivePort")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	line, _, _ := strings.Cut(string(data), "\n")
	port := strings.TrimSpace(line)
	if port != "" {
		conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, 500*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return fmt.Errorf("browser: profile %s is in use by a running Chrome (DevTools port %s); attach to it with BROWSER_CDP_URL or use another profile", profile, port)
		}
	}
	return os.Remove(path)
}

// resolveCDPURL 把用户给的地址规整成浏览器级 WebSocket 端点：
//   - ws(s)://… 原样使用（用户已给出完整端点）；
//   - http(s)://host:port 或裸 host:port → 问 /json/version 拿 webSocketDebuggerUrl。
func resolveCDPURL(ctx context.Context, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("cdp url is required")
	}
	if strings.HasPrefix(raw, "ws://") || strings.HasPrefix(raw, "wss://") {
		return raw, nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse cdp url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("unsupported cdp url scheme %q", u.Scheme)
	}
	// /json/version 是固定端点：用户给的 path/query 没有意义，静默改写会掩盖
	// 写错的地址，明确报错。
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("cdp url must be host:port only, got %q", u.String())
	}
	u.Path, u.RawQuery, u.Fragment = "/json/version", "", ""
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	// 不用 http.DefaultClient（无 Timeout）：MCP 调用 ctx 通常无 deadline，
	// 对端 accept 但不应答会把整个 browser 服务同步卡死。
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("query %s: %w", u, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("query %s: %s", u, resp.Status)
	}
	var meta struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&meta); err != nil {
		return "", fmt.Errorf("decode %s: %w", u, err)
	}
	if meta.WebSocketDebuggerURL == "" {
		return "", fmt.Errorf("%s returned no webSocketDebuggerUrl", u)
	}
	return meta.WebSocketDebuggerURL, nil
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
// directSession 非空表示页面级 WebSocket，连接故障只回收该页面，不杀整个浏览器。
func (b *Browser) readLoop(conn *websocket.Conn, directSession string) {
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if directSession == "" {
				b.failAll(err)
			} else {
				b.failSession(directSession, err)
				b.forgetSession(directSession)
			}
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
			if directSession != "" {
				session = directSession
			}
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
			if msg.Method == "Target.detachedFromTarget" && directSession == "" {
				b.forgetSession(session)
			}
			if msg.Method == "Target.targetDestroyed" && directSession == "" {
				var p struct {
					TargetID string `json:"targetId"`
				}
				if json.Unmarshal(msg.Params, &p) == nil {
					if destroyed := b.onTargetDestroyed(p.TargetID); destroyed != "" {
						// 用销毁前的 session 分发：service 据此停掉挂在死页面上的画面。
						b.dispatchEvent(msg.Method, destroyed, msg.Params)
						continue
					}
				}
			}
			b.dispatchEvent(msg.Method, session, msg.Params)
			continue // 事件：交给处理器，不进等待队列
		}
		b.mu.Lock()
		ch, ok := b.pending[msg.ID]
		delete(b.pending, msg.ID)
		delete(b.pendingSession, msg.ID)
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
// onTargetDestroyed 清理已销毁 target 的本地状态并返回它曾经的 session。
// 不清理的话：targetSessions 残留会让后续 attach 打到死 target（No target
// with given id found）；当前绑定 session 残留会让 pageSession 复用死 session。
func (b *Browser) onTargetDestroyed(targetID string) string {
	b.eventMu.Lock()
	session := b.targetSessions[targetID]
	b.eventMu.Unlock()
	if session == "" {
		return ""
	}
	b.forgetSession(session) // 就绪标记、target 映射与当前绑定 session 一并清
	return session
}

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
	conn := b.directSessions[session]
	delete(b.directSessions, session)
	b.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
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

func (b *Browser) failSession(session string, err error) {
	b.mu.Lock()
	var pending []chan cdpResponse
	for id, ch := range b.pending {
		if b.pendingSession[id] == session {
			pending = append(pending, ch)
			delete(b.pending, id)
			delete(b.pendingSession, id)
		}
	}
	b.mu.Unlock()
	for _, ch := range pending {
		ch <- cdpResponse{Error: &cdpError{Code: -1, Message: err.Error()}}
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
	b.pendingSession = ensurePendingSessions(b.pendingSession)
	b.pendingSession[id] = sessionID
	conn := b.conn
	if direct := b.directSessions[sessionID]; direct != nil {
		conn = direct
		sessionID = "" // 页面 WebSocket 已天然绑定页面，不能再套浏览器 sessionId。
	}
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
		delete(b.pendingSession, id)
		b.mu.Unlock()
		return nil, err
	}
	b.mu.Unlock()

	b.writeMu.Lock()
	err = conn.WriteMessage(websocket.TextMessage, raw)
	b.writeMu.Unlock()
	if err != nil {
		b.mu.Lock()
		delete(b.pending, id)
		delete(b.pendingSession, id)
		b.mu.Unlock()
		return nil, fmt.Errorf("send %s: %w", method, err)
	}
	select {
	case <-ctx.Done():
		b.mu.Lock()
		delete(b.pending, id)
		delete(b.pendingSession, id)
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
		var direct []*websocket.Conn
		for _, pageConn := range b.directSessions {
			direct = append(direct, pageConn)
		}
		cmd := b.cmd
		pid := b.pid
		b.mu.Unlock()
		if conn != nil {
			_ = conn.Close()
		}
		for _, pageConn := range direct {
			_ = pageConn.Close()
		}
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
		} else if pid > 0 {
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	})
	return nil
}
