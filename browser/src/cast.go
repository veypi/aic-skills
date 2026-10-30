package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"time"
)

// 画面推送用 CDP screencast，不是轮询 Page.captureScreenshot。
//
// Chrome 的 screencast 本身是「拉一下才给一张」：收到 Page.screencastFrame 后
// 必须回 Page.screencastFrameAck，才会推下一帧。把这个 ack 推迟到「页面画完」
// 之后，端到端就只有一帧在途——页面慢就掉帧，绝不会把链路缓冲灌满。
//
// 实测：headless 下动画页面可达 60fps（Chrome 合成器出帧，ack 决定下一帧）。
//
// 帧在链路上是裸 JPEG 字节：CDP 那边给的是 base64（CDP 就是 JSON 协议，改不
// 掉），在设备上解一次就够，页面上不再背 base64。
const (
	castFormatJPEG = "jpeg"
	castQuality    = 60
	castMaxWidth   = 1280
	castMaxHeight  = 720
	// castAckTimeout 是安全阀：页面一直没确认（比如 UI 出错）时也要放行下一帧，
	// 不能让画面彻底停住。正常情况下 ack 只需一个来回。
	castAckTimeout = 3 * time.Second
)

// castPending 是一帧在途的确认状态。
type castPending struct {
	chromeID    int64  // Chrome 的 screencast session id
	pageSession string // 产生这一帧的页面会话
	acked       map[*browserStreamPeer]bool
}

// castFrame 是待发给某个订阅者的一帧。
type castFrame struct {
	seq   uint64
	image []byte
}

// addPeer 登记一个流订阅者。
func (s *service) addPeer(p *browserStreamPeer) {
	s.castMu.Lock()
	defer s.castMu.Unlock()
	if s.castPeers == nil {
		s.castPeers = map[*browserStreamPeer]bool{}
	}
	s.castPeers[p] = true
}

// removePeer 注销订阅者：没人看时停掉 screencast。
//
// 必须停：screencast 会让 Chrome 持续合成 + 设备持续解码，60fps 下能把设备
// CPU 打满，进而把 MCP 调用饿死（界面表现为一直“连接中”）。
func (s *service) removePeer(p *browserStreamPeer) {
	s.castMu.Lock()
	delete(s.castPeers, p)
	empty := len(s.castPeers) == 0
	session := s.castSession
	s.castMu.Unlock()
	if !empty {
		return
	}
	log.Printf("browser: no stream peers; stop screencast on %s", session)
	if b := s.currentBrowser(); b != nil && session != "" {
		s.stopCast(context.Background(), b, session)
	}
	s.castMu.Lock()
	s.castSession = ""
	s.castPending = map[uint64]*castPending{}
	s.castMu.Unlock()
}

// peerAcked 页面确认画完了这一帧。
//
// 任一订阅者确认就 ack Chrome 推下一帧：不等所有订阅者——否则一个不确认的
// 订阅者（比如页面没打开）会把整条画面链路饿死。
func (s *service) peerAcked(p *browserStreamPeer, seq uint64) {
	s.castMu.Lock()
	pending, ok := s.castPending[seq]
	if !ok {
		s.castMu.Unlock()
		return
	}
	if pending.acked[p] {
		s.castMu.Unlock()
		return
	}
	pending.acked[p] = true
	delete(s.castPending, seq)
	s.castMu.Unlock()
	s.ackCastFrame(pending)
}

// ackCastFrame 告诉 Chrome「这帧已经处理完」，它才会推下一帧。
func (s *service) ackCastFrame(pending *castPending) {
	b := s.currentBrowser()
	if b == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := b.Call(ctx, "Page.screencastFrameAck", map[string]any{
		"sessionId": pending.chromeID,
	}, pending.pageSession); err != nil {
		log.Printf("browser: screencast ack failed: %v", err)
	}
}

