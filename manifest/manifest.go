// Package manifest 是包根 manifest.json（schema 1）的唯一权威解析器。
//
// 三方共用同一份规则，不再各维护副本：
//   - aic（云端）解析并归一化完整声明（UI + Host）；
//   - aic-pod（设备端）用同一入口，只消费 Host 字段；
//   - aic-skills 仓内契约测试直接调用本包，保证仓库内容过不了解析就过不了测试。
//
// 严格性：未知字段与旧结构（frontmatter ui、顶层 commands 等）直接报错，
// 不做兼容解析。UI 声明即使在 pod 侧也会被校验——包契约只有一个。
package manifest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

// FileName 是包根声明文件名。
const FileName = "manifest.json"

// Manifest 是包根 manifest.json 的唯一声明模型。SKILL.md 只保留手册和包元数据。
type Manifest struct {
	Schema int                    `json:"schema"`
	UI     UI                     `json:"ui,omitempty"`
	Host   map[string]HostService `json:"host,omitempty"`
}

type UI struct {
	Pages      map[string]Page      `json:"pages,omitempty"`
	Components map[string]Component `json:"components,omitempty"`
	Openers    map[string]Opener    `json:"openers,omitempty"`
}

type Page struct {
	Desc string `json:"desc,omitempty"`
}

type Component struct {
	Component string `json:"component"`
	Name      string `json:"name,omitempty"`
}

