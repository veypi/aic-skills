package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

type streamConfig struct {
	codec        string
	width        int
	height       int
	sourceWidth  int
	sourceHeight int
	fps          int
}

type captureSink struct {
	config func(streamConfig)
	frame  func(accessUnit)
}

type captureRunner func(context.Context, config, captureSink) error

func runFFmpeg(ctx context.Context, cfg config, sink captureSink) error {
	args, err := ffmpegArgs(ctx, cfg)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, cfg.ffmpegPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open FFmpeg stdout: %w", err)
	}
	stderr := newFFmpegStderr()
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start FFmpeg with %s: %w", cfg.encoder, err)
	}

	decoder := &annexBDecoder{}
	current := streamConfig{fps: cfg.fps}
	emit := func(au accessUnit) error {
		if au.sps != nil {
			sps, err := parseH264SPS(au.sps)
			if err != nil {
				return fmt.Errorf("parse H264 SPS: %w", err)
			}
			next := streamConfig{
				codec: sps.codec, width: sps.width, height: sps.height, fps: cfg.fps,
				sourceWidth: stderr.SourceWidth(), sourceHeight: stderr.SourceHeight(),
			}
			if next.sourceWidth == 0 || next.sourceHeight == 0 {
				next.sourceWidth, next.sourceHeight = next.width, next.height
			}
			if next != current {
				current = next
				sink.config(current)
			}
		}
		if current.width == 0 || current.height == 0 {
			return fmt.Errorf("H264 access unit arrived before a valid SPS")
		}
		sink.frame(au)
		return nil
	}

	readErr := error(nil)
	buffer := make([]byte, 64<<10)
	for {
		n, err := stdout.Read(buffer)
		if n > 0 {
			if decodeErr := decoder.Write(buffer[:n], emit); decodeErr != nil {
				readErr = decodeErr
			}
		}
		if readErr != nil || err != nil {
			if err != nil && err != io.EOF && readErr == nil {
				readErr = err
			}
			break
		}
	}
	if readErr == nil {
		readErr = decoder.Flush(emit)
	}
	if readErr != nil {
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return nil
	}
	if readErr != nil {
		return fmt.Errorf("decode FFmpeg H264 output: %w", readErr)
	}
	if waitErr != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return fmt.Errorf("FFmpeg %s exited: %w: %s", cfg.encoder, waitErr, detail)
		}
		return fmt.Errorf("FFmpeg %s exited: %w", cfg.encoder, waitErr)
	}
	return fmt.Errorf("FFmpeg %s stopped while subscribers are connected", cfg.encoder)
}

func ffmpegArgs(ctx context.Context, cfg config) ([]string, error) {
	var inputFormat, input string
	switch cfg.goos {
	case "darwin":
		device, err := findMacScreenDevice(ctx, cfg.ffmpegPath)
		if err != nil {
			return nil, err
		}
		inputFormat, input = "avfoundation", device
	case "windows":
		inputFormat = "lavfi"
		input = fmt.Sprintf("ddagrab=framerate=%d:draw_mouse=1", cfg.fps)
	default:
		return nil, fmt.Errorf("cua_cast does not support desktop capture on %s", cfg.goos)
	}
	return buildFFmpegArgs(cfg, inputFormat, input), nil
}

func buildFFmpegArgs(cfg config, inputFormat, input string) []string {
	args := []string{"-hide_banner", "-loglevel", "info"}
	if inputFormat == "lavfi" {
		// ddagrab 是 D3D11 source filter，不是 gdigrab 那样的输入设备。
		args = append(args, "-init_hw_device", "d3d11va", "-f", "lavfi", "-i", input)
	} else {
		args = append(args, "-f", inputFormat, "-framerate", strconv.Itoa(cfg.fps), "-i", input)
	}
	scale := fmt.Sprintf("scale=w=min(iw\\,%d):h=min(ih\\,%d):force_original_aspect_ratio=decrease:force_divisible_by=2", cfg.maxDimension, cfg.maxDimension)
	if inputFormat == "lavfi" {
		scale = "hwdownload,format=bgra," + scale
	}
	args = append(args,
		"-an", "-vf", scale,
		"-c:v", cfg.encoder,
		"-b:v", cfg.bitrate,
		"-g", "15",
		"-bf", "0",
		"-flags", "low_delay",
		"-pix_fmt", "yuv420p",
		"-r", strconv.Itoa(cfg.fps),
		"-flush_packets", "1",
	)
	if cfg.encoder == "h264_mf" {
		args = append(args, "-scenario", "display_remoting", "-rate_control", "gld_vbr")
	}
	if cfg.encoder == "h264_nvenc" {
		args = append(args, "-preset", "p1", "-tune", "ull", "-zerolatency", "1",
			"-rc-lookahead", "0", "-delay", "0", "-no-scenecut", "1", "-forced-idr", "1")
	}
	if cfg.encoder == "h264_videotoolbox" {
		args = append(args, "-realtime", "1", "-allow_sw", "0")
	}
	return append(args,
		"-bsf:v", "dump_extra=freq=keyframe,h264_metadata=aud=insert",
		"-f", "h264", "pipe:1",
	)
}

var avfoundationDevicePattern = regexp.MustCompile(`\[AVFoundation indev[^\]]*\] \[([0-9]+)\] (.+)$`)

func findMacScreenDevice(ctx context.Context, ffmpegPath string) (string, error) {
	cmd := exec.CommandContext(ctx, ffmpegPath, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", "")
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	devices := parseAVFoundationDevices(string(output))
	for _, device := range devices {
		if strings.HasPrefix(device, "Capture screen ") {
			return device, nil
		}
	}
	detail := strings.TrimSpace(string(output))
	if err != nil && len(devices) == 0 {
		return "", fmt.Errorf("enumerate avfoundation devices with FFmpeg: %w: %s", err, detail)
	}
	return "", fmt.Errorf("no avfoundation Capture screen device found; grant Screen Recording permission to FFmpeg/cua_cast (devices: %s)", detail)
}

func parseAVFoundationDevices(output string) []string {
	var devices []string
	inVideo := false
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "AVFoundation video devices:") {
			inVideo = true
			continue
		}
		if strings.Contains(line, "AVFoundation audio devices:") {
			break
		}
		if !inVideo {
			continue
		}
		matches := avfoundationDevicePattern.FindStringSubmatch(line)
		if len(matches) == 3 {
			devices = append(devices, matches[2])
		}
	}
	return devices
}

var ffmpegVideoDimensions = regexp.MustCompile(`Stream #[^\r\n]*: Video: [^\r\n]*? ([0-9]{2,6})x([0-9]{2,6})[ ,]`)

type ffmpegStderr struct {
	mu     sync.Mutex
	tail   bytes.Buffer
	width  int
	height int
}

func newFFmpegStderr() *ffmpegStderr {
	return &ffmpegStderr{}
}

func (w *ffmpegStderr) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.tail.Len() > 64<<10 {
		w.tail.Reset()
	}
	_, _ = w.tail.Write(p)
	if w.width == 0 {
		matches := ffmpegVideoDimensions.FindStringSubmatch(w.tail.String())
		if len(matches) == 3 {
			w.width, _ = strconv.Atoi(matches[1])
			w.height, _ = strconv.Atoi(matches[2])
		}
	}
	return len(p), nil
}

func (w *ffmpegStderr) SourceWidth() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.width
}

func (w *ffmpegStderr) SourceHeight() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.height
}

func (w *ffmpegStderr) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	text := w.tail.String()
	if len(text) > 64<<10 {
		return text[len(text)-64<<10:]
	}
	return text
}
