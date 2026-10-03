// Copyright (C) 2025 veypi <i@veypi.com>
// Distributed under terms of the MIT license.

// hello-service 是 aic-skills/hello-service 包的 service 类 provider（v6 P0 demo，
// aic/docs/skill.md §9.2）：真实外部进程，演示 skillproc 最小协议的 provider
// 侧写法——监听 SKILLPROC_SOCKET（pod 经 env 注入的 unix socket 路径），
// 每连接读帧分发：
//
//	invoke      argv/cwd 回显、pipe（stdin 负载回显）、sleep N（可取消）、exit N
//
// 关闭连接取消当前调用（exit 124）。
//
//	stream.open echo 通道：stream.frame 原样回显，stream.close 收尾
//
// 无 handshake/health/版本协商——崩溃由 pod 侧下次调用重拉。
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/veypi/aic-skills/sdk/go/skillproc"
)

func main() {
	sock := os.Getenv("SKILLPROC_SOCKET")
	if sock == "" {
		fmt.Fprintln(os.Stderr, "SKILLPROC_SOCKET is required")
		os.Exit(2)
	}
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		fmt.Fprintln(os.Stderr, "listen:", err)
		os.Exit(1)
	}
	defer ln.Close()
	fmt.Fprintln(os.Stderr, "hello-service listening", sock)
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go serveConn(skillproc.NewConn(c))
	}
}

func serveConn(conn *skillproc.Conn) {
	skillproc.ServeConn(context.Background(), conn, func(ctx context.Context, h skillproc.Header, input []byte, out, errOut io.Writer) (int, error) {
		args := h.Argv
		if len(args) == 0 {
			_, err := fmt.Fprintln(out, "hello from aic skill service")
			return 0, err
		}
		switch args[0] {
		case "argv":
			for _, a := range args[1:] {
				if _, err := fmt.Fprintln(out, a); err != nil {
					return 1, err
				}
			}
			return 0, nil
		case "pipe":
			_, err := out.Write(input)
			return 0, err
		case "sleep":
			sec := 30
			if len(args) > 1 {
				sec, _ = strconv.Atoi(args[1])
			}
			select {
			case <-time.After(time.Duration(sec) * time.Second):
				_, err := fmt.Fprintf(out, "slept %d\n", sec)
				return 0, err
			case <-ctx.Done():
				return 124, ctx.Err()
			}
		case "exit":
			code := 0
			if len(args) > 1 {
				code, _ = strconv.Atoi(args[1])
			}
			return code, nil
		default:
			return 2, fmt.Errorf("unknown subcommand %s", args[0])
		}
	}, func(ctx context.Context, name string, _ []byte) (skillproc.Stream, error) {
		if name != "echo" {
			return nil, fmt.Errorf("unknown stream %s", name)
		}
		return &echoStream{ctx: ctx, data: make(chan []byte, 1)}, nil
	})
}

type echoStream struct {
	ctx  context.Context
	data chan []byte
}

func (s *echoStream) Send(ctx context.Context, p []byte) error {
	select {
	case s.data <- append([]byte(nil), p...):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *echoStream) Recv(ctx context.Context) ([]byte, error) {
	select {
	case b := <-s.data:
		return b, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (s *echoStream) Close() error { return nil }
