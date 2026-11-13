package main

import (
	"bytes"
	"fmt"
)

type accessUnit struct {
	data []byte
	idr  bool
	sps  []byte
}

// annexBDecoder incrementally splits an Annex-B byte stream into access units.
// h264_metadata=aud=insert makes AUD the authoritative boundary. A new IDR after
// a VCL NAL is also accepted as a boundary so a stream missing an occasional AUD
// can recover without merging two keyframes.
type annexBDecoder struct {
	buf      []byte
	current  []byte
	hasVCL   bool
	idr      bool
	sps      []byte
	metadata []byte
}

func (d *annexBDecoder) Write(p []byte, emit func(accessUnit) error) error {
	d.buf = append(d.buf, p...)
	for {
		start, prefix := findStartCode(d.buf)
		if start < 0 {
			// Preserve a partial start code at the end of the read buffer.
			keep := 0
			for n := 1; n <= 3 && n <= len(d.buf); n++ {
				if isStartCodePrefix(d.buf[len(d.buf)-n:]) {
					keep = n
				}
			}
			if keep > 0 {
				copy(d.buf, d.buf[len(d.buf)-keep:])
				d.buf = d.buf[:keep]
			} else {
				d.buf = d.buf[:0]
			}
			return nil
		}
		if start > 0 {
			d.buf = d.buf[start:]
		}
		next, _ := findStartCode(d.buf[prefix:])
		if next < 0 {
			return nil
		}
		next += prefix
		nal := append([]byte(nil), d.buf[prefix:next]...)
		d.buf = d.buf[next:]
		if err := d.consume(nal, emit); err != nil {
			return err
		}
	}
}

func (d *annexBDecoder) Flush(emit func(accessUnit) error) error {
	start, prefix := findStartCode(d.buf)
	if start >= 0 {
		d.buf = d.buf[start:]
		nal := append([]byte(nil), d.buf[prefix:]...)
		d.buf = nil
		if len(nal) > 0 {
			if err := d.consume(nal, emit); err != nil {
				return err
			}
		}
	}
	d.buf = nil
	if d.hasVCL {
		au := d.takeAU()
		if err := emit(au); err != nil {
			return err
		}
	}
	d.current = nil
	d.metadata = nil
	d.hasVCL, d.idr = false, false
	d.sps = nil
	return nil
}

func (d *annexBDecoder) consume(nal []byte, emit func(accessUnit) error) error {
	if len(nal) == 0 {
		return nil
	}
	nalType := nal[0] & 31
	if nalType == 9 {
		if d.hasVCL {
			au := d.takeAU()
			if err := emit(au); err != nil {
				return err
			}
		} else {
			// Do not manufacture a metadata-only access unit. Keep leading SPS/PPS
			// so a stream whose first AUD follows extradata still decodes.
			d.metadata = append(d.metadata, d.current...)
			d.current = nil
		}
		d.appendNAL(nal)
		return nil
	}
	if nalType == 5 && d.hasVCL && !d.idr {
		// Defensive recovery for malformed streams: two VCL groups with the second
		// starting at an IDR are unambiguously separate access units.
		au := d.takeAU()
		if err := emit(au); err != nil {
			return err
		}
	}
	if nalType >= 1 && nalType <= 5 {
		d.hasVCL = true
	}
	if nalType == 5 {
		d.idr = true
	}
	if nalType == 7 {
		d.sps = append([]byte(nil), nal...)
	}
	d.appendNAL(nal)
	return nil
}

func (d *annexBDecoder) appendNAL(nal []byte) {
	d.current = append(d.current, 0, 0, 0, 1)
	d.current = append(d.current, nal...)
}

func (d *annexBDecoder) takeAU() accessUnit {
	au := accessUnit{data: d.current, idr: d.idr, sps: d.sps}
	d.current = append([]byte(nil), d.metadata...)
	d.metadata = nil
	d.hasVCL, d.idr = false, false
	d.sps = nil
	return au
}

func findStartCode(buf []byte) (index, prefix int) {
	if i := bytes.Index(buf, []byte{0, 0, 1}); i >= 0 {
		if i > 0 && buf[i-1] == 0 {
			return i - 1, 4
		}
		return i, 3
	}
	return -1, 0
}

func isStartCodePrefix(buf []byte) bool {
	for _, b := range buf {
		if b != 0 {
			return false
		}
	}
	return len(buf) >= 1 && len(buf) <= 3
}

func nalUnits(au []byte) ([][]byte, error) {
	var units [][]byte
	for len(au) > 0 {
		start, prefix := findStartCode(au)
		if start < 0 {
			return nil, fmt.Errorf("Annex-B access unit contains no start code")
		}
		au = au[start+prefix:]
		next, _ := findStartCode(au)
		var nal []byte
		if next < 0 {
			nal = au
			au = nil
		} else {
			nal = au[:next]
			au = au[next:]
		}
		if len(nal) > 0 {
			units = append(units, nal)
		}
	}
	return units, nil
}
