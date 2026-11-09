package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// targetInput 是所有页面级工具的显式寻址。为空时才使用当前页面，方便 AI
// 连续操作；UI 必须始终携带 target_id，不能依赖共享的当前 session。
type targetInput struct {
	TargetID string `json:"target_id,omitempty" jsonschema:"page target id from targets; empty uses the current page"`
}

// attachTarget 是 target → session 的唯一入口。重复选择同一 target 复用已就绪
// session；新 attach 等 Chrome 就绪后再发布为当前页，并同步切换画面。
func (s *service) attachTarget(ctx context.Context, b *Browser, targetID string) (string, error) {
	s.attachMu.Lock()
	defer s.attachMu.Unlock()
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return "", fmt.Errorf("target_id is required")
	}
	session := b.TargetSession(targetID)
	if session == "" || !b.SessionReady(session) {
		var err error
		session, err = b.AttachPage(ctx, targetID)
		if err != nil {
			return "", err
		}
	}
	b.SetSession(session)
	if s.hasCastPeers() {
		s.switchCast(ctx, b, session)
	}
	return session, nil
}

// pageSession 解析页面级调用的目标。显式 target 永远重新经过统一 attach 路径；
// 未显式指定时复用当前有效 session，否则选择第一个页面。
func (s *service) pageSession(ctx context.Context, b *Browser, targetID string) (string, error) {
	if targetID != "" {
		return s.attachTarget(ctx, b, targetID)
	}
	if session := b.Session(); session != "" && b.SessionReady(session) {
		return session, nil
	}
	result, err := b.Call(ctx, "Target.getTargets", nil, "")
	if err != nil {
		return "", err
	}
	var payload struct {
		TargetInfos []struct {
			TargetID string `json:"targetId"`
			Type     string `json:"type"`
		} `json:"targetInfos"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return "", fmt.Errorf("decode targets: %w", err)
	}
	for _, info := range payload.TargetInfos {
		if info.Type == "page" {
			return s.attachTarget(ctx, b, info.TargetID)
		}
	}
	return "", fmt.Errorf("no page target available; open a page first")
}

func (s *service) hasCastPeers() bool {
	s.castMu.Lock()
	defer s.castMu.Unlock()
	return len(s.castPeers) > 0
}
