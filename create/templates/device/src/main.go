// mytool —— 最小 MCP stdio 服务：由 Pod 启动并长期保持连接。
// 不要把 MCP 当成「一次性 stdin 读 JSON」CLI；握手、工具发现和调用都由官方 SDK 实现。
package main

import (
	"context"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type pingInput struct{}

func ping(_ context.Context, _ *mcp.CallToolRequest, _ pingInput) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: "pong"}},
	}, nil, nil
}

func newServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "mytool",
		Title:   "AIC skill device service example",
		Version: "0.1.0",
	}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "ping",
		Description: "Return pong to verify the MCP service connection.",
	}, ping)
	return server
}

func main() {
	if err := newServer().Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}
