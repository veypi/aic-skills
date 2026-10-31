package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// service 持有 MCP 服务与（懒启动的）浏览器实例。
type service struct {
	opts launchOptions

	refs refTable // 最近一次快照的 @ref 表

	mu       sync.Mutex
	attachMu sync.Mutex
	browser  *Browser

	dialogMu sync.Mutex
	dialog   *pendingDialog // 页面上挂着的 JS 对话框

	// 画面推送：CDP screencast 推帧，页面 ack 之后才推下一帧。
	castMu                sync.Mutex
	castSession           string                      // 当前开着 screencast 的页面会话
	castSeq               uint64                      // 帧序号
	castPeers             map[*browserStreamPeer]bool // 订阅画面的流连接
	castPending           map[uint64]*castPending     // 在途帧的确认状态
	castViewportW         float64                     // 最近一帧的视口宽（CSS 像素）
	castViewportH         float64                     // 最近一帧的视口高（CSS 像素）
	castStatFrames        int                         // 自检：收到的帧数
	castStatBytes         int                         // 自检：收到的字节数
	castStatSent          int                         // 自检：发给订阅者的帧数
	castStatWritten       int                         // 自检：已写到 socket 的帧数
	castStatWrittenBytes  int                         // 自检：已写到 socket 的字节数
	castStatAcks          int                         // 自检：页面确认的帧数
	castStatAckFailed     int                         // 自检：ack Chrome 失败次数
	castStatDropped       int                         // 自检：订阅者不消费而丢弃的帧数
	castStatEvicted       int                         // 自检：摘掉的僵尸订阅者数
	castStatAckRTT        int64                       // 自检：页面确认往返的总耗时（纳秒）
	castStatAckRTTSamples int                         // 自检：往返耗时样本数

	// 视口尺寸缓存：鼠标事件要拿视口尺寸换算坐标，而滚动时每秒上百个事件，
	// 每个事件都发一次 CDP 去问视口会把输入管道堵住（滚动卡顿）。视口只会在
	// 尺寸变化时变，缓存一小会儿就够。
	viewportMu      sync.Mutex
	viewportSession string // 缓存按页面 key 化：切页后不能用上一页的宽高换算坐标
	viewportW       float64
	viewportH       float64
	viewportAt      time.Time
	viewportValid   bool
}

// pendingDialog 是页面上待应答的 JS 对话框（alert / confirm / prompt）。
type pendingDialog struct {
	Type          string `json:"type"`
	Message       string `json:"message"`
	DefaultPrompt string `json:"defaultPrompt"`
}

func newService(opts launchOptions) *service { return &service{opts: opts} }

// setDialog 记录（清除）当前挂起的对话框。
func (s *service) setDialog(dialog *pendingDialog) {
	s.dialogMu.Lock()
	defer s.dialogMu.Unlock()
	s.dialog = dialog
}

// currentDialog 返回当前挂起的对话框（没有就返回 nil）。
func (s *service) currentDialog() *pendingDialog {
	s.dialogMu.Lock()
	defer s.dialogMu.Unlock()
	if s.dialog == nil {
		return nil
	}
	out := *s.dialog
	return &out
}

func (s *service) server() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "browser",
		Title:   "AIC thin CDP channel for Chrome",
		Version: "0.1.0",
	}, nil)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "cdp",
		Description: "Send one raw Chrome DevTools Protocol command and return its raw result. Any CDP domain is available here; use it for anything the convenience tools do not cover.",
	}, s.toolCDP)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "targets",
		Description: "List browser targets (pages, workers) with their ids, types, titles and URLs.",
	}, s.toolTargets)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "attach",
		Description: "Bind a page target as the current session for later calls (Runtime.evaluate, Page.navigate, ...).",
	}, s.toolAttach)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "eval",
		Description: "Evaluate JavaScript in the currently bound page and return the value.",
	}, s.toolEval)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "navigate",
		Description: "Navigate the bound page to a URL and wait until the document finished loading.",
	}, s.toolNavigate)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "snapshot",
		Description: "Accessibility tree of the bound page with element references (e1, e2, ...) usable by click and fill.",
	}, s.toolSnapshot)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "click",
		Description: "Click an element by reference from the latest snapshot.",
	}, s.toolClick)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "fill",
		Description: "Type text into an element by reference from the latest snapshot.",
	}, s.toolFill)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "screenshot",
		Description: "Capture a PNG screenshot of the bound page and return it as an image.",
	}, s.toolScreenshot)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "cast_stats",
		Description: "Report current screen-stream state: bound session, screencast session, subscriber count, frames received from Chrome and frames written to subscribers.",
	}, s.toolCastStats)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "dialog_status",
		Description: "Report the JavaScript dialog currently open in the bound page, if any.",
	}, s.toolDialogStatus)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "dialog_answer",
		Description: "Accept or dismiss the JavaScript dialog open in the bound page.",
	}, s.toolDialogAnswer)
	return srv
}

