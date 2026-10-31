package main

// addon 的 vtools/tcp v1 客户端（行分隔 JSON，可选认证首行）：
//
//	→ {"auth":"<token>"}          ← {"ok":true}
//	→ {"id":1,"method":"tools"}   ← {"id":1,"tools":[{name,description,inputSchema}]}
//	→ {"id":2,"method":"call","name":"ping","arguments":{…}}
//	← {"id":2,"result":…,"isError":false}   或   {"id":2,"error":"…"}
//
// 客户端串行：addon 在 Blender 主线程里本就逐个执行，并发调用也要排队，
// 所以每次调用一条新连接、一次往返，省掉长连接的代际与重拨管理。

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"
)

// addonTool 是 addon 自描述的工具（schema 原样转发给 MCP 客户端）。
type addonTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type addonReply struct {
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Tools   []addonTool     `json:"tools"`
	IsError bool            `json:"isError"`
	Err     string          `json:"error"`
}

type addonClient struct {
	addr  string
	token string
	conn  net.Conn
	rd    *bufio.Reader
	mu    sync.Mutex
	seq   int
}

// addonDialTimeout 是拨号与认证握手的上限（本机回环，正常毫秒级）。
const addonDialTimeout = 10 * time.Second

// addonIOTimeout 是单次往返的 I/O 上限。MCP 工具调用的 ctx 通常无 deadline，
// 不设自己的超时会让 Blender 主线程卡死时 roundtrip 永久阻塞、close() 同锁
// 死等。取值不能太小：GUI 渲染是同一往返，30s 会误杀长渲染；更长的批渲染
// 应走无头 blender -b（见 SKILL.md）。
const addonIOTimeout = 5 * time.Minute

func dialAddon(ctx context.Context, addr, token string) (*addonClient, error) {
	var d net.Dialer
	dialCtx, cancel := context.WithTimeout(ctx, addonDialTimeout)
	defer cancel()
	conn, err := d.DialContext(dialCtx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c := &addonClient{addr: addr, token: token, conn: conn, rd: bufio.NewReader(conn)}
	if token != "" {
		if _, err := c.roundtrip(ctx, map[string]any{"auth": token}); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("addon auth failed: %w", err)
		}
	}
	return c, nil
}

func (c *addonClient) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
	}
}

// roundtrip 发一条请求并读回对应应答。auth 握手没有 id，按第一条应答算。
func (c *addonClient) roundtrip(ctx context.Context, req map[string]any) (*addonReply, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil, errors.New("addon connection is closed")
	}
	deadline := time.Now().Add(addonIOTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = c.conn.SetDeadline(deadline)
	defer c.conn.SetDeadline(time.Time{})
	id := 0
	if _, auth := req["auth"]; !auth {
		c.seq++
		id = c.seq
		req["id"] = id
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if _, err := c.conn.Write(append(data, '\n')); err != nil {
		return nil, err
	}
	for {
		line, err := c.rd.ReadBytes('\n')
		if err != nil {
			return nil, err
		}
		var rep addonReply
		if err := json.Unmarshal(line, &rep); err != nil {
			continue
		}
		if id != 0 && rep.ID != id {
			continue
		}
		if rep.Err != "" {
			return nil, errors.New(rep.Err)
		}
		return &rep, nil
	}
}

// Tools 拉 addon 的工具目录。
func (c *addonClient) Tools(ctx context.Context) ([]addonTool, error) {
	rep, err := c.roundtrip(ctx, map[string]any{"method": "tools"})
	if err != nil {
		return nil, err
	}
	return rep.Tools, nil
}

// Call 调一个 addon 工具，result 原样返回（图片在 image_base64 字段里）。
func (c *addonClient) Call(ctx context.Context, name string, args map[string]any) (any, bool, error) {
	rep, err := c.roundtrip(ctx, map[string]any{"method": "call", "name": name, "arguments": args})
	if err != nil {
		return nil, false, err
	}
	var result any
	if len(rep.Result) > 0 {
		if err := json.Unmarshal(rep.Result, &result); err != nil {
			return nil, false, fmt.Errorf("addon result is not valid JSON: %w", err)
		}
	}
	return result, rep.IsError, nil
}

// translateAddonErr 把拨号失败翻成可行动的分级指引（Blender 没在跑是常态，
// 不是异常堆栈）。
func translateAddonErr(err error) error {
	if err == nil {
		return nil
	}
	var ne *net.OpError
	if errors.As(err, &ne) {
		return fmt.Errorf("blender_not_running: addon is not connected (Blender is not running or the addon is not loaded). Run \"blender launch\" to start it, or start Blender manually and enable the addon via \"blender install\"")
	}
	return err
}
