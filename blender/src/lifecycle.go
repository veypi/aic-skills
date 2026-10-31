package main

// Blender 生命周期：可执行文件解析、addon 地址与认证、doctor/launch/install。
// 这些规则原先住在 pod 里，现在全部属于本包——pod 对 Blender 没有任何专属知识。

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const installGuide = `Blender is not installed. Install it with:
  macOS:   brew install --cask blender
  Windows: winget install BlenderFoundation.Blender
  Linux:   your distro package manager (apt/dnf install blender) or https://www.blender.org/download/
If it lives in a non-standard location, set AIC_BLENDER_EXE to the executable.`

// addonAddr 生效的 addon 地址：默认 127.0.0.1:9866，AIC_BLENDER_PORT 可改端口
// （与 addon 侧同读一个 env，launch 拉起时透传）。
func addonAddr() string {
	addr := "127.0.0.1:9866"
	if v := os.Getenv("AIC_BLENDER_PORT"); v != "" {
		if host, _, err := net.SplitHostPort(addr); err == nil {
			addr = net.JoinHostPort(host, v)
		}
	}
	return addr
}

// stateDir 是本包的运行目录（addon/boot/token/launch 状态都放这里，不动用户
// 的 Blender 配置）。
func stateDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".aic", "blender"), nil
}

// bridgeToken 是 addon 的认证 token：env AIC_BLENDER_TOKEN 优先，否则
// ~/.aic/blender/bridge_token（0600，O_EXCL 先建者赢）。本程序与 addon
// （Blender 进程内）读同一文件——人工 install 路径没有 env 透传通道。
func bridgeToken() (string, error) {
	if v := os.Getenv("AIC_BLENDER_TOKEN"); v != "" {
		return v, nil
	}
	dir, err := stateDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "bridge_token")
	if data, err := os.ReadFile(path); err == nil {
		if tok := strings.TrimSpace(string(data)); tok != "" {
			return tok, nil
		}
		// 空 token 不能静默通过：不发认证首行只会让 addon 断连成协议错误。
		return "", fmt.Errorf("blender: bridge token file %s is empty (corrupted); delete it and retry", path)
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := hex.EncodeToString(raw)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			data, rerr := os.ReadFile(path) // 并发创建：读赢家
			if rerr != nil {
				return "", rerr
			}
			tok := strings.TrimSpace(string(data))
			if tok == "" {
				return "", fmt.Errorf("blender: bridge token file %s is empty (corrupted); delete it and retry", path)
			}
			return tok, nil
		}
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(tok + "\n"); err != nil {
		return "", err
	}
	return tok, nil
}

// ---- 可执行文件解析 ----

type exeSearch struct {
	roots      []string
	glob       string
	pathLookup string
}

// exeSearches 是各平台的 Blender 安装位置（版本目录取自然序最新）。
var exeSearches = map[string]exeSearch{
	"darwin": {
		roots:      []string{"/Applications", "{home}/Applications", "/Volumes"},
		glob:       "Blender*.app/Contents/MacOS/Blender",
		pathLookup: "blender",
	},
	"windows": {
		roots:      []string{"C:/Program Files/Blender Foundation", "{env:PROGRAMFILES}/Blender Foundation", "{env:LOCALAPPDATA}/Programs"},
		glob:       "Blender*/blender.exe",
		pathLookup: "blender.exe",
	},
	"linux": {pathLookup: "blender"},
}

// expandVars 展开 {home} 与 {env:NAME} 占位。
func expandVars(s string) string {
	home, _ := os.UserHomeDir()
	s = strings.ReplaceAll(s, "{home}", home)
	for {
		i := strings.Index(s, "{env:")
		if i < 0 {
			return s
		}
		j := strings.Index(s[i:], "}")
		if j < 0 {
			return s
		}
		name := s[i+5 : i+j]
		s = s[:i] + os.Getenv(name) + s[i+j+1:]
	}
}

// naturalLess 自然序比较：连续数字段按数值比（"4.10" > "4.2"，字典序会选错）。
func naturalLess(a, b string) bool {
	digit := func(c byte) bool { return c >= '0' && c <= '9' }
	ia, ib := 0, 0
	for ia < len(a) && ib < len(b) {
		if digit(a[ia]) && digit(b[ib]) {
			ja, jb := ia, ib
			for ja < len(a) && digit(a[ja]) {
				ja++
			}
			for jb < len(b) && digit(b[jb]) {
				jb++
			}
			na, nb := strings.TrimLeft(a[ia:ja], "0"), strings.TrimLeft(b[ib:jb], "0")
			if len(na) != len(nb) {
				return len(na) < len(nb)
			}
			if na != nb {
				return na < nb
			}
			if ja-ia != jb-ib {
				return ja-ia < jb-ib
			}
			ia, ib = ja, jb
			continue
		}
		if a[ia] != b[ib] {
			return a[ia] < b[ib]
		}
		ia++
		ib++
	}
	return len(a)-ia < len(b)-ib
}

