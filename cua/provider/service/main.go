// Copyright (C) 2025 veypi <i@veypi.com>
// Distributed under terms of the MIT license.

// cua-service 是 aic-skills/cua 包的 service 类 provider（v6 P6）：持有
// cua-driver MCP 连接与设备级唯一原生会话的唯一进程。skillrun 懒启动
// （首调用）由 skillrun 管理；SKILLPROC_SOCKET 经 env 注入。
//
// 协议面（skillproc，无 handshake——崩溃由 pod 侧下次调用重拉）：
//
//	invoke      argv/cwd 由 pod 直接传入——子命令表/解析/
//	            JSON 输出契约见 cua.Service.Run（cua.Help）；连接断开
//	            即取消该连接的 invoke（客户端断连 = 调用取消）。
//
// 驱动探测（包内解析，pod/desktop 只递目录提示）：
//
//	AIC_CUA_DRIVER_PATH  cua-driver 可执行文件（显式覆盖，最高优先）
//	AIC_CUA_BUNDLE_DIR   Electron 内置发行物目录提示（resources/cua/{plat}；
//	                     darwin 派生 CuaDriver.app——签名/公证原样，TCC 授权
//	                     归 com.trycua.driver）→ PATH → 系统候选（缺省回落）
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"

	"github.com/veypi/aic-skills/cua/provider/cua"
	"github.com/veypi/aic-skills/sdk/go/skillproc"
)

func main() {
	logf := func(format string, args ...any) { fmt.Fprintf(os.Stderr, "cua-service: "+format+"\n", args...) }
	sock := os.Getenv("SKILLPROC_SOCKET")
	if sock == "" {
		fmt.Fprintln(os.Stderr, "cua-service: SKILLPROC_SOCKET is required")
		os.Exit(2)
	}
	svc := cua.New(cua.Config{Logf: logf})
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cua-service: listen:", err)
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

// One connection owns one call or stream; EOF cancels that work.
func serveConn(svc *cua.Service, conn *skillproc.Conn) {
	skillproc.ServeConn(context.Background(), conn, func(ctx context.Context, h skillproc.Header, _ []byte, out, errOut io.Writer) (int, error) {
		return svc.Run(ctx, h.Argv, h.Cwd, out, errOut), nil
	}, nil)
}
