package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// browser/stream-v2 是本包私有协议：设备↔页面全程二进制。
//
// 平台那层只转发字节（它自己的 [uint32 长度] 记录帧由平台剥掉再交给应用），
// 所以这一层自带定长包头：
//
//	[u8 kind][u32 payloadLen][u64 seq][payload]
//
// kind 1 FRAME   设备→页面：payload 是 JPEG 原始字节
// kind 2 CONTROL 设备→页面：payload 是 UTF-8 JSON（状态、错误、输入回执）
// kind 3 INPUT   页面→设备：payload 是 UTF-8 JSON
// kind 4 ACK     页面→设备：payload 空，seq 是被确认的画面序号
//
// 画面不再走 base64/JSON 往返：CDP 给的 base64 在设备上解一次，页面直接
// createImageBitmap(Blob)。包头自描述，读端按流重组，不依赖 TCP 分段。
//
// 流里只承载两件事：设备→页面的实时画面（FRAME），页面→设备的人工输入
// （INPUT）与画面确认（ACK）。浏览动作（导航、标签页、历史、对话框）一律
// 走 MCP 工具面（cdp / targets / attach / navigate），流里不长成动作清单。
const (
	msgFrame   byte = 1
	msgControl byte = 2
	msgInput   byte = 3
	msgAck     byte = 4
)

// maxStreamPayload 是单包上限：截图帧远小于它。
const maxStreamPayload = 8 << 20

// envelopeHeader 是包头长度：kind(1) + len(4) + seq(8)。
const envelopeHeader = 13

// writeEnvelope 写一个包。头与内容一次写完：转发端按读边界切包，
// 半截包头会让对端读到错的长度。
func writeEnvelope(w io.Writer, kind byte, seq uint64, payload []byte) error {
	if len(payload) > maxStreamPayload {
		return fmt.Errorf("browser stream payload %d is too large", len(payload))
	}
	packet := make([]byte, envelopeHeader+len(payload))
	packet[0] = kind
	binary.BigEndian.PutUint32(packet[1:5], uint32(len(payload)))
	binary.BigEndian.PutUint64(packet[5:13], seq)
	copy(packet[envelopeHeader:], payload)
	for len(packet) > 0 {
		n, err := w.Write(packet)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		packet = packet[n:]
	}
	return nil
}

// readEnvelope 读一个包。按流重组：包头与内容可能被拆到多次读里。
func readEnvelope(r io.Reader) (byte, uint64, []byte, error) {
	var header [envelopeHeader]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return 0, 0, nil, err
	}
	size := binary.BigEndian.Uint32(header[1:5])
	if size > maxStreamPayload {
		return 0, 0, nil, fmt.Errorf("browser stream payload %d is invalid", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, 0, nil, err
	}
	return header[0], binary.BigEndian.Uint64(header[5:13]), payload, nil
}

// browserStreamInput 是页面发来的人工输入：坐标一律用视口归一化值 [0,1]，
// 事件名沿用上游 agent-browser 的流协议（input_mouse / input_keyboard）。
type browserStreamInput struct {
	Type                  string  `json:"type"`
	ID                    uint64  `json:"id,omitempty"` // 页面给的事件号：回执原样带回，延迟按它算
	EventType             string  `json:"eventType,omitempty"`
	X                     float64 `json:"x,omitempty"`
	Y                     float64 `json:"y,omitempty"`
	Button                string  `json:"button,omitempty"`
	Buttons               int     `json:"buttons,omitempty"`
	ClickCount            int     `json:"clickCount,omitempty"`
	DeltaX                float64 `json:"deltaX,omitempty"`
	DeltaY                float64 `json:"deltaY,omitempty"`
	Key                   string  `json:"key,omitempty"`
	Code                  string  `json:"code,omitempty"`
	Text                  string  `json:"text,omitempty"`
	Modifiers             int     `json:"modifiers,omitempty"`
	WindowsVirtualKeyCode int     `json:"windowsVirtualKeyCode,omitempty"`
}

