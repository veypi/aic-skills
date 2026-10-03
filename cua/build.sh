#!/bin/sh
# 本地 skill install 开发包；应用分发构建统一使用 ../cmd/build。
set -eu
cd "$(dirname "$0")"
mkdir -p cli/bin
go build -o cli/bin/cua-service ./provider/service
