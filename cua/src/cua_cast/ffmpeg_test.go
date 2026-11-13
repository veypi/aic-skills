package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestFFmpegMacHardwareArgs(t *testing.T) {
	cfg := config{fps: 30, bitrate: "4M", maxDimension: 1920, encoder: "h264_videotoolbox", goos: "darwin"}
	args := buildFFmpegArgs(cfg, "avfoundation", "Capture screen 0")
	assertArgSequence(t, args, "-f", "avfoundation", "-framerate", "30", "-i", "Capture screen 0")
	assertArgSequence(t, args, "-c:v", "h264_videotoolbox", "-b:v", "4M", "-g", "15", "-bf", "0", "-flags", "low_delay", "-pix_fmt", "yuv420p", "-r", "30")
	assertArgSequence(t, args, "-realtime", "1", "-allow_sw", "0")
	assertArgSequence(t, args, "-bsf:v", "dump_extra=freq=keyframe,h264_metadata=aud=insert", "-f", "h264", "pipe:1")
	scale := argValue(t, args, "-vf")
	for _, part := range []string{"min(iw\\,1920)", "min(ih\\,1920)", "force_original_aspect_ratio=decrease", "force_divisible_by=2"} {
		if !strings.Contains(scale, part) {
			t.Fatalf("scale %q lacks %q", scale, part)
		}
	}
}

func TestFFmpegWindowsHardwareArgs(t *testing.T) {
	cfg := config{fps: 24, bitrate: "6000000", maxDimension: 1280, encoder: "h264_mf", goos: "windows"}
	args := buildFFmpegArgs(cfg, "lavfi", "ddagrab=framerate=24:draw_mouse=1")
	assertArgSequence(t, args, "-init_hw_device", "d3d11va", "-f", "lavfi", "-i", "ddagrab=framerate=24:draw_mouse=1")
	assertArgSequence(t, args, "-c:v", "h264_mf", "-b:v", "6000000", "-g", "15", "-bf", "0", "-flags", "low_delay", "-pix_fmt", "yuv420p", "-r", "24")
	assertArgSequence(t, args, "-scenario", "display_remoting", "-rate_control", "gld_vbr")
	if got := argValue(t, args, "-vf"); !strings.HasPrefix(got, "hwdownload,format=bgra,scale=") {
		t.Fatalf("ddagrab software download/scale chain = %q", got)
	}
	if containsArg(args, "-allow_sw") {
		t.Fatal("Windows Media Foundation received a VideoToolbox-only option")
	}
}

func assertArgSequence(t *testing.T, args []string, want ...string) {
	t.Helper()
	for i := 0; i+len(want) <= len(args); i++ {
		if reflect.DeepEqual(args[i:i+len(want)], want) {
			return
		}
	}
	t.Fatalf("arguments %v do not contain %v", args, want)
}

func argValue(t *testing.T, args []string, name string) string {
	t.Helper()
	for i := 0; i+1 < len(args); i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	t.Fatalf("argument %s missing from %v", name, args)
	return ""
}

func containsArg(args []string, name string) bool {
	for _, arg := range args {
		if arg == name {
			return true
		}
	}
	return false
}

func TestParseAVFoundationDevices(t *testing.T) {
	output := `[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] MacBook Pro Camera
[AVFoundation indev @ 0x1] [1] Capture screen 0
[AVFoundation indev @ 0x1] [2] Capture screen 1
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] Microphone`
	want := []string{"MacBook Pro Camera", "Capture screen 0", "Capture screen 1"}
	if got := parseAVFoundationDevices(output); !reflect.DeepEqual(got, want) {
		t.Fatalf("devices = %v, want %v", got, want)
	}
}

func TestFFmpegSourceDimensions(t *testing.T) {
	stderr := newFFmpegStderr()
	line := "  Stream #0:0: Video: rawvideo (1GR[8] / 0x38475247), gray, 1728x1117, 1000k tbr, 1000k tbn\r\n"
	for _, value := range []byte(line) {
		if _, err := stderr.Write([]byte{value}); err != nil {
			t.Fatal(err)
		}
	}
	if stderr.SourceWidth() != 1728 || stderr.SourceHeight() != 1117 {
		t.Fatalf("source = %dx%d", stderr.SourceWidth(), stderr.SourceHeight())
	}
}

func TestLoopbackAddressValidation(t *testing.T) {
	for _, address := range []string{"127.0.0.1:0", "[::1]:9000", "localhost:9000"} {
		if err := validateLoopbackAddress(address); err != nil {
			t.Fatalf("%s: %v", address, err)
		}
	}
	for _, address := range []string{"0.0.0.0:9000", "192.168.1.2:9000", "example.com:9000"} {
		if err := validateLoopbackAddress(address); err == nil {
			t.Fatalf("%s was accepted", address)
		}
	}
}
