package main

import (
	"errors"
	"net"
	"os"
	"testing"
	"time"
)

// 多订阅者时每个订阅者的确认都要记账：先确认的那个把 pending 删了，
// 后确认的那个不能因此被当成僵尸（2026-10-30 实测：多开 tab 时后确认的
// 每帧被摘一次，页面反复断流、滚不动）。
func TestMultiPeerAckKeepsPeersAlive(t *testing.T) {
	s := &service{}
	first := &browserStreamPeer{service: s}
	second := &browserStreamPeer{service: s}
	s.castPeers = map[*browserStreamPeer]bool{first: true, second: true}
	s.castPending = map[uint64]*castPending{
		1: {acked: map[*browserStreamPeer]bool{}},
	}

	s.peerAcked(first, 1, true)
	s.peerAcked(second, 1, true)

	if second.lastAck.Load() == 0 {
		t.Fatal("后确认的订阅者没有记账：会被误判成僵尸")
	}
	if second.notAckingFor(castPeerIdleTimeout) {
		t.Fatal("后确认的订阅者被误判成僵尸")
	}
}

// 不确认的订阅者停止喂帧，但不断连。
//
// 断连是重手段：页面只是暂时画不出来（窗口不可见、解码卡住）时断流，用户
// 看到的是画面闪断 + 报错（Byte stream disconnected）。
func TestNotAckingPeerStarvedNotDropped(t *testing.T) {
	s := &service{}
	peer := &browserStreamPeer{service: s}
	left, right := net.Pipe()
	peer.conn = left
	defer right.Close()
	s.castPeers = map[*browserStreamPeer]bool{peer: true}

	peer.markFitted() // 刚给过它帧
	peer.lastAck.Store(time.Now().Add(-2 * castPeerIdleTimeout).UnixNano())

	s.starveIdlePeers()
	if s.castStatStarved != 1 {
		t.Fatalf("starved = %d, want 1", s.castStatStarved)
	}
	if !peer.starved.Load() {
		t.Fatal("不确认的订阅者没有被标记为饥饿")
	}
	// 连接必须还在：断连就是「画面闪断 + 报错」。
	peer.conn.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
	if _, err := peer.conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("饥饿的订阅者被断连了")
	} else if !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("饥饿的订阅者被断连了：%v", err)
	}
	s.starveIdlePeers() // 同一个订阅者只记一次
	if s.castStatStarved != 1 {
		t.Fatalf("重复标记后 starved = %d, want 1", s.castStatStarved)
	}

	// 正常确认的订阅者不能被饥饿。
	peer.lastAck.Store(time.Now().UnixNano())
	peer.starved.Store(false)
	s.starveIdlePeers()
	if s.castStatStarved != 1 {
		t.Fatalf("正常订阅者被饥饿了：starved = %d, want 1", s.castStatStarved)
	}
}

// 页面补一个确认就恢复喂帧：饥饿只是降速，不是断连。
func TestStarvedPeerResumesOnAck(t *testing.T) {
	s := &service{}
	peer := &browserStreamPeer{service: s}
	s.castPeers = map[*browserStreamPeer]bool{peer: true}
	peer.starved.Store(true)

	s.peerAcked(peer, 1, true)

	if peer.starved.Load() {
		t.Fatal("页面确认后仍然饥饿：画面不会恢复")
	}
}
