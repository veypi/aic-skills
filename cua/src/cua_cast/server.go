package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const (
	castPeerIdleTimeout = 30 * time.Second
	castProbeInterval   = 10 * time.Second
	castWriteTimeout    = 10 * time.Second
)

type castFrame struct {
	seq    uint64
	au     []byte
	width  int
	height int
	ptsMS  uint32
	idr    bool
}

type streamServer struct {
	cfg    config
	runner captureRunner

	mu            sync.Mutex
	peers         map[*streamPeer]bool
	captureCancel context.CancelFunc
	captureID     uint64
	captureStart  time.Time
	currentConfig streamConfig
	seq           atomic.Uint64
}

func newStreamServer(cfg config, runner captureRunner) *streamServer {
	if runner == nil {
		runner = runFFmpeg
	}
	return &streamServer{cfg: cfg, runner: runner, peers: make(map[*streamPeer]bool)}
}

func (s *streamServer) serve(ctx context.Context) error {
	if err := validateLoopbackAddress(s.cfg.address); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", s.cfg.address)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", s.cfg.address, err)
	}
	defer listener.Close()
	defer s.closeAll()
	log.Printf("cua_cast listening on %s", listener.Addr())
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
			return fmt.Errorf("accept stream peer: %w", err)
		}
		peer := newStreamPeer(s, conn)
		go peer.run(ctx)
	}
}

func (s *streamServer) addPeer(peer *streamPeer) {
	s.mu.Lock()
	s.peers[peer] = true
	if s.captureCancel == nil {
		s.startCaptureLocked()
	}
	cfg := s.currentConfig
	s.mu.Unlock()
	peer.markAcked()
	if cfg.width > 0 {
		peer.queueConfig(cfg)
	}
	log.Printf("cua_cast peer connected (%d active)", s.peerCount())
}

// startCaptureLocked starts the first capture for a connected peer set. The
// generation prevents an old, exiting FFmpeg from publishing into a new session.
func (s *streamServer) startCaptureLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	s.captureID++
	id := s.captureID
	s.captureCancel = cancel
	s.captureStart = time.Now()
	go s.runCapture(ctx, id)
}

func (s *streamServer) runCapture(ctx context.Context, id uint64) {
	err := s.runner(ctx, s.cfg, captureSink{
		config: func(cfg streamConfig) { s.publishConfig(id, cfg) },
		frame:  func(au accessUnit) { s.publishAU(id, au) },
	})
	if ctx.Err() != nil {
		return
	}
	if err == nil {
		err = fmt.Errorf("capture stopped without an error")
	}
	s.captureFailed(id, err)
}

func (s *streamServer) captureFailed(id uint64, cause error) {
	s.mu.Lock()
	if s.captureID != id || s.captureCancel == nil {
		s.mu.Unlock()
		return
	}
	cancel := s.captureCancel
	s.captureCancel = nil
	s.currentConfig = streamConfig{}
	peers := s.peerSnapshotLocked()
	for _, peer := range peers {
		peer.resetForNextCapture()
	}
	s.mu.Unlock()
	cancel()
	control := streamControl{Type: "error", Scope: "session", Error: cause.Error()}
	for _, peer := range peers {
		peer.queueControl(control)
	}
	log.Printf("cua_cast capture failed: %v", cause)
}

func (s *streamServer) publishConfig(id uint64, cfg streamConfig) {
	s.mu.Lock()
	if s.captureID != id || s.captureCancel == nil {
		s.mu.Unlock()
		return
	}
	s.currentConfig = cfg
	peers := s.peerSnapshotLocked()
	s.mu.Unlock()
	for _, peer := range peers {
		peer.queueConfig(cfg)
	}
}