// blenderExe 定位 Blender：AIC_BLENDER_EXE → 安装目录搜索 → PATH。"" = 未安装。
func blenderExe() string {
	if v := os.Getenv("AIC_BLENDER_EXE"); v != "" {
		return v
	}
	search, ok := exeSearches[runtime.GOOS]
	if !ok {
		return ""
	}
	var found []string
	for _, root := range search.roots {
		roots, err := filepath.Glob(filepath.FromSlash(expandVars(root)))
		if err != nil {
			continue
		}
		for _, r := range roots {
			matches, err := filepath.Glob(filepath.Join(r, filepath.FromSlash(search.glob)))
			if err != nil {
				continue
			}
			found = append(found, matches...)
		}
	}
	if len(found) > 0 {
		sort.Slice(found, func(i, j int) bool { return naturalLess(found[i], found[j]) })
		return found[len(found)-1]
	}
	if search.pathLookup != "" {
		if p, err := exec.LookPath(search.pathLookup); err == nil {
			return p
		}
	}
	return ""
}

// addonSource 读包内的 addon 源码。cwd 优先（pod 把包根设为 cwd），否则按
// 可执行文件位置推包根（bin/blender → 包根）。
func addonSource() ([]byte, error) {
	candidates := []string{filepath.Join("cli", "aic_blender_bridge.py")}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "..", "cli", "aic_blender_bridge.py"))
	}
	for _, path := range candidates {
		if data, err := os.ReadFile(path); err == nil {
			return data, nil
		}
	}
	return nil, fmt.Errorf("addon asset cli/aic_blender_bridge.py not found")
}

// connectAddon 建立一条带认证的 addon 连接。
func connectAddon(ctx context.Context) (*addonClient, error) {
	token, err := bridgeToken()
	if err != nil {
		return nil, err
	}
	client, err := dialAddon(ctx, addonAddr(), token)
	return client, translateAddonErr(err)
}

// ---- doctor ----

func (s *service) doctor(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	exe := blenderExe()
	if exe == "" {
		return textResult("L1 x blender_not_installed\n" + installGuide), nil
	}
	if st, err := os.Stat(exe); err != nil || st.IsDir() {
		return textResult(fmt.Sprintf("L1 x blender_not_installed (%s does not exist: check AIC_BLENDER_EXE)\n%s", exe, installGuide)), nil
	}
	out := "L1 ok blender: " + exe + "\n"
	addr := addonAddr()
	conn, err := net.DialTimeout("tcp", addr, 1500*time.Millisecond)
	if err != nil {
		return textResult(out + fmt.Sprintf("L2 x blender_not_running (%s is unreachable)\nNext: run \"blender launch\" to start it, or start Blender manually and enable the addon", addr)), nil
	}
	_ = conn.Close()
	out += fmt.Sprintf("L2 ok addon port reachable (%s)\n", addr)
	client, err := connectAddon(ctx)
	if err != nil {
		return textResult(out + fmt.Sprintf("L3 x addon_not_connected: %s\nNext: run \"blender launch\" to re-attach the addon (it may be outdated after an upgrade)", err)), nil
	}
	defer client.close()
	ping, _, err := client.Call(ctx, "ping", map[string]any{})
	if err != nil {
		return textResult(out + fmt.Sprintf("L3 x addon_not_connected: %s\nNext: run \"blender launch\" to re-attach the addon", err)), nil
	}
	raw, _ := json.Marshal(ping)
	return textResult(out + fmt.Sprintf("L3 ok addon handshake: %s", raw)), nil
}

// ---- launch ----

// readyTimeout 是 launch 等 addon 握手的上限（冷启动到握手实测 ~1s，余量给
// 首次启动与磁盘冷缓存）。
const readyTimeout = 60 * time.Second