// browserStreamControl 是设备发给页面的控制消息（JSON 正文）。
type browserStreamControl struct {
	Type  string `json:"type"`
	ID    uint64 `json:"id,omitempty"` // 被派发输入的事件号（合并后回执不再一一对应）
	Error string `json:"error,omitempty"`
	// Scope 是错误的作用域：input = 只有这一次输入没派发出去（页面继续用）；
	// session = 画面会话本身出了问题（页面该重开流）。
	Scope string  `json:"scope,omitempty"`
	Event string  `json:"event,omitempty"`
	X     float64 `json:"x,omitempty"`
	Y     float64 `json:"y,omitempty"`
}

// browserInputQueue 是人工输入的待发队列：读循环只负责入队，派发在另一路。
//
// 不能在读循环里同步派发：一次 Input.dispatchMouseEvent 在 Chrome 忙时要几十
// 毫秒，而触控板滚动一秒来上百个事件，串行派发只会让队列无限堆积（2026-10-30
// 实测：120/s 时输入往返 p50 1 秒、max 2 秒），还会把同一读循环里的画面确认
// 一起堵住，帧率跟着掉。
//
// 连续事件必须合并而不是排队：滚轮累加 delta（滚动总量不丢），移动只保最新。
// 离散事件（点击、按键、文本）按顺序保留，不合并、不丢弃。
type browserInputQueue struct {
	mu    sync.Mutex
	items []browserStreamInput
	wake  chan struct{}
}

func newBrowserInputQueue() *browserInputQueue {
	return &browserInputQueue{wake: make(chan struct{}, 1)}
}

// continuousInput 报告这个事件能不能与上一个同类事件合并。
func continuousInput(in browserStreamInput) bool {
	return in.Type == "input_mouse" && (in.EventType == "mouseMoved" || in.EventType == "mouseWheel")
}

// inputQueueLimit 是队列上限：Chrome 卡死时也不能让输入无限堆积。
const inputQueueLimit = 64

func (q *browserInputQueue) push(in browserStreamInput) {
	q.mu.Lock()
	if n := len(q.items); n > 0 {
		last := &q.items[n-1]
		if last.Type == in.Type && last.EventType == in.EventType && continuousInput(in) {
			if in.EventType == "mouseWheel" {
				dx, dy := last.DeltaX+in.DeltaX, last.DeltaY+in.DeltaY
				*last = in
				last.DeltaX, last.DeltaY = dx, dy
			} else {
				*last = in
			}
			q.mu.Unlock()
			q.signal()
			return
		}
	}
	q.items = append(q.items, in)
	if len(q.items) > inputQueueLimit {
		// 先丢最老的连续事件；全是离散事件才丢最老的一条（并留下日志）。
		index := 0
		for i, item := range q.items {
			if continuousInput(item) {
				index = i
				break
			}
		}
		log.Printf("browser: input queue full, drop %s:%s", q.items[index].Type, q.items[index].EventType)
		q.items = append(q.items[:index], q.items[index+1:]...)
	}
	q.mu.Unlock()
	q.signal()
}

func (q *browserInputQueue) signal() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// pop 取下一条待派发的输入；ctx 结束时返回 false。
func (q *browserInputQueue) pop(ctx context.Context) (browserStreamInput, bool) {
	for {
		q.mu.Lock()
		if len(q.items) > 0 {
			in := q.items[0]
			q.items = q.items[1:]
			if len(q.items) == 0 {
				q.items = nil
			}
			q.mu.Unlock()
			return in, true
		}
		q.mu.Unlock()
		select {
		case <-ctx.Done():
			return browserStreamInput{}, false
		case <-q.wake:
		}
	}
}

