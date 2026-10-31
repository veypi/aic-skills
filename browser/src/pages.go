package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
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
		result, err := b.Call(ctx, "Target.attachToTarget", map[string]any{
			"targetId": targetID, "flatten": true,
		}, "")
		if err != nil {
			// 页面已关闭（常见于关闭标签后拿旧列表 attach）：给可行动的错误。
			if strings.Contains(err.Error(), "No target with given id found") {
				return "", fmt.Errorf("target %s not found (already closed?); run targets to refresh the page list", targetID)
			}
			return "", err
		}
		var payload struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(result, &payload); err != nil {
			return "", fmt.Errorf("decode attach result: %w", err)
		}
		if payload.SessionID == "" {
			return "", fmt.Errorf("attach returned no sessionId: %s", string(result))
		}
		if err := b.AwaitSession(ctx, payload.SessionID, 5*time.Second); err != nil {
			return "", err
		}
		session = payload.SessionID
		b.rememberTargetSession(targetID, session)
	}
	b.SetSession(session)
	if _, err := b.Call(ctx, "Target.activateTarget", map[string]any{"targetId": targetID}, ""); err != nil {
		return "", err
	}
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
