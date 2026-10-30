package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// 高层交互糖：快照（无障碍树 + @ref）、点击、填值、截图。
// 长尾能力一律走 cdp 原始通道——这里只补 AI 交互最常用的几步。

// refEntry 是快照里的一次引用：AX 节点对应的后端 DOM 节点号。
type refEntry struct {
	NodeID int64
	Role   string
	Name   string
}

// refTable 是最近一次快照的引用表（每次快照重建）。
type refTable struct {
	mu    sync.Mutex
	refs  map[string]refEntry
	count int
}

// reset 清空引用表并返回新表。
func (t *refTable) reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.refs = map[string]refEntry{}
	t.count = 0
}

// put 记一条引用并返回它的名字（e1、e2…）。
func (t *refTable) put(role, name string, nodeID int64) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.count++
	ref := "e" + strconv.Itoa(t.count)
	t.refs[ref] = refEntry{NodeID: nodeID, Role: role, Name: name}
	return ref
}

// get 查引用。
func (t *refTable) get(ref string) (refEntry, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	entry, ok := t.refs[strings.TrimSpace(ref)]
	return entry, ok
}

// axNode 是无障碍树节点（CDP Accessibility.getFullAXTree）。
type axNode struct {
	NodeID           string   `json:"nodeId"`
	BackendDOMNodeID int64    `json:"backendDOMNodeId"`
	Ignored          bool     `json:"ignored"`
	Role             axValue  `json:"role"`
	Name             axValue  `json:"name"`
	ChildIDs         []string `json:"childIds"`
}

// axValue 是 AX 值：role/name 可能是字符串，也可能是内部编号。
type axValue struct {
	Value any `json:"value"`
}

// axText 取 AX 值的可读文本（编号类值不进展示）。
func axText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

// skipRoles 是结构性的角色：只参与遍历，不进展示。
var skipRoles = map[string]bool{
	"none": true, "generic": true, "presentation": true, "InlineTextBox": true,
}

const snapshotLineLimit = 400

func (s *service) toolSnapshot(ctx context.Context, _ *mcp.CallToolRequest, in targetInput) (*mcp.CallToolResult, any, error) {
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	if _, err := b.Call(ctx, "Accessibility.enable", nil, session); err != nil {
		return nil, nil, err
	}
	raw, err := b.Call(ctx, "Accessibility.getFullAXTree", nil, session)
	if err != nil {
		return nil, nil, err
	}
	var tree struct {
		Nodes []axNode `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &tree); err != nil {
		return nil, nil, fmt.Errorf("decode ax tree: %w", err)
	}
	index := make(map[string]axNode, len(tree.Nodes))
	hasParent := make(map[string]bool, len(tree.Nodes))
	for _, node := range tree.Nodes {
		index[node.NodeID] = node
		for _, child := range node.ChildIDs {
			hasParent[child] = true
		}
	}
	s.refs.reset()
	var lines []string
	truncated := false
	var walk func(id string, depth int)
	walk = func(id string, depth int) {
		node, ok := index[id]
		if !ok {
			return
		}
		role, name := axText(node.Role.Value), axText(node.Name.Value)
		// 被忽略的节点只是结构壳：不出行，但子树要继续走（否则整棵树会被剪没）。
		keep := !node.Ignored && role != "" && !skipRoles[role]
		if keep {
			if len(lines) >= snapshotLineLimit {
				truncated = true
				return
			}
			line := strings.Repeat("  ", depth) + "- " + role
			if name != "" {
				line += " " + strconv.Quote(name)
			}
			if node.BackendDOMNodeID != 0 {
				line += " [ref=" + s.refs.put(role, name, node.BackendDOMNodeID) + "]"
			}
			lines = append(lines, line)
			depth++
		}
		for _, child := range node.ChildIDs {
			walk(child, depth)
		}
	}
	for _, node := range tree.Nodes {
		if !hasParent[node.NodeID] {
			walk(node.NodeID, 0)
		}
	}
	if truncated {
		lines = append(lines, fmt.Sprintf("… truncated at %d lines", snapshotLineLimit))
	}
	return textResult(json.RawMessage(strconv.Quote(strings.Join(lines, "\n")))), nil, nil
}

// resolveObjectID 把 AX 节点的后端 DOM 节点号解析成 CDP 对象 ID。
// DOM.getBoxModel / DOM.focus 收的是 objectId（不是 backendNodeId），所以
// 交互链路都得先过这一步。
func (s *service) resolveObjectID(ctx context.Context, b *Browser, session string, backendNodeID int64) (string, error) {
	raw, err := b.Call(ctx, "DOM.resolveNode", map[string]any{"backendNodeId": backendNodeID}, session)
	if err != nil {
		return "", err
	}
	var payload struct {
		Object struct {
			ObjectID string `json:"objectId"`
		} `json:"object"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", fmt.Errorf("decode resolve node: %w", err)
	}
	if payload.Object.ObjectID == "" {
		return "", fmt.Errorf("node %d did not resolve to a DOM object", backendNodeID)
	}
	return payload.Object.ObjectID, nil
}

