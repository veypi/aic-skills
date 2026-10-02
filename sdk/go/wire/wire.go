// Package wire — hosts_tools 工具契约的 provider 侧最小实现
// 契约定位：aic docs/hosts-vsh-redesign §4.1。
//
// 契约真相 = 平台协议文档与 pod 侧实现（aic-pod protocol/hosts_tools）；
// 本包是 skill provider 自包含的类型子集（Fault/ID/JSON 解码/Stream 端点），
// 与任何语言作者按文档自行实现的地位相同——provider 机制代码无关，Go 并非
// 特权语言。两侧字段必须一致：契约演进先改文档与 pod 侧，再同步本文件。
package wire

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
)

// MaxMessageBytes 单条消息上限（与 pod 侧同值）。
const MaxMessageBytes = 1 << 20

// Fault 是工具调用的结构化错误。
type Fault struct {
	Effect  string `json:"effect,omitempty"`
	Retry   string `json:"retry,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (f *Fault) Error() string     { return f.Code + ": " + f.Message }
func Fail(code, msg string) *Fault { return &Fault{Code: code, Message: msg} }

// AsFault 把任意 error 归一为 Fault（已是的取副本；上下文取消/截止与 EOF
// 映射为约定码；其余 internal）。
func AsFault(err error) *Fault {
	var f *Fault
	if errors.As(err, &f) {
		c := *f
		return &c
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Fail("deadline_exceeded", "Call deadline elapsed; effects may already have occurred")
	}
	if errors.Is(err, context.Canceled) {
		return Fail("cancelled", "Call cancelled; effects may already have occurred")
	}
	if errors.Is(err, io.EOF) {
		return Fail("end_of_stream", "Stream ended")
	}
	return Fail("internal", err.Error())
}

var idRe = regexp.MustCompile(`^[A-Za-z0-9_:-]{1,128}$`)

// ValidID 报告请求/取消身份串形态是否合法。
func ValidID(v string) bool { return idRe.MatchString(v) }

// NewID 生成随机身份串（16 字节 hex，带前缀）。
func NewID(prefix string) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b)
}

// Decode 严格 JSON 解码（有界、禁未知字段、禁拖尾）。
func Decode(raw []byte, v any) error {
	if len(raw) == 0 || len(raw) > MaxMessageBytes || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return Fail("invalid_argument", "Expected bounded JSON object")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	d.UseNumber()
	if err := d.Decode(v); err != nil {
		return Fail("invalid_argument", err.Error())
	}
	if d.Decode(new(any)) != io.EOF {
		return Fail("invalid_argument", "Unexpected trailing JSON")
	}
	return nil
}

// Stream 是不透明双向消息端点：传输适配器双向泵字节，工具代码自持消息分帧
// 与应用语义。Send/Recv 各自独立并发；实现必须响应取消，Close 必须解除双
// 侧阻塞；Send 被接受不等于对端已确认。
type Stream interface {
	Recv(context.Context) ([]byte, error)
	Send(context.Context, []byte) error
	Close() error
}
