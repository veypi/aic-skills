# 普通脚本

此目录是可选的静态附件。用户按 SKILL.md 下载、检查并运行脚本；平台不自动安装、不扫描命令、不启动服务。

例如：`sh scripts/hello.sh world`。脚本依赖、工作目录和所需权限写在技能正文中。

在 Host 或 Cloud/Pod 的 exec/vsh 内，脚本可用内建 `curl {url_prefix}/api/...` 循环处理 JSONL、目录或计算结果并批量回写结构化记录。检查响应 `code`，失败即停；批量循环不是事务，非幂等 POST 不自动重试。完整示例见 `references/cloud-data.md` §3.3。

只有需要跨调用保持连接或状态时才提供 MCP/常驻服务，并在正文中说明安装和设备配置；不要为普通 for 循环注册 MCP。
