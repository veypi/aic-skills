package main

import (
	"fmt"
)

type h264SPS struct {
	codec  string
	width  int
	height int
}

type bitReader struct {
	data []byte
	bit  int
}

func (r *bitReader) u(n int) (uint64, error) {
	if n < 0 || n > 64 || r.bit+n > len(r.data)*8 {
		return 0, fmt.Errorf("truncated SPS at bit %d", r.bit)
	}
	var value uint64
	for range n {
		value = (value << 1) | uint64((r.data[r.bit/8]>>uint(7-r.bit%8))&1)
		r.bit++
	}
	return value, nil
}

func (r *bitReader) ue() (uint64, error) {
	zeros := 0
	for {
		bit, err := r.u(1)
		if err != nil {
			return 0, err
		}
		if bit == 1 {
			break
		}
		zeros++
		if zeros > 31 {
			return 0, fmt.Errorf("invalid SPS Exp-Golomb value")
		}
	}
	if zeros == 0 {
		return 0, nil
	}
	suffix, err := r.u(zeros)
	if err != nil {
		return 0, err
	}
	return (uint64(1) << zeros) - 1 + suffix, nil
}

func (r *bitReader) se() (int64, error) {
	value, err := r.ue()
	if err != nil {
		return 0, err
	}
	if value&1 == 0 {
		return -int64(value / 2), nil
	}
	return int64((value + 1) / 2), nil
}

func parseH264SPS(nal []byte) (h264SPS, error) {
	if len(nal) < 4 || nal[0]&31 != 7 {
		return h264SPS{}, fmt.Errorf("invalid H264 SPS NAL")
	}
	result := h264SPS{codec: fmt.Sprintf("avc1.%02X%02X%02X", nal[1], nal[2], nal[3])}
	profile := nal[1]
	r := &bitReader{data: removeEmulationPrevention(nal[4:])}
	if _, err := r.ue(); err != nil { // seq_parameter_set_id
		return h264SPS{}, err
	}
	chromaFormat := uint64(1)
	separateColourPlane := uint64(0)
	if highProfileSPS(profile) {
		var err error
		if chromaFormat, err = r.ue(); err != nil {
			return h264SPS{}, err
		}
		if chromaFormat > 3 {
			return h264SPS{}, fmt.Errorf("invalid SPS chroma_format_idc %d", chromaFormat)
		}
		if chromaFormat == 3 {
			if separateColourPlane, err = r.u(1); err != nil {
				return h264SPS{}, err
			}
		}
		if _, err = r.ue(); err != nil { // bit_depth_luma_minus8
			return h264SPS{}, err
		}
		if _, err = r.ue(); err != nil { // bit_depth_chroma_minus8
			return h264SPS{}, err
		}
		if _, err = r.u(1); err != nil { // qpprime_y_zero_transform_bypass_flag
			return h264SPS{}, err
		}
		scalingPresent, err := r.u(1)
		if err != nil {
			return h264SPS{}, err
		}
		if scalingPresent != 0 {
			count := 8
			if chromaFormat == 3 {
				count = 12
			}
			for i := 0; i < count; i++ {
				present, err := r.u(1)
				if err != nil {
					return h264SPS{}, err
				}
				if present != 0 {
					size := 16
					if i >= 6 {
						size = 64
					}
					if err := skipScalingList(r, size); err != nil {
						return h264SPS{}, err
					}
				}
			}
		}
	}
	if _, err := r.ue(); err != nil { // log2_max_frame_num_minus4
		return h264SPS{}, err
	}
	picOrderType, err := r.ue()
	if err != nil {
		return h264SPS{}, err
	}
	switch picOrderType {
	case 0:
		if _, err := r.ue(); err != nil {
			return h264SPS{}, err
		}
	case 1:
		if _, err := r.u(1); err != nil {
			return h264SPS{}, err
		}
		if _, err := r.se(); err != nil {
			return h264SPS{}, err
		}
		if _, err := r.se(); err != nil {
			return h264SPS{}, err
		}
		count, err := r.ue()
		if err != nil {
			return h264SPS{}, err
		}
		if count > 255 {
			return h264SPS{}, fmt.Errorf("invalid SPS pic-order cycle %d", count)
		}
		for range count {
			if _, err := r.se(); err != nil {
				return h264SPS{}, err
			}
		}
	case 2:
	default:
		return h264SPS{}, fmt.Errorf("invalid SPS pic_order_cnt_type %d", picOrderType)
	}
	if _, err := r.ue(); err != nil { // max_num_ref_frames
		return h264SPS{}, err
	}
	if _, err := r.u(1); err != nil { // gaps_in_frame_num_value_allowed_flag
		return h264SPS{}, err
	}
	widthMBS, err := r.ue()
	if err != nil {
		return h264SPS{}, err
	}
	heightMapUnits, err := r.ue()
	if err != nil {
		return h264SPS{}, err
	}
	frameMBSOnly, err := r.u(1)
	if err != nil {
		return h264SPS{}, err
	}
	if frameMBSOnly == 0 {
		if _, err := r.u(1); err != nil { // mb_adaptive_frame_field_flag
			return h264SPS{}, err
		}
	}
	if _, err := r.u(1); err != nil { // direct_8x8_inference_flag
		return h264SPS{}, err
	}
	cropping, err := r.u(1)
	if err != nil {
		return h264SPS{}, err
	}
	var crop [4]uint64
	if cropping != 0 {
		for i := range crop {
			if crop[i], err = r.ue(); err != nil {
				return h264SPS{}, err
			}
		}
	}
	if widthMBS > 65535 || heightMapUnits > 65535 {
		return h264SPS{}, fmt.Errorf("invalid SPS macroblock dimensions")
	}
	width := int(widthMBS+1) * 16
	height := int(heightMapUnits+1) * 16 * int(2-frameMBSOnly)
	cropUnitX, cropUnitY := 1, int(2-frameMBSOnly)
	if chromaFormat != 0 && separateColourPlane == 0 {
		subWidth, subHeight := [4]int{1, 2, 2, 1}[chromaFormat], [4]int{1, 2, 1, 1}[chromaFormat]
		cropUnitX = subWidth
		cropUnitY = subHeight * int(2-frameMBSOnly)
	}
	width -= int(crop[0]+crop[1]) * cropUnitX
	height -= int(crop[2]+crop[3]) * cropUnitY
	if width <= 0 || height <= 0 {
		return h264SPS{}, fmt.Errorf("invalid cropped SPS dimensions %dx%d", width, height)
	}
	result.width, result.height = width, height
	return result, nil
}

func highProfileSPS(profile byte) bool {
	switch profile {
	case 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135:
		return true
	default:
		return false
	}
}

func skipScalingList(r *bitReader, size int) error {
	lastScale, nextScale := int64(8), int64(8)
	for i := 0; i < size; i++ {
		if nextScale != 0 {
			delta, err := r.se()
			if err != nil {
				return err
			}
			nextScale = (lastScale + delta + 256) % 256
		}
		if nextScale != 0 {
			lastScale = nextScale
		}
	}
	return nil
}

func removeEmulationPrevention(data []byte) []byte {
	result := make([]byte, 0, len(data))
	zeros := 0
	for _, value := range data {
		if zeros >= 2 && value == 3 {
			zeros = 0
			continue
		}
		result = append(result, value)
		if value == 0 {
			zeros++
		} else {
			zeros = 0
		}
	}
	return result
}