// onCastFrame 处理 Page.screencastFrame 事件：base64 解成裸 JPEG，转给订阅者。
//
// 帧事件的 sessionId 参数（帧会话 id）只用于 ack 的参数，不当作 CDP 会话用。
func (s *service) onCastFrame(frameSessionID string, params json.RawMessage) {
	var payload struct {
		Data      string `json:"data"`
		SessionID int64  `json:"sessionId"`
		Metadata  struct {
			DeviceWidth  float64 `json:"deviceWidth"`
			DeviceHeight float64 `json:"deviceHeight"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(params, &payload); err != nil {
		return
	}
	image, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil {
		return
	}

	s.castMu.Lock()
	s.castStatFrames++
	s.castStatBytes += len(image)
	// metadata 带视口尺寸（CSS 像素）：鼠标坐标换算不用再问 CDP。
	if payload.Metadata.DeviceWidth > 0 && payload.Metadata.DeviceHeight > 0 {
		s.castViewportW = payload.Metadata.DeviceWidth
		s.castViewportH = payload.Metadata.DeviceHeight
	}

	s.castSeq++
	seq := s.castSeq
	peers := make([]*browserStreamPeer, 0, len(s.castPeers))
	for p := range s.castPeers {
		peers = append(peers, p)
	}
	// ack 必须发回「起 screencast 的那个页面会话」：帧事件自己的 sessionId
	// 是帧会话 id（整数），不是 CDP 会话；拿它 ack 会让 Chrome 收不到，
	// 于是推几帧就停住。
	pageSession := s.castSession
	if pageSession == "" {
		if b := s.currentBrowser(); b != nil {
			pageSession = b.Session()
		}
	}
	pending := &castPending{
		chromeID:    payload.SessionID,
		pageSession: pageSession,
		acked:       map[*browserStreamPeer]bool{},
	}
	if len(peers) > 0 {
		if s.castPending == nil {
			s.castPending = map[uint64]*castPending{}
		}
		s.castPending[seq] = pending
	}
	s.castMu.Unlock()

	if len(peers) == 0 {
		// 没有订阅者也要 ack，否则 Chrome 卡住不再推帧。
		s.ackCastFrame(pending)
		return
	}
	for _, p := range peers {
		if !p.offerFrame(castFrame{seq: seq, image: image}) {
			// 帧没排上（队列满）：算它看过了，否则收不到 ack，Chrome 会停推。
			s.peerAcked(p, seq)
			continue
		}
		s.castMu.Lock()
		s.castStatSent++
		s.castMu.Unlock()
	}
	// 安全阀：页面迟迟不确认也要放行下一帧。
	time.AfterFunc(castAckTimeout, func() { s.expireCast(seq) })
}

// expireCast 帧超时未确认：放行它，别让画面停住。
func (s *service) expireCast(seq uint64) {
	s.castMu.Lock()
	pending, ok := s.castPending[seq]
	if !ok {
		s.castMu.Unlock()
		return
	}
	delete(s.castPending, seq)
	s.castMu.Unlock()
	s.ackCastFrame(pending)
}

// startCast 在给定页面会话上起一路 screencast。
//
// 不调 Page.enable：实测在扁平会话下调它会让 Chrome 直接断连（1006），
// 而 screencast 本身并不需要它。
func (s *service) startCast(ctx context.Context, b *Browser, session string) error {
	_, err := b.Call(ctx, "Page.startScreencast", map[string]any{
		"format":        castFormatJPEG,
		"quality":       castQuality,
		"maxWidth":      castMaxWidth,
		"maxHeight":     castMaxHeight,
		"everyNthFrame": 1,
	}, session)
	if err != nil {
		log.Printf("browser: startScreencast failed: %v", err)
	}
	return err
}

// stopCast 停掉某会话上的 screencast。
func (s *service) stopCast(ctx context.Context, b *Browser, session string) {
	if b == nil || session == "" {
		return
	}
	_, _ = b.Call(ctx, "Page.stopScreencast", nil, session)
}

// switchCast 让画面跟随绑定会话：换页（attach）之后画面要跟着换。
func (s *service) switchCast(ctx context.Context, b *Browser, session string) {
	if session == "" {
		return
	}
	s.castMu.Lock()
	if s.castSession == session {
		s.castMu.Unlock()
		return
	}
	previous := s.castSession
	s.castSession = session
	s.castPending = map[uint64]*castPending{}
	s.castMu.Unlock()
	log.Printf("browser: switch screencast %s -> %s", previous, session)

	if previous != "" {
		s.stopCast(ctx, b, previous)
	}
	if err := s.startCast(ctx, b, session); err != nil {
		s.broadcastControl(browserStreamControl{Type: "error", Error: err.Error()})
	}
}

// restartCast 导航之后重启 screencast：换文档会让旧的画面通路失效。
func (s *service) restartCast(ctx context.Context, b *Browser, session string) {
	if b == nil || session == "" {
		return
	}
	s.castMu.Lock()
	same := s.castSession == session
	s.castMu.Unlock()
	if !same {
		s.switchCast(ctx, b, session)
		return
	}
	s.stopCast(ctx, b, session)
	if err := s.startCast(ctx, b, session); err != nil {
		s.broadcastControl(browserStreamControl{Type: "error", Error: err.Error()})
	}
}

// countWritten 记一帧已写到 socket。
func (s *service) countWritten(n int) {
	s.castMu.Lock()
	defer s.castMu.Unlock()
	s.castStatWritten++
	s.castStatWrittenBytes += n
}

// resetCast 浏览器重启后清掉旧的画面状态。
func (s *service) resetCast() {
	s.castMu.Lock()
	defer s.castMu.Unlock()
	s.castSession = ""
	s.castPending = map[uint64]*castPending{}
}

// broadcastControl 给所有订阅者发一条控制消息。
func (s *service) broadcastControl(control browserStreamControl) {
	s.castMu.Lock()
	peers := make([]*browserStreamPeer, 0, len(s.castPeers))
	for p := range s.castPeers {
		peers = append(peers, p)
	}
	s.castMu.Unlock()
	for _, p := range peers {
		_ = p.sendControl(control)
	}
}
