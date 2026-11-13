package main

import (
	"encoding/binary"
	"fmt"
	"io"
)

const (
	msgFrame   byte = 1
	msgControl byte = 2
	msgAck     byte = 4
)

const (
	maxStreamPayload = 8 << 20
	envelopeHeader   = 13
	frameHeader      = 9
)

// writeEnvelope writes a complete private stream packet. The packet is built
// before the first Write so a forwarding layer never observes a partial header.
func writeEnvelope(w io.Writer, kind byte, seq uint64, payload []byte) error {
	if len(payload) > maxStreamPayload {
		return fmt.Errorf("cua_cast stream payload %d exceeds %d bytes", len(payload), maxStreamPayload)
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

func readEnvelope(r io.Reader) (kind byte, seq uint64, payload []byte, err error) {
	var header [envelopeHeader]byte
	if _, err = io.ReadFull(r, header[:]); err != nil {
		return 0, 0, nil, err
	}
	size := binary.BigEndian.Uint32(header[1:5])
	if size > maxStreamPayload {
		return 0, 0, nil, fmt.Errorf("cua_cast stream payload %d exceeds %d bytes", size, maxStreamPayload)
	}
	payload = make([]byte, int(size))
	if _, err = io.ReadFull(r, payload); err != nil {
		return 0, 0, nil, err
	}
	return header[0], binary.BigEndian.Uint64(header[5:13]), payload, nil
}

func framePayload(frame castFrame) ([]byte, error) {
	if len(frame.au) > maxStreamPayload-frameHeader {
		return nil, fmt.Errorf("H264 access unit %d exceeds frame payload limit", len(frame.au))
	}
	if frame.width < 0 || frame.width > 65535 || frame.height < 0 || frame.height > 65535 {
		return nil, fmt.Errorf("invalid H264 dimensions %dx%d", frame.width, frame.height)
	}
	payload := make([]byte, frameHeader+len(frame.au))
	if frame.idr {
		payload[0] = 1
	}
	binary.BigEndian.PutUint16(payload[1:3], uint16(frame.width))
	binary.BigEndian.PutUint16(payload[3:5], uint16(frame.height))
	binary.BigEndian.PutUint32(payload[5:9], frame.ptsMS)
	copy(payload[frameHeader:], frame.au)
	return payload, nil
}

type streamControl struct {
	Type         string `json:"type"`
	Codec        string `json:"codec,omitempty"`
	Width        int    `json:"width,omitempty"`
	Height       int    `json:"height,omitempty"`
	SourceWidth  int    `json:"source_width,omitempty"`
	SourceHeight int    `json:"source_height,omitempty"`
	FPS          int    `json:"fps,omitempty"`
	Scope        string `json:"scope,omitempty"`
	Error        string `json:"error,omitempty"`
}