// browserLevelDomains 是浏览器级 CDP 域：这些命令只能发给浏览器会话，
// 其余域（Page/Runtime/DOM/Network/Input/…）属于页面会话。
var browserLevelDomains = map[string]bool{
	"Target": true, "Browser": true, "SystemInfo": true, "Tracing": true,
	"IO": true, "Memory": true, "DevTools": true, "Inspector": true,
	"HeapProfiler": true, "Autofill": true,
}

// browserLevelMethod 判定命令是否属于浏览器级域。
func browserLevelMethod(method string) bool {
	domain, _, _ := strings.Cut(method, ".")
	return browserLevelDomains[domain]
}

// ensure 懒启动浏览器：第一次真正需要 CDP 时才拉 Chrome。
// 已死的浏览器（Chrome 崩了/被杀）会被重新拉起。
func (s *service) ensure(ctx context.Context) (*Browser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.browser != nil {
		if !s.browser.IsClosed() {
			return s.browser, nil
		}
		_ = s.browser.Close()
		s.browser = nil
	}
	// 用户给了 CDP 地址就接入他自己的浏览器（不起本地进程，Close 只断连）；
	// 否则自己懒启动一个 Chrome。
	var b *Browser
	var err error
	if s.opts.CDPURL != "" {
		b, err = Connect(ctx, s.opts.CDPURL)
	} else {
		b, err = Launch(ctx, s.opts)
	}
	if err != nil {
		return nil, err
	}
	// 新浏览器：旧的画面状态作废。
	s.resetCast()
	// 页面里的 JS 对话框只在 CDP 事件里出现：记下来，UI/AI 才能应答。
	b.OnEvent(func(method string, sessionID string, params json.RawMessage) {
		switch method {
		case "Page.javascriptDialogOpening":
			var payload struct {
				Type          string `json:"type"`
				Message       string `json:"message"`
				DefaultPrompt string `json:"defaultPrompt"`
			}
			if err := json.Unmarshal(params, &payload); err != nil {
				return
			}
			s.setDialog(&pendingDialog{Type: payload.Type, Message: payload.Message, DefaultPrompt: payload.DefaultPrompt})
		case "Page.javascriptDialogClosed":
			s.setDialog(nil)
		case "Page.screencastFrame":
			// 实时帧：Chrome 合成器推过来的，不是轮询截图。
			s.onCastFrame(sessionID, params)
		case "Target.targetDestroyed":
			// 画面挂在刚销毁的页面上：清掉它的 cast 状态。
			s.onTargetDestroyed(sessionID)
		}
	})
	s.browser = b
	return b, nil
}

// currentBrowser 返回当前浏览器实例（没起来时为 nil）。
func (s *service) currentBrowser() *Browser {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.browser
}

// Close 关闭浏览器。
func (s *service) Close() {
	s.mu.Lock()
	b := s.browser
	s.browser = nil
	s.mu.Unlock()
	if b != nil {
		_ = b.Close()
	}
}

type cdpInput struct {
	targetInput
	Method    string         `json:"method" jsonschema:"CDP method name, for example Page.navigate, DOM.getDocument, Network.getCookies"`
	Params    map[string]any `json:"params,omitempty" jsonschema:"parameters of the CDP method"`
	SessionID string         `json:"session_id,omitempty" jsonschema:"raw page session id; prefer target_id for normal calls"`
}

