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
	Type  string  `json:"type"`
	Error string  `json:"error,omitempty"`
	Event string  `json:"event,omitempty"`
	X     float64 `json:"x,omitempty"`
	Y     float64 `json:"y,omitempty"`
}

type browserStreamPeer struct {
	service *service
	conn    net.Conn
	reader  *bufio.Reader
	writeMu sync.Mutex
	frames  chan castFrame // 待发的画面帧
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

// offerFrame 把一帧排进发送队列。队列满了就丢这一帧（返回 false）：
// 宁可少一帧，也不要堵住 Chrome 的事件通道。
func (p *browserStreamPeer) offerFrame(frame castFrame) bool {
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
	p.frames = make(chan castFrame, 4)
	p.service.addPeer(p)
	defer p.service.removePeer(p)
	log.Printf("browser: stream peer connected")

	// 绑定页面会话（没有就绑第一个页面目标），并起一路 screencast。
	b, err := p.service.ensure(ctx)
	if err == nil {
		if _, err := p.service.pageSession(ctx, b, ""); err == nil {
			p.service.switchCast(ctx, b, b.Session())
		}
	}

	// 帧的发送与输入的读取各自一路；切页由 attachTarget 同步切换画面。
	go p.writeFrames(ctx)

	errCh := make(chan error, 1)
	go func() { errCh <- p.readInputs(ctx) }()
	select {
	case err := <-errCh:
		if err != nil && err != io.EOF {
			_ = p.sendControl(browserStreamControl{Type: "error", Error: err.Error()})
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
				return
			}
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
			p.service.peerAcked(p, seq)
		case msgInput:
			var input browserStreamInput
			if err := json.Unmarshal(payload, &input); err != nil {
				continue
			}
			if err := p.dispatchInput(ctx, input); err != nil {
				_ = p.sendControl(browserStreamControl{Type: "error", Error: err.Error()})
				continue
			}
			// 回执：UI 侧据此显示“输入已到达设备”，点击不再是无反馈等待。
			_ = p.sendControl(browserStreamControl{
				Type: "input", Event: input.Type + ":" + input.EventType,
				X: input.X, Y: input.Y,
			})
		default:
			// 未知类型：忽略（协议向前兼容）。
		}
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
func (s *service) viewportSize(ctx context.Context, b *Browser, session string) (float64, float64, error) {
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
	return viewport.Result.Value.Width, viewport.Result.Value.Height, nil
}

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
