package main

import (
	"net"
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

	s.peerAcked(first, 1)
	s.peerAcked(second, 1)

	if second.lastAck.Load() == 0 {
		t.Fatal("后确认的订阅者没有记账：会被误判成僵尸")
	}
	if second.idleTooLong(castPeerIdleTimeout) {
		t.Fatal("后确认的订阅者被误判成僵尸")
	}
}

// 僵尸订阅者要被摘掉：一直给它帧、它却从不确认。
func TestIdlePeerEvicted(t *testing.T) {
	s := &service{}
	peer := &browserStreamPeer{service: s}
	left, right := net.Pipe()
	peer.conn = left
	defer right.Close()
	s.castPeers = map[*browserStreamPeer]bool{peer: true}

	peer.markFitted() // 刚给过它帧
	peer.lastAck.Store(time.Now().Add(-2 * castPeerIdleTimeout).UnixNano())

	s.evictIdlePeers()
	if s.castStatEvicted != 1 {
		t.Fatalf("evicted = %d, want 1", s.castStatEvicted)
	}
	s.evictIdlePeers() // 同一个僵尸只摘一次
	if s.castStatEvicted != 1 {
		t.Fatalf("重复摘除后 evicted = %d, want 1", s.castStatEvicted)
	}

	// 正常确认的订阅者不能被摘。
	peer.lastAck.Store(time.Now().UnixNano())
	peer.evicted.Store(false)
	s.evictIdlePeers()
	if s.castStatEvicted != 1 {
		t.Fatalf("正常订阅者被摘了：evicted = %d, want 1", s.castStatEvicted)
	}
}
