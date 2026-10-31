// Command browser serves a thin Chrome DevTools Protocol channel as an MCP
// service.
//
// 取向：不把每个浏览器动作各包一条工具（那样 AI 得记几十个名字和参数形状，
// 长尾还会漏），而是给 AI 一条能直连 CDP 的通道（cdp）加少量高频糖
// （targets / attach / eval）。没封装的 CDP 领域都能直接用。
//
// 运行形态：
//   - 默认 stdio：Pod 按本包 manifest.json 拉起本程序（mcp-stdio）。
//   - --http <addr>：自带 HTTP MCP 服务，供"进程已经在设备上、Pod 只做代理"
//     的形态使用（开发期与自建部署）。
//
// 权限边界：Chrome 由本程序拉起，能访问什么由本程序的启动参数与操作系统决定；
// MCP 调用门由 Pod 的服务命令权限（mcp.<alias>）把关。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	// 应用配置由 browser 自己读取；环境变量与命令行仍可覆盖配置文件。
	if err := loadBrowserConfig(); err != nil {
		log.Fatal(err)
	}
	opts := launchOptions{
		ChromePath: firstEnv("AIC_BROWSER_PATH", "AGENT_BROWSER_EXECUTABLE_PATH"),
		// 资料目录默认 ~/.aic/chrome-profile（固定目录，登录态跨重启保留）；
		// BROWSER_PROFILE 可改。默认不显示窗口，BROWSER_HEADLESS=0 弹出可见窗口。
		ProfileDir: firstEnv("BROWSER_PROFILE"),
		Proxy:      firstEnv("BROWSER_PROXY"),
		Headless:   true,
		// 用户自己的浏览器：给了 CDP 地址就接入它，不再本地启动 Chrome。
		CDPURL: firstEnv("BROWSER_CDP_URL"),
		// 视口默认 720p（1280x720）；可用 BROWSER_WINDOW_SIZE 改。
		WindowSize: firstEnv("BROWSER_WINDOW_SIZE", "BROWSER_VIEWPORT"),
	}
	if opts.WindowSize == "" {
		opts.WindowSize = "1280x720"
	}
	if v := firstEnv("BROWSER_HEADLESS"); v != "" {
		opts.Headless = !(v == "0" || strings.EqualFold(v, "false"))
	}
	opts.SecureOrigins = splitEnvList(firstEnv("BROWSER_SECURE_ORIGINS"))
	opts.ExtraArgs = splitEnvList(firstEnv("BROWSER_CHROME_ARGS"))

	flag.StringVar(&opts.ChromePath, "chrome", opts.ChromePath, "path to the Chrome/Chromium binary")
	flag.StringVar(&opts.ProfileDir, "profile", opts.ProfileDir, "Chrome profile directory (default "+defaultBrowserProfile+")")
	flag.BoolVar(&opts.Headless, "headless", opts.Headless, "run Chrome headless (default true; BROWSER_HEADLESS=0 shows the window)")
	flag.StringVar(&opts.CDPURL, "cdp", opts.CDPURL, "attach to a running browser by CDP address (host:port, http://… or ws://…); no local Chrome is started")
	flag.StringVar(&opts.Proxy, "proxy", opts.Proxy, "proxy URL for Chrome")
	flag.StringVar(&opts.WindowSize, "window-size", opts.WindowSize, "viewport size, for example 1280x720")
	flag.Var(&opts.SecureOrigins, "secure-origin", "treat this http origin as secure (repeatable)")
	flag.Var(&opts.ExtraArgs, "chrome-arg", "extra argument for Chrome (repeatable)")
	httpAddr := flag.String("http", "", "serve MCP over HTTP at this address instead of stdio")
	flag.Parse()

	svc := newService(opts)
	defer svc.Close()

	if *httpAddr == "" {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		if address := firstEnv("BROWSER_STREAM_ADDR"); address != "" {
			go func() {
				if err := svc.serveStream(ctx, address); err != nil && ctx.Err() == nil {
					log.Printf("browser: stream server: %v", err)
				}
			}()
		}
		if err := svc.server().Run(ctx, &mcp.StdioTransport{}); err != nil {
			log.Fatal(err)
		}
		return
	}

	mux := http.NewServeMux()
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return svc.server() },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true}))
	srv := &http.Server{Addr: *httpAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	log.Printf("browser: MCP over HTTP on %s/mcp", *httpAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// firstEnv 返回第一个非空的环境变量值。
func firstEnv(names ...string) string {
	for _, name := range names {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v
		}
	}
	return ""
}

// splitEnvList 按逗号或换行切分环境变量里的列表（origin 列表用）。
func splitEnvList(v string) stringList {
	var out stringList
	for _, part := range strings.FieldsFunc(v, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// stringList 是可重复的字符串 flag 参数。
type stringList []string

func (l *stringList) String() string { return strings.Join(*l, ",") }

func (l *stringList) Set(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("empty value")
	}
	*l = append(*l, v)
	return nil
}