type Opener struct {
	Page  string `json:"page"`
	Match Match  `json:"match"`
	Name  string `json:"name,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

type Match struct {
	Schemes    []string `json:"schemes,omitempty"`
	Prefixes   []string `json:"prefixes,omitempty"`
	Extensions []string `json:"extensions,omitempty"`
}

type HostService struct {
	Run         []string              `json:"run,omitempty"`
	URL         string                `json:"url,omitempty"`
	Protocol    string                `json:"protocol,omitempty"`
	IdleTimeout string                `json:"idle_timeout,omitempty"`
	Streams     map[string]HostStream `json:"streams,omitempty"`
}

type HostStream struct {
	AddressEnv string `json:"address_env"`
}

var (
	localIDPattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	hostAliasPattern  = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
	schemePattern     = regexp.MustCompile(`^[a-z][a-z0-9+.-]*$`)
	streamNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

// Parse 严格解析并归一化包声明；未知字段和旧结构直接报错。
func Parse(data []byte) (*Manifest, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("manifest contains trailing JSON")
	}
	if m.Schema != 1 {
		return nil, fmt.Errorf("unsupported manifest schema %d", m.Schema)
	}
	if err := normalizeUI(&m.UI); err != nil {
		return nil, err
	}
	if err := normalizeHost(m.Host); err != nil {
		return nil, err
	}
	return &m, nil
}

func normalizeUI(ui *UI) error {
	for id, page := range ui.Pages {
		if err := validPageID(id); err != nil {
			return fmt.Errorf("ui page %q: %w", id, err)
		}
		page.Desc = strings.TrimSpace(page.Desc)
		ui.Pages[id] = page
	}
	for id, item := range ui.Components {
		if !localIDPattern.MatchString(id) {
			return fmt.Errorf("ui component %q: invalid local id", id)
		}
		if err := validComponentPath(item.Component); err != nil {
			return fmt.Errorf("ui component %q: %w", id, err)
		}
		item.Name = strings.TrimSpace(item.Name)
		ui.Components[id] = item
	}
	for id, item := range ui.Openers {
		if !localIDPattern.MatchString(id) {
			return fmt.Errorf("ui opener %q: invalid local id", id)
		}
		if !pageExists(ui.Pages, item.Page) {
			return fmt.Errorf("ui opener %q: unknown page %q", id, item.Page)
		}
		match, err := normalizeMatch(item.Match)
		if err != nil {
			return fmt.Errorf("ui opener %q: %w", id, err)
		}
		item.Match = match
		item.Name = strings.TrimSpace(item.Name)
		item.Icon = strings.TrimSpace(item.Icon)
		ui.Openers[id] = item
	}
	return nil
}

func normalizeHost(host map[string]HostService) error {
	for alias, service := range host {
		if !hostAliasPattern.MatchString(alias) {
			return fmt.Errorf("host %q: invalid alias", alias)
		}
		if (len(service.Run) == 0) == (service.URL == "") {
			return fmt.Errorf("host %s: configure exactly one of run or url", alias)
		}
		if len(service.Run) > 0 && strings.TrimSpace(service.Run[0]) == "" {
			return fmt.Errorf("host %s: run program is empty", alias)
		}
		if service.Protocol != "" && service.Protocol != "mcp" {
			return fmt.Errorf("host %s: unsupported protocol %q", alias, service.Protocol)
		}
		if service.URL != "" && service.Protocol != "mcp" {
			return fmt.Errorf("host %s: url requires protocol=mcp", alias)
		}
		if service.URL != "" && len(service.Streams) > 0 {
			return fmt.Errorf("host %s: url service cannot declare streams", alias)
		}
		if service.URL != "" {
			u, err := url.Parse(service.URL)
			if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" {
				return fmt.Errorf("host %s: invalid endpoint", alias)
			}
			if u.Scheme != "http" && u.Scheme != "https" {
				return fmt.Errorf("host %s: invalid endpoint scheme (http | https)", alias)
			}
		}
		if len(service.Streams) == 0 && service.Protocol == "" && service.IdleTimeout != "" {
			return fmt.Errorf("host %s: idle_timeout requires a resident service", alias)
		}
		if service.IdleTimeout != "" {
			d, err := time.ParseDuration(service.IdleTimeout)
			if err != nil {
				return fmt.Errorf("host %s: invalid idle_timeout: %w", alias, err)
			}
			if d <= 0 {
				return fmt.Errorf("host %s: idle_timeout must be positive", alias)
			}
		}
		owners := map[string]string{}
		for name, stream := range service.Streams {
			if !streamNamePattern.MatchString(name) {
				return fmt.Errorf("host %s: invalid stream name %q", alias, name)
			}
			if !streamNamePattern.MatchString(stream.AddressEnv) {
				return fmt.Errorf("host %s stream %s: invalid address_env %q", alias, name, stream.AddressEnv)
			}
			if previous, exists := owners[stream.AddressEnv]; exists {
				return fmt.Errorf("host %s: streams %s and %s share address_env %q", alias, previous, name, stream.AddressEnv)
			}
			owners[stream.AddressEnv] = name
		}
		host[alias] = service
	}
	return nil
}

func validPageID(id string) error {
	if id == "" || strings.HasPrefix(id, "/") || strings.ContainsAny(id, "\\?#") || strings.HasSuffix(id, ".html") {
		return fmt.Errorf("invalid page id")
	}
	if path.Clean(id) != id || id == "." || id == ".." {
		return fmt.Errorf("invalid page id")
	}
	for _, segment := range strings.Split(id, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("invalid page id")
		}
	}
	return nil
}

func validComponentPath(value string) error {
	if value == "" || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\?#") || !strings.HasSuffix(value, ".html") {
		return fmt.Errorf("component must be a relative .html path")
	}
	if path.Clean(value) != value {
		return fmt.Errorf("component must be a clean relative path")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("component must be a clean relative path")
		}
	}
	return nil
}

func pageExists(pages map[string]Page, id string) bool {
	_, ok := pages[id]
	return ok
}

func normalizeMatch(match Match) (Match, error) {
	match.Schemes = cleanStrings(match.Schemes, true)
	match.Prefixes = cleanStrings(match.Prefixes, false)
	match.Extensions = cleanStrings(match.Extensions, true)
	if len(match.Schemes)+len(match.Prefixes)+len(match.Extensions) == 0 {
		return match, fmt.Errorf("match must contain at least one dimension")
	}
	for _, values := range [][]string{match.Schemes, match.Prefixes, match.Extensions} {
		for _, value := range values {
			if value == "" || value == "*" {
				return match, fmt.Errorf("match values must be non-empty and cannot be *")
			}
		}
	}
	for _, scheme := range match.Schemes {
		if !schemePattern.MatchString(scheme) {
			return match, fmt.Errorf("invalid scheme %q", scheme)
		}
	}
	for _, prefix := range match.Prefixes {
		if !strings.HasPrefix(prefix, "/") || strings.HasPrefix(prefix, "//") || strings.ContainsAny(prefix, "?#") {
			return match, fmt.Errorf("invalid prefix %q", prefix)
		}
		for _, segment := range strings.Split(prefix, "/") {
			if segment == "." || segment == ".." {
				return match, fmt.Errorf("invalid prefix %q", prefix)
			}
		}
	}
	for _, extension := range match.Extensions {
		extension = strings.TrimPrefix(extension, ".")
		if extension == "" || strings.ContainsAny(extension, "/\\?#") {
			return match, fmt.Errorf("invalid extension")
		}
	}
	for i, extension := range match.Extensions {
		match.Extensions[i] = strings.TrimPrefix(extension, ".")
	}
	return match, nil
}

func cleanStrings(values []string, lower bool) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if lower {
			value = strings.ToLower(value)
		}
		out = append(out, value)
	}
	return out
}
