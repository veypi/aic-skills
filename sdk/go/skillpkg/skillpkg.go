// Package skillpkg defines the skill package manifest and artifact contract.
package skillpkg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"regexp"
	"strings"
)

const ManifestFile = "manifest.json"
const ArtifactsLockFile = "artifacts.lock.json"
const (
	KindProcess = "process"
	KindService = "service"
)

// Manifest describes the package's single provider. Resource packages omit it.
type Manifest struct {
	Kind    string   `json:"kind"`
	Entry   string   `json:"entry"`
	Args    []string `json:"args,omitempty"`
	Streams []string `json:"streams,omitempty"`
}

func ParseManifest(data []byte) (*Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("manifest: trailing JSON")
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}
func (m *Manifest) Validate() error {
	if m.Kind != KindProcess && m.Kind != KindService {
		return fmt.Errorf("manifest: kind must be process|service")
	}
	if err := ValidateRelPath(m.Entry); err != nil {
		return fmt.Errorf("manifest: entry: %w", err)
	}
	if len(m.Streams) > 0 && m.Kind != KindService {
		return fmt.Errorf("manifest: streams require service kind")
	}
	seen := map[string]bool{}
	for _, name := range m.Streams {
		if !streamName.MatchString(name) {
			return fmt.Errorf("manifest: invalid stream name %q", name)
		}
		if seen[name] {
			return fmt.Errorf("manifest: duplicate stream %q", name)
		}
		seen[name] = true
	}
	return nil
}

var streamName = regexp.MustCompile(`^[a-z][a-z0-9_.-]*$`)

// ArtifactsLock artifacts.lock.json 结构。
type ArtifactsLock struct {
	Artifacts []Artifact `json:"artifacts"`
}

// Artifact 一条大二进制声明。
type Artifact struct {
	Path   string `json:"path"`   // 落盘位置（相对包目录，不可逃逸）
	URL    string `json:"url"`    // 设备侧下载来源（https）
	SHA256 string `json:"sha256"` // 摘要（小写 64 hex）
}

var sha256Re = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ParseArtifactsLock 解析并全量校验：artifacts 非空、path 相对不逃逸、
// url 仅 https、sha256 形态合法、path 不重复。
func ParseArtifactsLock(data []byte) (*ArtifactsLock, error) {
	var l ArtifactsLock
	if err := json.Unmarshal(data, &l); err != nil {
		return nil, fmt.Errorf("artifacts.lock: bad json: %w", err)
	}
	if len(l.Artifacts) == 0 {
		return nil, fmt.Errorf("artifacts.lock: artifacts is required")
	}
	seen := map[string]bool{}
	for i, a := range l.Artifacts {
		if err := ValidateRelPath(a.Path); err != nil {
			return nil, fmt.Errorf("artifacts.lock: artifacts[%d].path: %w", i, err)
		}
		if seen[a.Path] {
			return nil, fmt.Errorf("artifacts.lock: duplicate path %q", a.Path)
		}
		seen[a.Path] = true
		if !strings.HasPrefix(a.URL, "https://") {
			return nil, fmt.Errorf("artifacts.lock: artifacts[%d].url must be https", i)
		}
		if !sha256Re.MatchString(a.SHA256) {
			return nil, fmt.Errorf("artifacts.lock: artifacts[%d].sha256 must be 64 lowercase hex", i)
		}
	}
	return &l, nil
}

// ValidateRelPath checks portable package-relative paths, independent of host OS.
func ValidateRelPath(p string) error {
	if strings.TrimSpace(p) == "" {
		return fmt.Errorf("is required")
	}
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, "~") || strings.ContainsAny(p, `\:`) {
		return fmt.Errorf("must be relative to package dir: %q", p)
	}
	clean := path.Clean(p)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return fmt.Errorf("escapes package dir: %q", p)
	}
	return nil
}