type browserStreamPeer struct {
	service   *service
	conn      net.Conn
	reader    *bufio.Reader
	writeMu   sync.Mutex
	inputs    *browserInputQueue // 待派发的人工输入（连续事件已合并）
	frames    chan castFrame     // 待发的画面帧（只保最新一帧）
	lastAck   atomic.Int64       // 最近一次页面确认（Unix 纳秒）
	lastFit   atomic.Int64       // 最近一次给过它帧（Unix 纳秒）
	starved   atomic.Bool        // 饥饿：不再喂帧（连接保留，等页面缓过来）
	lastProbe atomic.Int64       // 最近一次探活喂帧的时刻（Unix 纳秒）
}

// markAcked 记一次页面确认：用来判断订阅者是不是还活着。
func (p *browserStreamPeer) markAcked() {
	p.lastAck.Store(time.Now().UnixNano())
}

// markFitted 记一次「给过它一帧」。
func (p *browserStreamPeer) markFitted() {
	p.lastFit.Store(time.Now().UnixNano())
}

// notAckingFor 判断订阅者是不是「有帧在推却一直不确认」。
//
// 只有「刚给过它帧、它却一直不确认」才算数：静态页面没有帧、没有确认，
// 不能因为没确认就停止喂它。
func (p *browserStreamPeer) notAckingFor(timeout time.Duration) bool {
	fitted := p.lastFit.Load()
	if fitted == 0 || time.Since(time.Unix(0, fitted)) > 5*time.Second {
		return false // 最近没给它帧：没有帧自然没有确认
	}
	acked := p.lastAck.Load()
	if acked == 0 {
		return false // 刚连上：给它一个机会
	}
	return time.Since(time.Unix(0, acked)) > timeout
}

// probeDue 该不该给饥饿的订阅者喂一张探活帧：每 castProbeInterval 一张。
//
// 饥饿只是「不确认」，不是「死了」：页面可能只是暂时画不出来（窗口不可见、
// 解码卡住、标签页被冻结）。探活帧让页面有机会补一个确认，链路自己就恢复。
func (p *browserStreamPeer) probeDue() bool {
	last := p.lastProbe.Load()
	now := time.Now().UnixNano()
	if last != 0 && time.Since(time.Unix(0, last)) < castProbeInterval {
		return false
	}
	p.lastProbe.Store(now)
	return true
}

// close 关掉这条连接：写失败时用。关掉后读循环收到 EOF，
// 订阅者会被摘除（removePeer）。
func (p *browserStreamPeer) close() {
	_ = p.conn.Close()
}

func (p *browserStreamPeer) sendControl(value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return writeEnvelope(p.conn, msgControl, 0, raw)
}

// sendFrame 发一帧画面：正文是 JPEG 原始字节，不做 base64。
func (p *browserStreamPeer) sendFrame(seq uint64, jpeg []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return writeEnvelope(p.conn, msgFrame, seq, jpeg)
}

// offerFrame 把一帧排进发送队列。队列里只保最新一帧：
// 慢订阅者不拖住链路，画面宁可跳帧也不堆积。
func (p *browserStreamPeer) offerFrame(frame castFrame) bool {
	p.markFitted()
	select {
	case p.frames <- frame:
		return true
	default:
	}
	// 队列已满：丢掉旧帧，换成最新的。
	select {
	case <-p.frames:
	default:
	}
	select {
	case p.frames <- frame:
		return true
	default:
		return false
	}
}

func (s *service) serveStream(ctx context.Context, address string) error {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		peer := &browserStreamPeer{service: s, conn: conn, reader: bufio.NewReaderSize(conn, 64<<10)}
		go peer.run(ctx)
	}
}

