package main

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// cast_stats 是画面链路的只读自检：报告绑定会话、screencast 会话、订阅者数、
// 从 Chrome 收到的帧数与写给订阅者的帧数。
//
// 只读：不启停 screencast、不重置计数，诊断时可以直接调用。
func (s *service) toolCastStats(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	b := s.currentBrowser()
	session := ""
	if b != nil {
		session = b.Session()
	}
	s.castMu.Lock()
	received := s.castStatFrames
	bytes := s.castStatBytes
	castSession := s.castSession
	peers := len(s.castPeers)
	sent := s.castStatSent
	written := s.castStatWritten
	writtenBytes := s.castStatWrittenBytes
	s.castMu.Unlock()
	payload, _ := json.Marshal(map[string]any{
		"session": session, "castSession": castSession,
		"peers": peers, "framesReceived": received,
		"framesSent": sent, "framesWritten": written,
		"writtenBytes": writtenBytes, "bytes": bytes,
	})
	return textResult(json.RawMessage(payload)), nil, nil
}
