package aicskills

import "embed"

// 源码构建中的包均可直接安装。cmd/build 通过 overlay 替换本文件，
// 为完整应用加入 browser/cua 资源及当次构建的 provider。
//
//go:embed all:create_skill all:vhtml all:office_studio
var builtin embed.FS
