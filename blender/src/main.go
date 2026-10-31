// Command blender 是 aic-skills/blender 包的设备服务：MCP stdio 前端 +
// addon（Blender GUI 内的 vtools/tcp 服务）后端。
//
// pod 只按统一 commands 机制拉起本程序（manifest.json），对 Blender、addon、
// 端口与生命周期没有任何专属知识——这个包和普通第三方包同等待遇。
//
// 工具面 = 生命周期工具（doctor/launch/install，始终可用）+ addon 自描述的
// 工具（ping/get_scene_info/execute_code/render/…，连上 addon 后动态注册；
// launch 成功会补齐）。
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type service struct {
	server *mcp.Server
}

// emptySchema 是无参数工具的输入 schema。
var emptySchema = json.RawMessage(`{"type":"object"}`)

func main() {
	log.SetOutput(os.Stderr)
	s := &service{server: mcp.NewServer(&mcp.Implementation{Name: "blender", Title: "Blender GUI bridge", Version: "1.0.0"}, nil)}
	s.server.AddTool(&mcp.Tool{
		Name:        "doctor",
		Description: "Three-stage check: Blender installed -> addon reachable -> handshake works. Each stage tells you the exact next command.",
		InputSchema: emptySchema,
	}, s.doctor)
	s.server.AddTool(&mcp.Tool{
		Name:        "launch",
		Description: "Start GUI Blender and boot-mount the addon (idempotent; does not touch the user's Blender config; the GUI outlives this service).",
		InputSchema: emptySchema,
	}, s.launch)
	s.server.AddTool(&mcp.Tool{
		Name:        "install",
		Description: "Write the addon into the Blender addons directory for manual enabling (for keeping it in the user's own Blender session).",
		InputSchema: emptySchema,
	}, s.install)

	// addon 已在跑就把它的工具一并注册；没在跑也不影响生命周期工具自救。
	if err := s.registerAddonTools(context.Background()); err != nil {
		log.Printf("blender: addon tools unavailable: %v", err)
	}
	if err := s.server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

// registerAddonTools 把 addon 自描述的工具注册进 MCP 面（同名覆盖，重复调用
// 安全）。schema 原样透传，参数校验由 addon 自己做。
func (s *service) registerAddonTools(ctx context.Context) error {
	client, err := connectAddon(ctx)
	if err != nil {
		return err
	}
	defer client.close()
	tools, err := client.Tools(ctx)
	if err != nil {
		return err
	}
	for _, tool := range tools {
		schema := tool.InputSchema
		if len(schema) == 0 {
			schema = emptySchema
		} else if !validObjectSchema(schema) {
			// SDK 的 AddTool 对非 object schema 会 panic：addon 版本不匹配
			// 自述出非法 schema 时跳过该工具，不能把整个服务带走。
			log.Printf("blender: skip tool %q: input schema is not a JSON object with type \"object\"", tool.Name)
			continue
		}
		s.server.AddTool(&mcp.Tool{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: schema,
		}, s.addonHandler(tool.Name))
	}
	log.Printf("blender: %d addon tools registered", len(tools))
	return nil
}

// addonHandler 把一次 MCP 调用转发给 addon（每次一条新连接：addon 在主线程
// 串行执行，客户端无需长连接管理）。
func (s *service) addonHandler(name string) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var args map[string]any
		if len(req.Params.Arguments) > 0 {
			if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}
		}
		client, err := connectAddon(ctx)
		if err != nil {
			return nil, err
		}
		defer client.close()
		result, isError, err := client.Call(ctx, name, args)
		if err != nil {
			return nil, translateAddonErr(err)
		}
		return addonResult(result, isError), nil
	}
}

// addonResult 把 addon 的 JSON 结果转成 MCP 内容。带 image_base64 的结果转成
// 图片内容（agent 可以直接看图，不用先落盘）。
func addonResult(result any, isError bool) *mcp.CallToolResult {
	if m, ok := result.(map[string]any); ok {
		if b64, ok := m["image_base64"].(string); ok && b64 != "" {
			mime, _ := m["mime"].(string)
			if mime == "" {
				mime = "image/png"
			}
			delete(m, "image_base64")
			// SDK 的 ImageContent.Data 经 json.Marshal 会再 base64 一次：
			// 这里必须存解码后的原始字节，否则 agent 拿到双重编码的坏图。
			raw, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				m["image_error"] = "image_base64 is not valid base64: " + err.Error()
				return &mcp.CallToolResult{
					Content: []mcp.Content{&mcp.TextContent{Text: jsonText(m)}},
					IsError: true,
				}
			}
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.ImageContent{Data: raw, MIMEType: mime},
					&mcp.TextContent{Text: jsonText(m)},
				},
				IsError: isError,
			}
		}
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: jsonText(result)}},
		IsError: isError,
	}
}

// validObjectSchema 校验 addon 自述的 inputSchema：必须能解析成 object 且
// type == "object"（SDK AddTool 的硬性要求）。
func validObjectSchema(raw json.RawMessage) bool {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	return m["type"] == "object"
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func jsonText(v any) string {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(raw)
}