func (s *service) toolCDP(ctx context.Context, _ *mcp.CallToolRequest, in cdpInput) (*mcp.CallToolResult, any, error) {
	if strings.TrimSpace(in.Method) == "" {
		return nil, nil, fmt.Errorf("method is required")
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session := in.SessionID
	if browserLevelMethod(in.Method) {
		// 浏览器级命令（Target/Browser/…）只能发给浏览器会话。
		session = ""
	} else if session == "" {
		session, err = s.pageSession(ctx, b, in.TargetID)
		if err != nil {
			return nil, nil, err
		}
	}
	result, err := b.Call(ctx, in.Method, in.Params, session)
	if err != nil {
		return nil, nil, fmt.Errorf("%w (chrome stderr: %s)", err, b.Stderr())
	}
	return textResult(result), nil, nil
}

type attachInput struct {
	TargetID string `json:"target_id" jsonschema:"target id from the targets tool"`
}

func (s *service) toolAttach(ctx context.Context, _ *mcp.CallToolRequest, in attachInput) (*mcp.CallToolResult, any, error) {
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.attachTarget(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	result, _ := json.Marshal(map[string]string{"targetId": in.TargetID, "sessionId": session})
	return textResult(result), nil, nil
}

type evalInput struct {
	targetInput
	Expression   string `json:"expression" jsonschema:"JavaScript expression evaluated in the target page"`
	AwaitPromise bool   `json:"await_promise,omitempty" jsonschema:"await a promise result before returning"`
}

func (s *service) toolEval(ctx context.Context, _ *mcp.CallToolRequest, in evalInput) (*mcp.CallToolResult, any, error) {
	if strings.TrimSpace(in.Expression) == "" {
		return nil, nil, fmt.Errorf("expression is required")
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	result, err := b.Call(ctx, "Runtime.evaluate", map[string]any{
		"expression":    in.Expression,
		"returnByValue": true,
		"awaitPromise":  in.AwaitPromise,
	}, session)
	if err != nil {
		return nil, nil, err
	}
	return textResult(result), nil, nil
}

type navigateInput struct {
	targetInput
	URL  string `json:"url" jsonschema:"URL to open in the target page"`
	Wait *bool  `json:"wait,omitempty" jsonschema:"wait until the document finished loading (default true)"`
}

func (s *service) toolNavigate(ctx context.Context, _ *mcp.CallToolRequest, in navigateInput) (*mcp.CallToolResult, any, error) {
	if strings.TrimSpace(in.URL) == "" {
		return nil, nil, fmt.Errorf("url is required")
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	result, err := b.Call(ctx, "Page.navigate", map[string]any{"url": in.URL}, session)
	if err != nil {
		return nil, nil, err
	}
	if in.Wait == nil || *in.Wait {
		if err := s.waitLoaded(ctx, b, session); err != nil {
			return nil, nil, err
		}
	}
	// 换文档之后旧的画面通路失效：重启 screencast。
	s.restartCast(ctx, b, session)
	return textResult(result), nil, nil
}

// waitLoaded 轮询文档状态直到加载完成（本通道丢弃 CDP 事件，用轮询代替等待）。
func (s *service) waitLoaded(ctx context.Context, b *Browser, session string) error {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		result, err := b.Call(ctx, "Runtime.evaluate", map[string]any{
			"expression":    "document.readyState",
			"returnByValue": true,
		}, session)
		if err != nil {
			return err
		}
		var payload struct {
			Result struct {
				Value string `json:"value"`
			} `json:"result"`
		}
		if err := json.Unmarshal(result, &payload); err == nil && payload.Result.Value == "complete" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("page did not finish loading within 30s")
}

func (s *service) toolTargets(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	result, err := b.Call(ctx, "Target.getTargets", nil, "")
	if err != nil {
		return nil, nil, err
	}
	return textResult(result), nil, nil
}

// toolDialogStatus 报告当前挂起的 JS 对话框（没有就 hasDialog=false）。
func (s *service) toolDialogStatus(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	dialog := s.currentDialog()
	if dialog == nil {
		return textResult(json.RawMessage(`{"hasDialog":false}`)), nil, nil
	}
	payload, err := json.Marshal(map[string]any{
		"hasDialog": true, "type": dialog.Type,
		"message": dialog.Message, "defaultPrompt": dialog.DefaultPrompt,
	})
	if err != nil {
		return nil, nil, err
	}
	return textResult(payload), nil, nil
}

type dialogAnswerInput struct {
	targetInput
	Accept bool   `json:"accept" jsonschema:"true accepts the dialog, false dismisses it"`
	Text   string `json:"text,omitempty" jsonschema:"text to fill in for a prompt dialog"`
}

// toolDialogAnswer 应答当前挂起的 JS 对话框。
func (s *service) toolDialogAnswer(ctx context.Context, _ *mcp.CallToolRequest, in dialogAnswerInput) (*mcp.CallToolResult, any, error) {
	if s.currentDialog() == nil {
		return nil, nil, fmt.Errorf("no javaScript dialog is open")
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	params := map[string]any{"accept": in.Accept}
	if in.Text != "" {
		params["promptText"] = in.Text
	}
	if _, err := b.Call(ctx, "Page.handleJavaScriptDialog", params, session); err != nil {
		return nil, nil, err
	}
	s.setDialog(nil)
	return textResult(json.RawMessage(`{"answered":true}`)), nil, nil
}

// textResult 把原始 JSON 回给调用方。
func textResult(raw json.RawMessage) *mcp.CallToolResult {
	var pretty any
	if err := json.Unmarshal(raw, &pretty); err == nil {
		if out, err := json.MarshalIndent(pretty, "", "  "); err == nil {
			raw = out
		}
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(raw)}}}
}
