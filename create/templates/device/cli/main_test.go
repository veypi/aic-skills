package main

import (
	"context"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestPing(t *testing.T) {
	result, output, err := ping(context.Background(), nil, pingInput{})
	if err != nil {
		t.Fatal(err)
	}
	if output != nil {
		t.Fatalf("output = %#v, want nil", output)
	}
	assertPong(t, result)
}

func TestMCPInitializeAndPing(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverDone := make(chan error, 1)
	go func() { serverDone <- newServer().Run(ctx, serverTransport) }()

	client := mcp.NewClient(&mcp.Implementation{Name: "contract-test", Version: "0.1.0"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("MCP initialize failed: %v", err)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "ping", Arguments: pingInput{}})
	if err != nil {
		t.Fatalf("tools/call ping failed: %v", err)
	}
	assertPong(t, result)
	if err := session.Close(); err != nil {
		t.Fatalf("close client session: %v", err)
	}
	if err := <-serverDone; err != nil {
		t.Fatalf("server run: %v", err)
	}
}

func assertPong(t *testing.T, result *mcp.CallToolResult) {
	t.Helper()
	if result == nil || len(result.Content) != 1 || result.IsError {
		t.Fatalf("unexpected result: %#v", result)
	}
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok || text.Text != "pong" {
		t.Fatalf("content = %#v, want text pong", result.Content[0])
	}
}