func (p *browserStreamPeer) run(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer p.conn.Close()
	go func() {
		<-ctx.Done()
		_ = p.conn.Close()
	}()

	// 订阅画面：设备用 screencast 推帧，一帧在途，页面 ack 之后才推下一帧。
	p.frames = make(chan castFrame, 1)
	p.service.addPeer(p)
	defer p.service.removePeer(p)
	p.markAcked() // 建连时间当基准：之后一直没确认才算僵尸
	log.Printf("browser: stream peer connected")

	// 绑定页面会话（没有就绑第一个页面目标），并起一路 screencast。
	b, err := p.service.ensure(ctx)
	if err == nil {
		if _, err := p.service.pageSession(ctx, b, ""); err == nil {
			p.service.switchCast(ctx, b, b.Session())
		}
	}

	// 帧的发送、输入的派发、包的读取各走一路：任何一路慢都不能堵住另外两路。
	// 切页由 attachTarget 同步切换画面。
	p.inputs = newBrowserInputQueue()
	go p.writeFrames(ctx)
	go p.dispatchLoop(ctx)

	errCh := make(chan error, 1)
	go func() { errCh <- p.readInputs(ctx) }()
	select {
	case err := <-errCh:
		if err != nil && err != io.EOF {
			// 会话级错误：流本身出了问题，页面该重开流。
			_ = p.sendControl(browserStreamControl{Type: "error", Scope: "session", Error: err.Error()})
		}
	case <-ctx.Done():
	}
}

// writeFrames 把排队的帧写给页面。写失败就结束这一路（连接已断）。
func (p *browserStreamPeer) writeFrames(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-p.frames:
			if err := p.sendFrame(frame.seq, frame.image); err != nil {
				log.Printf("browser: send frame failed: %v", err)
				// 写失败就是死连接：关掉它，让读循环收口、订阅者被摘除。
				p.close()
				return
			}
			p.service.markFrameSent(frame.seq)
			p.service.countWritten(len(frame.image))
		}
	}
}

func (p *browserStreamPeer) readInputs(ctx context.Context) error {
	for {
		kind, seq, payload, err := readEnvelope(p.reader)
		if err != nil {
			return err
		}
		switch kind {
		case msgAck:
			// 页面画完了：设备据此 ack Chrome，Chrome 才会推下一帧。
			// 页面真的确认了：它活着（也解除了饥饿状态）。
			p.service.peerAcked(p, seq, true)
		case msgInput:
			var input browserStreamInput
			if err := json.Unmarshal(payload, &input); err != nil {
				continue
			}
			// 只入队，不在这里派发：同步等 CDP 会让高频输入（滚动）堆成秒级
			// 延迟，还会堵住上面的画面确认。
			p.inputs.push(input)
		default:
			// 未知类型：忽略（协议向前兼容）。
		}
	}
}

// dispatchLoop 逐条派发输入。连续事件在队列里已被合并，所以这里总是处理
// 「最新」的输入：Chrome 慢只会让滚动步长变大，不会让延迟越滚越大。
func (p *browserStreamPeer) dispatchLoop(ctx context.Context) {
	for {
		input, ok := p.inputs.pop(ctx)
		if !ok {
			return
		}
		if err := p.dispatchInput(ctx, input); err != nil {
			// 输入类错误：这一次输入没派发出去，画面链路本身还活着。
			// 作用域标成 input，页面据此只提示一句、不拆流。
			_ = p.sendControl(browserStreamControl{Type: "error", Scope: "input", Error: err.Error()})
			continue
		}
		// 回执带上输入的事件号：合并后回执与发送不再一一对应，页面按 id
		// 算真实往返，不能用先入先出去猜。
		_ = p.sendControl(browserStreamControl{
			Type: "input", ID: input.ID, Event: input.Type + ":" + input.EventType,
			X: input.X, Y: input.Y,
		})
	}
}

// dispatchInput 把页面输入派发到 CDP。
func (p *browserStreamPeer) dispatchInput(ctx context.Context, input browserStreamInput) error {
	switch input.Type {
	case "input_mouse":
		return p.service.streamMouse(ctx, input)
	case "input_keyboard":
		return p.service.streamKey(ctx, input)
	case "text":
		return p.service.streamText(ctx, input.Text)
	default:
		return fmt.Errorf("unknown browser input type %q", input.Type)
	}
}

