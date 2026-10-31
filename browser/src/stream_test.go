package main

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"
)

// 包头协议 round-trip：kind/seq/payload 原样回来。
func TestEnvelopeRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte{1, 2, 3, 4, 5}
	if err := writeEnvelope(&buf, msgFrame, 42, payload); err != nil {
		t.Fatal(err)
	}
	kind, seq, got, err := readEnvelope(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if kind != msgFrame || seq != 42 || !bytes.Equal(got, payload) {
		t.Fatalf("envelope = kind %d seq %d payload %v", kind, seq, got)
	}
}

// chunkReader 模拟 TCP 分段：每次最多返回 n 字节。
type chunkReader struct {
	r io.Reader
	n int
}

func (c *chunkReader) Read(p []byte) (int, error) {
	if len(p) > c.n {
		p = p[:c.n]
	}
	return c.r.Read(p)
}

// 包头与内容可能被拆到多次读里：必须按流重组，且后续包的边界不错乱。
func TestEnvelopeSplitReads(t *testing.T) {
	var buf bytes.Buffer
	payload := bytes.Repeat([]byte{7}, 100)
	if err := writeEnvelope(&buf, msgControl, 9, payload); err != nil {
		t.Fatal(err)
	}
	if err := writeEnvelope(&buf, msgFrame, 10, []byte("next")); err != nil {
		t.Fatal(err)
	}
	r := &chunkReader{r: &buf, n: 3}
	kind, seq, got, err := readEnvelope(r)
	if err != nil {
		t.Fatal(err)
	}
	if kind != msgControl || seq != 9 || !bytes.Equal(got, payload) {
		t.Fatalf("first envelope = kind %d seq %d len %d", kind, seq, len(got))
	}
	kind, seq, got, err = readEnvelope(r)
	if err != nil {
		t.Fatal(err)
	}
	if kind != msgFrame || seq != 10 || string(got) != "next" {
		t.Fatalf("second envelope = kind %d seq %d payload %q", kind, seq, got)
	}
}

func wheel(id uint64, delta float64) browserStreamInput {
	return browserStreamInput{Type: "input_mouse", EventType: "mouseWheel", ID: id, DeltaY: delta, X: 0.5, Y: 0.5}
}

func move(id uint64, x float64) browserStreamInput {
	return browserStreamInput{Type: "input_mouse", EventType: "mouseMoved", ID: id, X: x, Y: 0.5}
}

func click(id uint64) browserStreamInput {
	return browserStreamInput{Type: "input_mouse", EventType: "mousePressed", ID: id, Button: "left"}
}

// 滚轮合并要保住滚动总量：丢掉增量就等于丢滚动。
func TestInputQueueCoalescesWheelDeltas(t *testing.T) {
	q := newBrowserInputQueue()
	q.push(wheel(1, 100))
	q.push(wheel(2, 120))
	q.push(wheel(3, -30))
	got, ok := q.pop(context.Background())
	if !ok {
		t.Fatal("expected an item")
	}
	if got.DeltaY != 190 {
		t.Fatalf("wheel deltas must add up, got %v", got.DeltaY)
	}
	if got.ID != 3 {
		t.Fatalf("receipt must use the newest event id, got %d", got.ID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, ok := q.pop(ctx); ok {
		t.Fatal("coalesced events must collapse into one")
	}
}

// 移动只保最新：旧位置没有派发价值。
func TestInputQueueKeepsLatestMove(t *testing.T) {
	q := newBrowserInputQueue()
	q.push(move(1, 0.1))
	q.push(move(2, 0.9))
	got, _ := q.pop(context.Background())
	if got.X != 0.9 || got.ID != 2 {
		t.Fatalf("expected the latest move, got %+v", got)
	}
}

// 离散事件不合并，并且卡住连续事件的合并边界。
func TestInputQueueKeepsDiscreteEventsInOrder(t *testing.T) {
	q := newBrowserInputQueue()
	q.push(wheel(1, 100))
	q.push(click(2))
	q.push(wheel(3, 50))
	q.push(wheel(4, 50))
	var order []uint64
	for i := 0; i < 3; i++ {
		got, ok := q.pop(context.Background())
		if !ok {
			t.Fatalf("item %d missing", i)
		}
		order = append(order, got.ID)
	}
	if order[0] != 1 || order[1] != 2 || order[2] != 4 {
		t.Fatalf("unexpected order %v", order)
	}
}

// 队列必须有界：Chrome 卡死时输入不能无限堆积。
func TestInputQueueIsBounded(t *testing.T) {
	q := newBrowserInputQueue()
	for i := 0; i < inputQueueLimit*4; i++ {
		q.push(click(uint64(i + 1)))
	}
	q.mu.Lock()
	n := len(q.items)
	q.mu.Unlock()
	if n > inputQueueLimit {
		t.Fatalf("queue grew to %d items", n)
	}
}

// pop 在没有输入时阻塞，有输入时被唤醒。
func TestInputQueuePopWaitsForInput(t *testing.T) {
	q := newBrowserInputQueue()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan browserStreamInput, 1)
	go func() {
		got, _ := q.pop(ctx)
		done <- got
	}()
	select {
	case <-done:
		t.Fatal("pop returned before any input")
	case <-time.After(50 * time.Millisecond):
	}
	q.push(wheel(7, 10))
	select {
	case got := <-done:
		if got.ID != 7 {
			t.Fatalf("unexpected event %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("pop was not woken up")
	}
}
