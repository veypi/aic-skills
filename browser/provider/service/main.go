// Copyright (C) 2025 veypi <i@veypi.com>
// Distributed under terms of the MIT license.

// browser-service 是 browser 包的唯一 provider，持有 Chrome 与全部页面、
// 下载和上传状态。skillrun 懒启动并管理进程；SKILLPROC_SOCKET 经 env 注入。
//
// 协议面（skillproc，无 handshake——崩溃由 pod 侧下次调用重拉）：
//
//	invoke      argv/cwd 由 pod 直接传入——子命令表/解析/
//	            JSON 输出契约见 browser.Service.Run（browser.Help）；连接断开
//	            即取消该连接的 invoke（客户端断连 = 调用取消）。
//	stream.open page.frames / page.input（包内流名）：负载 =
//	            PageArgs JSON；服务端连接身份（输入租约凭它区分持有者）。
//	            一帧 stream.frame = 一条 tool 消息（帧边界 = 消息边界）。
//
// 配置由包管理，env 可以覆盖默认值：
//
//	AIC_BROWSER_PATH        Chrome 可执行文件（显式覆盖，最高优先；缺省走
//	                        chrome.Resolve 候选链：AIC_BROWSER_BUNDLE_DIR 打包内置
//	                        Chrome for Testing → 系统安装探测）
//	AIC_BROWSER_STATE_DIR   状态目录（默认 $HOME/.aic/browser：profile/downloads/
//	                        uploads，进程锁防并发实例）
//	AIC_BROWSER_WIDTH/HEIGHT 新建页面默认视口（默认 1280/720）
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"

	"github.com/veypi/aic-skills/browser/provider/browser"
	"github.com/veypi/aic-skills/sdk/go/skillproc"
)

func main() {
	logf := func(format string, args ...any) { fmt.Fprintf(os.Stderr, "browser-service: "+format+"\n", args...) }
	sock := os.Getenv("SKILLPROC_SOCKET")
	if sock == "" {
		fmt.Fprintln(os.Stderr, "browser-service: SKILLPROC_SOCKET is required")
		os.Exit(2)
	}
	svc := browser.New(configFromEnv(logf))
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		fmt.Fprintln(os.Stderr, "browser-service: listen:", err)
		os.Exit(1)
	}
	defer ln.Close()
	logf("listening %s", sock)
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go serveConn(svc, skillproc.NewConn(c))
	}
}

// configFromEnv 包内默认 + env 覆盖（见文件头）。
func configFromEnv(logf func(string, ...any)) browser.Config {
	stateDir := os.Getenv("AIC_BROWSER_STATE_DIR")
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(os.Stderr, "browser-service: home dir:", err)
			os.Exit(1)
		}
		stateDir = filepath.Join(home, ".aic", "browser")
	}
	envInt := func(key string, fallback int) int {
		if v := os.Getenv(key); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		return fallback
	}
	return browser.Config{
		StateDir: stateDir,
		Width:    envInt("AIC_BROWSER_WIDTH", 1280),
		Height:   envInt("AIC_BROWSER_HEIGHT", 720),
		Logf:     logf,
	}
}

// One connection owns one call or stream; EOF cancels that work.
func serveConn(svc *browser.Service, conn *skillproc.Conn) {
	identity := rand.Text() // private connection identity for the input lease
	skillproc.ServeConn(context.Background(), conn, func(ctx context.Context, h skillproc.Header, _ []byte, out, errOut io.Writer) (int, error) {
		return svc.Run(ctx, h.Argv, h.Cwd, out, errOut), nil
	}, func(ctx context.Context, name string, payload []byte) (skillproc.Stream, error) {
		var args browser.PageArgs
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &args); err != nil {
				return nil, err
			}
		}
		if err := args.Validate(); err != nil {
			return nil, err
		}
		switch name {
		case "page.frames":
			return svc.Frames(ctx, args)
		case "page.input":
			return svc.Input(ctx, identity, args)
		}
		return nil, fmt.Errorf("unknown stream %q", name)
	})
}
