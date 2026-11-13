package main

import (
	"bytes"
	"testing"
)

func annexB(nals ...[]byte) []byte {
	var result []byte
	for _, nal := range nals {
		result = append(result, 0, 0, 0, 1)
		result = append(result, nal...)
	}
	return result
}

func TestAnnexBAccessUnitsAcrossReads(t *testing.T) {
	sps := makeTestSPS(t, 1920, 1080)
	first := annexB([]byte{0x09, 0xf0}, sps, []byte{0x68, 0xce, 0x3c, 0x80}, []byte{0x65, 0x11, 0x22})
	second := annexB([]byte{0x09, 0xe0}, []byte{0x41, 0x33, 0x44})
	stream := append(first, second...)
	decoder := &annexBDecoder{}
	var units []accessUnit
	emit := func(au accessUnit) error {
		units = append(units, au)
		return nil
	}
	for _, value := range stream {
		if err := decoder.Write([]byte{value}, emit); err != nil {
			t.Fatal(err)
		}
	}
	if len(units) != 1 {
		t.Fatalf("before flush: got %d access units, want 1", len(units))
	}
	if err := decoder.Flush(emit); err != nil {
		t.Fatal(err)
	}
	if len(units) != 2 || !units[0].idr || units[1].idr {
		t.Fatalf("unexpected units: %#v", units)
	}
	if !bytes.Equal(units[0].sps, sps) {
		t.Fatal("SPS not retained")
	}
	nals, err := nalUnits(units[0].data)
	if err != nil {
		t.Fatal(err)
	}
	wantTypes := []byte{9, 7, 8, 5}
	if len(nals) != len(wantTypes) {
		t.Fatalf("NAL count = %d", len(nals))
	}
	for i, want := range wantTypes {
		if got := nals[i][0] & 31; got != want {
			t.Fatalf("NAL %d type = %d, want %d", i, got, want)
		}
	}
}

func TestAnnexBPreservesSplitFourByteStartCode(t *testing.T) {
	decoder := &annexBDecoder{}
	var units []accessUnit
	emit := func(au accessUnit) error { units = append(units, au); return nil }
	if err := decoder.Write([]byte{0, 0, 0}, emit); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Write([]byte{1, 0x09, 0xf0, 0, 0, 0, 1, 0x65, 1}, emit); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Flush(emit); err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || !units[0].idr {
		t.Fatalf("split start code lost the access unit: %#v", units)
	}
}

type testBitWriter struct {
	data []byte
	bit  int
}

func (w *testBitWriter) u(value uint64, count int) {
	for i := count - 1; i >= 0; i-- {
		if w.bit%8 == 0 {
			w.data = append(w.data, 0)
		}
		if value>>uint(i)&1 != 0 {
			w.data[len(w.data)-1] |= 1 << uint(7-w.bit%8)
		}
		w.bit++
	}
}

func (w *testBitWriter) ue(value uint64) {
	leading := 0
	for n := value + 1; n > 1; n >>= 1 {
		leading++
	}
	w.u(0, leading)
	w.u(value+1, leading+1)
}

func makeTestSPS(t *testing.T, width, height int) []byte {
	t.Helper()
	if width%16 != 0 || height%16 != 0 && height != 1080 {
		t.Fatalf("unsupported test SPS dimensions %dx%d", width, height)
	}
	w := &testBitWriter{}
	w.u(66, 8) // baseline profile
	w.u(0xc0, 8)
	w.u(30, 8)
	w.ue(0) // seq_parameter_set_id
	w.ue(0) // log2_max_frame_num_minus4
	w.ue(0) // pic_order_cnt_type
	w.ue(0) // log2_max_pic_order_cnt_lsb_minus4
	w.ue(0) // max_num_ref_frames
	w.u(0, 1)
	w.ue(uint64(width/16 - 1))
	codedHeight := height
	if height == 1080 {
		codedHeight = 1088
	}
	w.ue(uint64(codedHeight/16 - 1))
	w.u(1, 1) // frame_mbs_only_flag
	w.u(1, 1) // direct_8x8_inference_flag
	if height == 1080 {
		w.u(1, 1)
		w.ue(0)
		w.ue(0)
		w.ue(0)
		w.ue(4)
	} else {
		w.u(0, 1)
	}
	w.u(1, 1) // rbsp_stop_one_bit
	for w.bit%8 != 0 {
		w.u(0, 1)
	}
	return append([]byte{0x67}, w.data...)
}

func TestParseH264SPS(t *testing.T) {
	sps, err := parseH264SPS(makeTestSPS(t, 1920, 1080))
	if err != nil {
		t.Fatal(err)
	}
	if sps.codec != "avc1.42C01E" || sps.width != 1920 || sps.height != 1080 {
		t.Fatalf("decoded SPS = %#v", sps)
	}
}

func TestRemoveEmulationPrevention(t *testing.T) {
	input := []byte{1, 0, 0, 3, 2, 0, 0, 3, 3, 0, 0, 3, 1}
	want := []byte{1, 0, 0, 2, 0, 0, 3, 0, 0, 1}
	if got := removeEmulationPrevention(input); !bytes.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