func (s *streamServer) publishAU(id uint64, au accessUnit) {
	s.mu.Lock()
	if s.captureID != id || s.captureCancel == nil {
		s.mu.Unlock()
		return
	}
	cfg := s.currentConfig
	started := s.captureStart
	peers := s.peerSnapshotLocked()
	s.mu.Unlock()
	if cfg.width == 0 || cfg.height == 0 {
		return
	}
	frame := castFrame{
		seq: s.seq.Add(1), au: au.data, idr: au.idr,
		width: cfg.width, height: cfg.height,
		ptsMS: uint32(time.Since(started) / time.Millisecond),
	}
	for _, peer := range peers {
		peer.offerFrame(frame)
	}
}

func (s *streamServer) removePeer(peer *streamPeer) {
	s.mu.Lock()
	delete(s.peers, peer)
	if len(s.peers) == 0 && s.captureCancel != nil {
		cancel := s.captureCancel
		s.captureCancel = nil
		s.currentConfig = streamConfig{}
		cancel()
	}
	remaining := len(s.peers)
	s.mu.Unlock()
	log.Printf("cua_cast peer disconnected (%d active)", remaining)
}

func (s *streamServer) peerSnapshotLocked() []*streamPeer {
	peers := make([]*streamPeer, 0, len(s.peers))
	for peer := range s.peers {
		peers = append(peers, peer)
	}
	return peers
}

func (s *streamServer) peerCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.peers)
}

func (s *streamServer) closeAll() {
	s.mu.Lock()
	if s.captureCancel != nil {
		s.captureCancel()
		s.captureCancel = nil
	}
	peers := s.peerSnapshotLocked()
	s.mu.Unlock()
	for _, peer := range peers {
		peer.close()
	}
}

type streamPeer struct {
	server  *streamServer
	conn    net.Conn
	reader  *bufio.Reader
	frames  chan castFrame
	control chan []byte

	closeOnce  sync.Once
	stateMu    sync.Mutex
	needIDR    bool
	ackStarved bool
	lastAck    atomic.Int64
	lastFit    atomic.Int64
	lastProbe  atomic.Int64
}

func newStreamPeer(server *streamServer, conn net.Conn) *streamPeer {
	return &streamPeer{
		server: server, conn: conn, reader: bufio.NewReaderSize(conn, 64<<10),
		frames: make(chan castFrame, 1), control: make(chan []byte, 4), needIDR: true,
	}
}

func (p *streamPeer) run(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer p.close()
	p.server.addPeer(p)
	defer p.server.removePeer(p)
	go func() {
		<-ctx.Done()
		_ = p.conn.Close()
	}()
	go p.writeLoop(ctx)
	err := p.readLoop()
	if err != nil && err != io.EOF && ctx.Err() == nil {
		log.Printf("cua_cast peer read failed: %v", err)
	}
}

func (p *streamPeer) close() {
	p.closeOnce.Do(func() { _ = p.conn.Close() })
}

func (p *streamPeer) readLoop() error {
	for {
		kind, _, payload, err := readEnvelope(p.reader)
		if err != nil {
			return err
		}
		switch kind {
		case msgAck:
			if len(payload) != 0 {
				return fmt.Errorf("ACK payload must be empty")
			}
			p.markAcked()
		default:
			// Unknown messages are ignored for forward compatibility.
		}
	}
}

func (p *streamPeer) writeLoop(ctx context.Context) {
	for {
		// Config must precede the first frame whenever both are queued.
		select {
		case payload := <-p.control:
			if err := p.writePacket(msgControl, 0, payload); err != nil {
				p.close()
				return
			}
			continue
		default:
		}
		select {
		case <-ctx.Done():
			return
		case payload := <-p.control:
			if err := p.writePacket(msgControl, 0, payload); err != nil {
				p.close()
				return
			}
		case frame := <-p.frames:
			payload, err := framePayload(frame)
			if err == nil {
				err = p.writePacket(msgFrame, frame.seq, payload)
			}
			if err != nil {
				p.close()
				return
			}
		}
	}
}

