package main

import (
	"bytes"
	"io"
	"net"
	"testing"
)

func TestEnvelopeRoundTrip(t *testing.T) {
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	payload := []byte{0x00, 0xff, 0x10, 'j', 'p', 'e', 'g', 0x00}
	errCh := make(chan error, 1)
	go func() { errCh <- writeEnvelope(left, msgFrame, 42, payload) }()
	kind, seq, got, err := readEnvelope(right)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
	if kind != msgFrame || seq != 42 {
		t.Fatalf("kind/seq = %d/%d, want %d/42", kind, seq, msgFrame)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("payload = %v, want %v", got, payload)
	}
}

// 包头与正文可能被拆到多次读里：读端必须按流重组。
func TestEnvelopeSplitReads(t *testing.T) {
	var raw bytes.Buffer
	payload := []byte("hello binary payload")
	if err := writeEnvelope(&raw, msgFrame, 7, payload); err != nil {
		t.Fatal(err)
	}
	// 每次只喂 3 字节：包头必然被拆开。
	reader := &chunkReader{data: raw.Bytes(), chunk: 3}
	kind, seq, got, err := readEnvelope(reader)
	if err != nil {
		t.Fatal(err)
	}
	if kind != msgFrame || seq != 7 {
		t.Fatalf("kind/seq = %d/%d, want %d/7", kind, seq, msgFrame)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("payload = %q, want %q", got, payload)
	}
}

// chunkReader 每次 Read 最多返回 chunk 字节，模拟 TCP 分段。
type chunkReader struct {
	data  []byte
	chunk int
	pos   int
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := r.chunk
	if n > len(p) {
		n = len(p)
	}
	if r.pos+n > len(r.data) {
		n = len(r.data) - r.pos
	}
	copy(p, r.data[r.pos:r.pos+n])
	r.pos += n
	return n, nil
}
