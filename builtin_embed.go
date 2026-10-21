package aicskills

import "embed"

// Builtin skills contain static instructions, UI, API, tables and resources,
// plus optional cli/ host-side program *source*（aic-pod 等执行端消费；二进制
// 与构建产物永不入库）。
//
//go:embed all:create_skill all:vhtml all:office_studio all:browser all:cua all:drawio all:hello all:ppt_studio all:video_studio all:blender all:play_with_ai
var builtin embed.FS