func (p *streamPeer) writePacket(kind byte, seq uint64, payload []byte) error {
	_ = p.conn.SetWriteDeadline(time.Now().Add(castWriteTimeout))
	return writeEnvelope(p.conn, kind, seq, payload)
}

func (p *streamPeer) queueConfig(cfg streamConfig) {
	p.queueControl(streamControl{
		Type: "config", Codec: cfg.codec, Width: cfg.width, Height: cfg.height,
		SourceWidth: cfg.sourceWidth, SourceHeight: cfg.sourceHeight, FPS: cfg.fps,
	})
}

func (p *streamPeer) queueControl(control streamControl) {
	payload, err := json.Marshal(control)
	if err != nil {
		return
	}
	select {
	case p.control <- payload:
		return
	default:
	}
	// Control is rare and small. Keep the newest state/error without ever
	// blocking the FFmpeg read loop behind a peer that is not reading.
	select {
	case <-p.control:
	default:
	}
	select {
	case p.control <- payload:
	default:
	}
}

func (p *streamPeer) markAcked() {
	p.lastAck.Store(time.Now().UnixNano())
	p.stateMu.Lock()
	if p.ackStarved {
		// An ACK proves liveness, but P frames from the interrupted GOP are not
		// decodable. Resume only at the following IDR.
		p.ackStarved = false
		p.needIDR = true
	}
	p.stateMu.Unlock()
}

func (p *streamPeer) notAckingFor(timeout time.Duration) bool {
	fitted := p.lastFit.Load()
	if fitted == 0 || time.Since(time.Unix(0, fitted)) > 5*time.Second {
		return false
	}
	acked := p.lastAck.Load()
	return acked != 0 && time.Since(time.Unix(0, acked)) > timeout
}

func (p *streamPeer) probeDue() bool {
	last := p.lastProbe.Load()
	now := time.Now().UnixNano()
	if last != 0 && time.Since(time.Unix(0, last)) < castProbeInterval {
		return false
	}
	p.lastProbe.Store(now)
	return true
}

func (p *streamPeer) drainFrames() {
	select {
	case <-p.frames:
	default:
	}
}

// offerFrame never waits for a socket. Queue pressure discards the rest of the
// current GOP; unlike JPEG, replacing an old P frame with a newer P frame would
// leave the decoder without its reference chain.
func (p *streamPeer) offerFrame(frame castFrame) bool {
	p.stateMu.Lock()
	defer p.stateMu.Unlock()
	if !p.ackStarved && p.notAckingFor(castPeerIdleTimeout) {
		p.ackStarved = true
		p.needIDR = true
		p.drainFrames()
	}
	if p.ackStarved {
		if !frame.idr || !p.probeDue() {
			return false
		}
		// IDR-only probes preserve the browser stream's no-disconnect discipline.
		// A live ACK clears ackStarved; the next IDR then restores normal flow.
		if !p.tryFrame(frame) {
			p.drainFrames()
			if !p.tryFrame(frame) {
				return false
			}
		}
		p.lastFit.Store(time.Now().UnixNano())
		return true
	}
	if p.needIDR && !frame.idr {
		return false
	}
	if !p.tryFrame(frame) {
		p.drainFrames()
		p.needIDR = true
		if !frame.idr || !p.tryFrame(frame) {
			return false
		}
	}
	if frame.idr {
		p.needIDR = false
	}
	p.lastFit.Store(time.Now().UnixNano())
	return true
}

func (p *streamPeer) tryFrame(frame castFrame) bool {
	select {
	case p.frames <- frame:
		return true
	default:
		return false
	}
}

func (p *streamPeer) resetForNextCapture() {
	p.stateMu.Lock()
	p.needIDR = true
	p.ackStarved = false
	p.drainFrames()
	p.stateMu.Unlock()
	p.lastFit.Store(0)
	p.lastProbe.Store(0)
	p.lastAck.Store(time.Now().UnixNano())
}