func (s *service) launch(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// 幂等：addon 已在服务就直接返回，顺手把工具目录补齐。
	if client, err := connectAddon(ctx); err == nil {
		defer client.close()
		if _, _, err := client.Call(ctx, "ping", map[string]any{}); err == nil {
			_ = s.registerAddonTools(ctx)
			return textResult(fmt.Sprintf("blender is already running (%s)", addonAddr())), nil
		}
	}
	exe := blenderExe()
	if exe == "" {
		return textResult("blender_not_installed\n" + installGuide), nil
	}
	if st, err := os.Stat(exe); err != nil || st.IsDir() {
		return textResult(fmt.Sprintf("blender_not_installed (%s does not exist: check AIC_BLENDER_EXE)\n%s", exe, installGuide)), nil
	}
	dir, err := stateDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	addon, err := addonSource()
	if err != nil {
		return nil, err
	}
	addonPath := filepath.Join(dir, "aic_blender_bridge.py")
	if err := os.WriteFile(addonPath, addon, 0o644); err != nil {
		return nil, err
	}
	boot := fmt.Sprintf("import runpy\nns = runpy.run_path(%q)\nns[\"start\"]()\n", addonPath)
	bootPath := filepath.Join(dir, "boot.py")
	if err := os.WriteFile(bootPath, []byte(boot), 0o644); err != nil {
		return nil, err
	}
	token, err := bridgeToken()
	if err != nil {
		return nil, err
	}
	// 拉起 GUI 并脱离本进程组：pod 重启本服务时不把用户的 Blender 一起杀掉。
	cmd := exec.Command(exe, "--python", bootPath)
	cmd.Env = append(os.Environ(), "AIC_BLENDER_TOKEN="+token)
	if v := os.Getenv("AIC_BLENDER_PORT"); v != "" {
		cmd.Env = append(cmd.Env, "AIC_BLENDER_PORT="+v)
	}
	detach(cmd)
	status := map[string]any{"exe": exe, "boot": bootPath, "addr": addonAddr(), "at": time.Now().Format(time.RFC3339)}
	statusFile := filepath.Join(dir, "launch-status.json")
	writeStatus := func() {
		raw, _ := json.MarshalIndent(status, "", "  ")
		_ = os.WriteFile(statusFile, raw, 0o644)
	}
	if err := cmd.Start(); err != nil {
		status["error"] = err.Error()
		writeStatus()
		return textResult(fmt.Sprintf("blender launch: failed to start: %s (see %s)", err, statusFile)), nil
	}
	status["pid"] = cmd.Process.Pid
	_ = cmd.Process.Release()

	// 轮询握手：ping 通了才算数——只 dial 端口会被 9866 上的无关占用者骗出
	// 假成功；探测必须带 token（addon 强制认证首行）。
	deadline := time.Now().Add(readyTimeout)
	for time.Now().Before(deadline) {
		client, err := connectAddon(ctx)
		if err == nil {
			_, _, callErr := client.Call(ctx, "ping", map[string]any{})
			client.close()
			if callErr == nil {
				status["ok"] = true
				writeStatus()
				_ = s.registerAddonTools(ctx)
				return textResult(fmt.Sprintf("blender started (pid %d, addon @ %s)", status["pid"], addonAddr())), nil
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	status["error"] = "timeout waiting for " + addonAddr()
	writeStatus()
	return textResult(fmt.Sprintf("blender started but the addon is not ready after %s (addon failed to load? run \"blender doctor\" to re-check; see %s)", readyTimeout, statusFile)), nil
}

// ---- install ----

// addonsBases 是各平台的 Blender 配置根（addons 按版本分目录）。
var addonsBases = map[string]string{
	"darwin":  "{home}/Library/Application Support/Blender",
	"linux":   "{home}/.config/blender",
	"windows": "{env:APPDATA}/Blender Foundation/Blender",
}

func (s *service) install(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	base := addonsBases[runtime.GOOS]
	if base == "" {
		return textResult("blender install: unsupported platform " + runtime.GOOS), nil
	}
	base = expandVars(base)
	matches, _ := filepath.Glob(filepath.Join(base, "*", "scripts", "addons"))
	if len(matches) == 0 {
		return textResult(fmt.Sprintf("blender install: no Blender addons directory found under %s — start Blender once to create it, or use \"blender launch\" (boot-mounts the addon, no install needed)", base)), nil
	}
	addon, err := addonSource()
	if err != nil {
		return nil, err
	}
	var written []string
	for _, dir := range matches {
		target := filepath.Join(dir, "aic_blender_bridge.py")
		if err := os.WriteFile(target, addon, 0o644); err != nil {
			return textResult(fmt.Sprintf("blender install: failed to write %s: %s", target, err)), nil
		}
		written = append(written, target)
	}
	return textResult(fmt.Sprintf("addon written to:\n  %s\nEnable it in Blender → Edit ▸ Preferences ▸ Add-ons → search \"AIC\" → enable AIC Blender Bridge (it listens on 127.0.0.1:9866 once enabled)", strings.Join(written, "\n  "))), nil
}
