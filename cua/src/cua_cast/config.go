package main

import (
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
)

type config struct {
	address      string
	ffmpegPath   string
	fps          int
	bitrate      string
	maxDimension int
	encoder      string
	goos         string
}

func loadConfig() (config, error) {
	cfg := config{
		address:    envOrDefault("CUA_STREAM_ADDR", "127.0.0.1:0"),
		ffmpegPath: envOrDefault("CUA_FFMPEG_PATH", "ffmpeg"),
		bitrate:    envOrDefault("CUA_CAST_BITRATE", "4M"),
		encoder:    os.Getenv("CUA_CAST_ENCODER"),
		goos:       runtime.GOOS,
	}
	var err error
	if cfg.fps, err = envPositiveInt("CUA_CAST_FPS", 30, 120); err != nil {
		return config{}, err
	}
	if cfg.maxDimension, err = envPositiveInt("CUA_CAST_MAX_DIMENSION", 1920, 16384); err != nil {
		return config{}, err
	}
	if strings.TrimSpace(cfg.bitrate) == "" {
		return config{}, fmt.Errorf("CUA_CAST_BITRATE must not be empty")
	}
	if cfg.encoder == "" {
		switch cfg.goos {
		case "darwin":
			cfg.encoder = "h264_videotoolbox"
		case "windows":
			cfg.encoder = "h264_mf"
		default:
			return config{}, fmt.Errorf("cua_cast does not support desktop capture on %s", cfg.goos)
		}
	}
	if err := validateLoopbackAddress(cfg.address); err != nil {
		return config{}, err
	}
	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envPositiveInt(name string, fallback, maximum int) (int, error) {
	value := os.Getenv(name)
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 || n > maximum {
		return 0, fmt.Errorf("%s must be an integer in [1,%d], got %q", name, maximum, value)
	}
	return n, nil
}

func validateLoopbackAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid CUA_STREAM_ADDR %q: %w", address, err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("CUA_STREAM_ADDR must be a loopback address, got %q", address)
	}
	return nil
}
