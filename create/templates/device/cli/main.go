// mytool —— 设备侧程序骨架：stdin 读 JSON，stdout 输出 JSON。
// 协议：AI 调 execCall 时把参数经 stdin 传 JSON；stdout 的 JSON 保留
// content / structuredContent / isError；出错时退出码非零。
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type req struct {
	Cmd  string          `json:"cmd"`
	Args json.RawMessage `json:"args"`
}

type resp struct {
	Content string `json:"content"`
	IsError bool   `json:"isError"`
}

func main() {
	var in req
	data, _ := io.ReadAll(os.Stdin)
	if len(data) > 0 {
		if err := json.Unmarshal(data, &in); err != nil {
			out(resp{Content: "bad request: " + err.Error(), IsError: true})
			os.Exit(1)
		}
	}
	switch in.Cmd {
	case "ping":
		out(resp{Content: "pong"})
	default:
		out(resp{Content: "unknown cmd: " + in.Cmd, IsError: true})
		os.Exit(1)
	}
}

func out(r resp) {
	b, _ := json.Marshal(r)
	fmt.Println(string(b))
}
