package aicskills

import "embed"

// Builtin skills contain static instructions, UI, API and resources only.
//
//go:embed all:create_skill all:vhtml all:office_studio all:browser all:cua all:drawio all:hello all:ppt_studio all:video_studio
var builtin embed.FS