// elementViewportPoint 返回元素在视口内的中心点（CSS 像素，相对视口原点）。
//
// CDP Input.dispatchMouseEvent 收的是视口坐标，而 DOM.getBoxModel 给的是文档坐标
// （含滚动偏移）——页面滚动后直接用会点偏甚至点到别的元素。这里先把元素滚进视口，
// 再用 getBoundingClientRect 取视口坐标。
func (s *service) elementViewportPoint(ctx context.Context, b *Browser, session, objectID string) (float64, float64, error) {
	if _, err := b.Call(ctx, "Runtime.callFunctionOn", map[string]any{
		"objectId":            objectID,
		"functionDeclaration": `function(){ this.scrollIntoView({block:'center', inline:'center'}); return true; }`,
		"returnByValue":       true,
	}, session); err != nil {
		return 0, 0, err
	}
	raw, err := b.Call(ctx, "Runtime.callFunctionOn", map[string]any{
		"objectId":            objectID,
		"functionDeclaration": `function(){ const r=this.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; }`,
		"returnByValue":       true,
	}, session)
	if err != nil {
		return 0, 0, err
	}
	var payload struct {
		Result struct {
			Value struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			} `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return 0, 0, fmt.Errorf("decode viewport point: %w", err)
	}
	return payload.Result.Value.X, payload.Result.Value.Y, nil
}

type clickInput struct {
	targetInput
	Ref string `json:"ref" jsonschema:"element reference from the latest snapshot, for example e3"`
}

func (s *service) toolClick(ctx context.Context, _ *mcp.CallToolRequest, in clickInput) (*mcp.CallToolResult, any, error) {
	entry, ok := s.refs.get(in.Ref)
	if !ok {
		return nil, nil, fmt.Errorf("unknown ref %q; take a snapshot first", in.Ref)
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	objectID, err := s.resolveObjectID(ctx, b, session, entry.NodeID)
	if err != nil {
		return nil, nil, err
	}
	x, y, err := s.elementViewportPoint(ctx, b, session, objectID)
	if err != nil {
		return nil, nil, err
	}
	for _, step := range []struct {
		Type    string
		Buttons int
	}{
		{"mouseMoved", 0},
		{"mousePressed", 1},
		{"mouseReleased", 1},
	} {
		if _, err := b.Call(ctx, "Input.dispatchMouseEvent", map[string]any{
			"type": step.Type, "x": x, "y": y,
			"button": "left", "buttons": step.Buttons, "clickCount": 1,
		}, session); err != nil {
			return nil, nil, err
		}
	}
	return textResult(json.RawMessage(fmt.Sprintf(`{"clicked":%q,"x":%v,"y":%v}`, in.Ref, x, y))), nil, nil
}

type fillInput struct {
	targetInput
	Ref  string `json:"ref" jsonschema:"element reference from the latest snapshot"`
	Text string `json:"text" jsonschema:"text to type into the focused element"`
}

func (s *service) toolFill(ctx context.Context, _ *mcp.CallToolRequest, in fillInput) (*mcp.CallToolResult, any, error) {
	entry, ok := s.refs.get(in.Ref)
	if !ok {
		return nil, nil, fmt.Errorf("unknown ref %q; take a snapshot first", in.Ref)
	}
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	objectID, err := s.resolveObjectID(ctx, b, session, entry.NodeID)
	if err != nil {
		return nil, nil, err
	}
	if _, err := b.Call(ctx, "DOM.focus", map[string]any{"objectId": objectID}, session); err != nil {
		return nil, nil, err
	}
	if _, err := b.Call(ctx, "Input.insertText", map[string]any{"text": in.Text}, session); err != nil {
		return nil, nil, err
	}
	return textResult(json.RawMessage(fmt.Sprintf(`{"filled":%q,"text":%q}`, in.Ref, in.Text))), nil, nil
}

func (s *service) toolScreenshot(ctx context.Context, _ *mcp.CallToolRequest, in targetInput) (*mcp.CallToolResult, any, error) {
	b, err := s.ensure(ctx)
	if err != nil {
		return nil, nil, err
	}
	session, err := s.pageSession(ctx, b, in.TargetID)
	if err != nil {
		return nil, nil, err
	}
	raw, err := b.Call(ctx, "Page.captureScreenshot", map[string]any{"format": "png"}, session)
	if err != nil {
		return nil, nil, err
	}
	var payload struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, nil, fmt.Errorf("decode screenshot: %w", err)
	}
	image, err := base64.StdEncoding.DecodeString(payload.Data)
	if err != nil {
		return nil, nil, fmt.Errorf("decode screenshot payload: %w", err)
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.ImageContent{Data: image, MIMEType: "image/png"}},
	}, nil, nil
}
