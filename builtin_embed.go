package aicskills

import "embed"

// Builtin skills contain static instructions, UI, API and resources only.
//
//go:embed all:create_skill all:vhtml all:office_studio all:browser all:cua
var builtin embed.FS
