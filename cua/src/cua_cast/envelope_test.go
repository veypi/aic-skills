package main

import (
	"bytes"
	"encoding/binary"
	"testing"
	"testing/iotest"
)

type chunkWriter struct {
	bytes.Buffer
	max int
}

func (w *chunkWriter) Write(p []byte) (int, error) {
	if len(p) > w.max {
		p = p[:w.max]
	}
	return w.Buffer.Write(p)
}

func TestEnvelopeFragmentation(t *testing.T) {
	payload := []byte("fragmented H264 control payload")
	writer := &chunkWriter{max: 2}
	if err := writeEnvelope(writer, msgControl, 42, payload); err != nil {
		t.Fatal(err)
	}
	raw := writer.Bytes()
	if len(raw) != envelopeHeader+len(payload) {
		t.Fatalf("packet length = %d", len(raw))
	}
	if got := binary.BigEndian.Uint32(raw[1:5]); got != uint32(len(payload)) {
		t.Fatalf("payload length = %d", got)
	}
	kind, seq, got, err := readEnvelope(iotest.OneByteReader(bytes.NewReader(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if kind != msgControl || seq != 42 || !bytes.Equal(got, payload) {
		t.Fatalf("decoded envelope = kind %d seq %d payload %q", kind, seq, got)
	}
}

func TestEnvelopeRejectsOversize(t *testing.T) {
	if err := writeEnvelope(&bytes.Buffer{}, msgFrame, 1, make([]byte, maxStreamPayload+1)); err == nil {
		t.Fatal("oversize payload was accepted")
	}
	header := make([]byte, envelopeHeader)
	header[0] = msgFrame
	binary.BigEndian.PutUint32(header[1:5], maxStreamPayload+1)
	if _, _, _, err := readEnvelope(bytes.NewReader(header)); err == nil {
		t.Fatal("oversize header was accepted")
	}
}

func TestFramePayloadHeader(t *testing.T) {
	au := []byte{0, 0, 0, 1, 0x65, 1, 2, 3}
	payload, err := framePayload(castFrame{seq: 9, au: au, width: 1920, height: 1080, ptsMS: 123456, idr: true})
	if err != nil {
		t.Fatal(err)
	}
	if payload[0]&1 == 0 {
		t.Fatal("IDR flag not set")
	}
	if got := binary.BigEndian.Uint16(payload[1:3]); got != 1920 {
		t.Fatalf("width = %d", got)
	}
	if got := binary.BigEndian.Uint16(payload[3:5]); got != 1080 {
		t.Fatalf("height = %d", got)
	}
	if got := binary.BigEndian.Uint32(payload[5:9]); got != 123456 {
		t.Fatalf("pts = %d", got)
	}
	if !bytes.Equal(payload[9:], au) {
		t.Fatal("access unit changed")
	}
}
