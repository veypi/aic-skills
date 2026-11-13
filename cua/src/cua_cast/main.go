// Command cua_cast captures the desktop once and fans a low-latency H264 stream
// out to loopback subscribers using the cua/stream-v1 envelope.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Printf("cua_cast configuration: %v", err)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := newStreamServer(cfg, nil).serve(ctx); err != nil {
		log.Printf("cua_cast: %v", err)
		os.Exit(1)
	}
}
