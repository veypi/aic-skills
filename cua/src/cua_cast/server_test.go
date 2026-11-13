package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func testPeer() *streamPeer {
	return &streamPeer{
		frames: make(chan castFrame, 1), control: make(chan []byte, 4), needIDR: true,
	}
}

func TestPeerWaitsForIDRAndRecoversAfterQueuePressure(t *testing.T) {
	peer := testPeer()
	peer.lastAck.Store(time.Now().UnixNano())
	if peer.offerFrame(castFrame{seq: 1}) {
		t.Fatal("new peer accepted a non-IDR frame")
	}
	if !peer.offerFrame(castFrame{seq: 2, idr: true}) {
		t.Fatal("new peer did not accept IDR")
	}
	<-peer.frames
	if !peer.offerFrame(castFrame{seq: 3}) {
		t.Fatal("normal P frame was rejected")
	}
	if peer.offerFrame(castFrame{seq: 4}) {
		t.Fatal("full queue accepted another P frame")
	}
	if len(peer.frames) != 0 {
		t.Fatal("stale GOP frame remained queued")
	}
	if peer.offerFrame(castFrame{seq: 5}) {
		t.Fatal("peer resumed inside the damaged GOP")
	}
	if !peer.offerFrame(castFrame{seq: 6, idr: true}) {
		t.Fatal("peer did not recover at the next IDR")
	}
	if got := <-peer.frames; got.seq != 6 {
		t.Fatalf("queued seq = %d, want 6", got.seq)
	}
}

func TestStarvedPeerProbesAndResumesOnlyAfterAckAndIDR(t *testing.T) {
	peer := testPeer()
	peer.needIDR = false
	peer.lastFit.Store(time.Now().UnixNano())
	peer.lastAck.Store(time.Now().Add(-castPeerIdleTimeout - time.Second).UnixNano())
	if peer.offerFrame(castFrame{seq: 1}) {
		t.Fatal("unacknowledging peer was not starved")
	}
	if !peer.ackStarved || !peer.needIDR {
		t.Fatalf("peer state = starved %v needIDR %v", peer.ackStarved, peer.needIDR)
	}
	if !peer.offerFrame(castFrame{seq: 2, idr: true}) {
		t.Fatal("starved peer did not receive an IDR probe")
	}
	<-peer.frames
	if peer.offerFrame(castFrame{seq: 3, idr: true}) {
		t.Fatal("probe interval was ignored")
	}
	peer.markAcked()
	if peer.ackStarved || !peer.needIDR {
		t.Fatal("ACK did not arm IDR recovery")
	}
	if peer.offerFrame(castFrame{seq: 4}) {
		t.Fatal("P frame sent before recovery IDR")
	}
	if !peer.offerFrame(castFrame{seq: 5, idr: true}) {
		t.Fatal("peer did not resume at IDR")
	}
}

func TestCaptureStartsOnFirstPeerAndStopsOnLast(t *testing.T) {
	started := make(chan struct{}, 2)
	stopped := make(chan struct{}, 2)
	runner := func(ctx context.Context, _ config, _ captureSink) error {
		started <- struct{}{}
		<-ctx.Done()
		stopped <- struct{}{}
		return nil
	}
	server := newStreamServer(config{}, runner)
	first, second := testPeer(), testPeer()
	first.server, second.server = server, server
	server.addPeer(first)
	waitSignal(t, started, "first capture start")
	server.addPeer(second)
	select {
	case <-started:
		t.Fatal("second peer started another capture")
	default:
	}
	server.removePeer(first)
	select {
	case <-stopped:
		t.Fatal("capture stopped while second peer remained")
	default:
	}
	server.removePeer(second)
	waitSignal(t, stopped, "last peer capture stop")
}

func TestServerPublishesConfigAndFrame(t *testing.T) {
	runner := func(ctx context.Context, _ config, _ captureSink) error {
		<-ctx.Done()
		return nil
	}
	server := newStreamServer(config{fps: 30}, runner)
	peer := testPeer()
	peer.server = server
	server.addPeer(peer)
	cfg := streamConfig{codec: "avc1.640028", width: 1728, height: 1086, sourceWidth: 1728, sourceHeight: 1117, fps: 30}
	server.publishConfig(1, cfg)
	server.publishAU(1, accessUnit{data: []byte{0, 0, 0, 1, 0x65}, idr: true})
	select {
	case raw := <-peer.control:
		var control streamControl
		if err := json.Unmarshal(raw, &control); err != nil {
			t.Fatal(err)
		}
		if control.Type != "config" || control.SourceWidth != 1728 || control.SourceHeight != 1117 || control.Width != 1728 || control.Height != 1086 {
			t.Fatalf("config control = %#v", control)
		}
	case <-time.After(time.Second):
		t.Fatal("config not queued")
	}
	select {
	case frame := <-peer.frames:
		if frame.seq != 1 || frame.width != 1728 || frame.height != 1086 || !frame.idr {
			t.Fatalf("frame = %#v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("frame not queued")
	}
	server.removePeer(peer)
}

func TestCaptureFailureIsSessionError(t *testing.T) {
	cause := make(chan struct{})
	runner := func(ctx context.Context, _ config, _ captureSink) error {
		<-cause
		return context.Canceled
	}
	server := newStreamServer(config{}, runner)
	peer := testPeer()
	peer.server = server
	server.addPeer(peer)
	close(cause)
	select {
	case raw := <-peer.control:
		var control streamControl
		if err := json.Unmarshal(raw, &control); err != nil {
			t.Fatal(err)
		}
		if control.Type != "error" || control.Scope != "session" || control.Error == "" {
			t.Fatalf("error control = %#v", control)
		}
	case <-time.After(time.Second):
		t.Fatal("session error not queued")
	}
	server.removePeer(peer)
}

func waitSignal(t *testing.T, channel <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-channel:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}