// viewportSize 取当前页面视口尺寸（CSS 像素）。
//
// 带缓存：鼠标事件要拿它换算坐标，滚动时每秒上百个事件，每个事件都发一次
// CDP 去问视口会把输入管道堵死。视口只会在尺寸变化时变，缓存 2 秒足够。
func (s *service) viewportSize(ctx context.Context, b *Browser, session string) (float64, float64, error) {
	s.viewportMu.Lock()
	if s.viewportValid && s.viewportSession == session && time.Since(s.viewportAt) < viewportCacheTTL {
		width, height := s.viewportW, s.viewportH
		s.viewportMu.Unlock()
		return width, height, nil
	}
	s.viewportMu.Unlock()

	raw, err := b.Call(ctx, "Runtime.evaluate", map[string]any{
		"expression": "({width:innerWidth,height:innerHeight})", "returnByValue": true,
	}, session)
	if err != nil {
		return 0, 0, err
	}
	var viewport struct {
		Result struct {
			Value struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			} `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &viewport); err != nil {
		return 0, 0, err
	}
	width, height := viewport.Result.Value.Width, viewport.Result.Value.Height
	s.viewportMu.Lock()
	s.viewportW, s.viewportH, s.viewportAt, s.viewportValid = width, height, time.Now(), true
	s.viewportSession = session
	s.viewportMu.Unlock()
	return width, height, nil
}

// viewportCacheTTL 是视口缓存的有效期。
const viewportCacheTTL = 2 * time.Second

// streamMouse 派发鼠标事件：坐标是视口归一化值 [0,1]。
func (s *service) streamMouse(ctx context.Context, in browserStreamInput) error {
	if in.X < 0 || in.X > 1 || in.Y < 0 || in.Y > 1 {
		return fmt.Errorf("mouse coordinates must be normalized to [0,1]")
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return err
	}
	session, err := s.pageSession(ctx, b, "")
	if err != nil {
		return err
	}
	width, height, err := s.viewportSize(ctx, b, session)
	if err != nil {
		return err
	}
	eventType := in.EventType
	if eventType == "" {
		eventType = "mousePressed"
	}
	button := in.Button
	if button == "" {
		button = "none"
	}
	buttons := 0
	switch button {
	case "left":
		buttons = 1
	case "right":
		buttons = 2
	case "middle":
		buttons = 4
	}
	if eventType == "mouseMoved" {
		buttons = in.Buttons
	}
	if eventType == "mouseReleased" {
		buttons = 0
	}
	params := map[string]any{
		"type": eventType, "x": in.X * width, "y": in.Y * height,
		"button": button, "buttons": buttons, "clickCount": in.ClickCount,
		"modifiers": in.Modifiers,
	}
	if eventType == "mouseWheel" {
		params["button"] = "none"
		params["buttons"] = 0
		params["deltaX"] = in.DeltaX
		params["deltaY"] = in.DeltaY
	}
	_, err = b.Call(ctx, "Input.dispatchMouseEvent", params, session)
	return err
}

// streamKey 派发键盘事件（keyDown / keyUp / rawKeyDown）。
func (s *service) streamKey(ctx context.Context, in browserStreamInput) error {
	b, err := s.ensure(ctx)
	if err != nil {
		return err
	}
	session, err := s.pageSession(ctx, b, "")
	if err != nil {
		return err
	}
	eventType := in.EventType
	if eventType == "" {
		eventType = "keyDown"
	}
	params := map[string]any{
		"type": eventType, "key": in.Key, "code": in.Code,
		"modifiers": in.Modifiers, "windowsVirtualKeyCode": in.WindowsVirtualKeyCode,
	}
	if in.Text != "" {
		params["text"] = in.Text
	}
	_, err = b.Call(ctx, "Input.dispatchKeyEvent", params, session)
	return err
}

func (s *service) streamText(ctx context.Context, text string) error {
	b, err := s.ensure(ctx)
	if err != nil {
		return err
	}
	session, err := s.pageSession(ctx, b, "")
	if err != nil {
		return err
	}
	_, err = b.Call(ctx, "Input.insertText", map[string]any{"text": text}, session)
	return err
}
