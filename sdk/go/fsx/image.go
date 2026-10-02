package fsx

// image_data 编码（§2.2 标准，600KB 投递阈值 + 阶梯降质/缩尺寸 → JPEG）。
// 协议要求 provider（host 端截图产出方）与平台两端算法一致；本文件是
// provider 侧实现，与 pod 侧（aic-pod libs/fsx/image.go）同算法同步演进——
// 契约改动先改 §2.2 文档，再同步两侧。

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// imageDataMaxBytes 是 image_data 的原始字节投递标准（§2.2：两端压缩阈值
// 对齐 600KB，算法一致——阶梯降质 → 逐级缩尺寸，输出 JPEG）。
const imageDataMaxBytes = 600 * 1024

// EncodeImageData 将图片字节编码为 §2.2 标准的 data URI（provider 把本地截图
// 等转成 image_data 附在工具返回里——服务端统一落盘投递）：超过
// imageDataMaxBytes 自动压缩为 JPEG。返回 (dataURI, 压缩说明 note, err)，
// note 为空表示未压缩。
func EncodeImageData(data []byte, mime string) (string, string, error) {
	out, note := data, ""
	if len(data) > imageDataMaxBytes {
		c, err := compressImage(data, mime)
		if err != nil {
			return "", "", err
		}
		out = c.data
		note = fmt.Sprintf("%d bytes → image/jpeg %dx%d quality %d (%d bytes)",
			len(data), c.width, c.height, c.quality, len(c.data))
	}
	return fmt.Sprintf("data:%s;base64,%s",
		pickMIME(mime, note != ""), base64.StdEncoding.EncodeToString(out)), note, nil
}

func pickMIME(orig string, compressed bool) string {
	if compressed {
		return "image/jpeg"
	}
	return orig
}

type compressedImage struct {
	data          []byte
	width, height int
	quality       int
}

// compressImage 将超限图片压缩到 imageDataMaxBytes 以内，输出统一为 JPEG。
// 先在原尺寸阶梯降低质量（80/60/40），仍超限则按 0.5 倍逐级缩小尺寸重试。
func compressImage(data []byte, mime string) (*compressedImage, error) {
	img, err := decodeImage(data, mime)
	if err != nil {
		return nil, err
	}
	// JPEG 无透明通道，先铺白底
	b := img.Bounds()
	flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(flat, flat.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), img, b.Min, draw.Over)

	scale := 1.0
	for range 6 {
		cur := image.Image(flat)
		if scale < 1.0 {
			w := max(1, int(float64(b.Dx())*scale))
			h := max(1, int(float64(b.Dy())*scale))
			scaled := image.NewRGBA(image.Rect(0, 0, w, h))
			xdraw.ApproxBiLinear.Scale(scaled, scaled.Bounds(), flat, flat.Bounds(), xdraw.Over, nil)
			cur = scaled
		}
		for _, q := range []int{80, 60, 40} {
			var buf bytes.Buffer
			if err := jpeg.Encode(&buf, cur, &jpeg.Options{Quality: q}); err != nil {
				return nil, err
			}
			if buf.Len() <= imageDataMaxBytes {
				cb := cur.Bounds()
				return &compressedImage{buf.Bytes(), cb.Dx(), cb.Dy(), q}, nil
			}
		}
		scale *= 0.5
	}
	return nil, fmt.Errorf("image still exceeds %d bytes after downscaling", imageDataMaxBytes)
}

func decodeImage(data []byte, mime string) (image.Image, error) {
	r := bytes.NewReader(data)
	switch mime {
	case "image/png":
		return png.Decode(r)
	case "image/jpeg":
		return jpeg.Decode(r)
	case "image/gif":
		return gif.Decode(r)
	case "image/webp":
		return webp.Decode(r)
	}
	return nil, fmt.Errorf("unsupported image format: %s", mime)
}
