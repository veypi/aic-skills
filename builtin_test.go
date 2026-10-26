// aicskills 契约测试：嵌入清单/目录/版本/打包/frontmatter（v6.1 内建机制）。
package aicskills

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io/fs"
	"slices"
	"strings"
	"testing"
)

func TestListAndOpen(t *testing.T) {
	names := List()
	if len(names) != 11 {
		t.Fatalf("List = %v, want eleven static skills", names)
	}
	for _, name := range []string{"create", "vhtml", "office_studio"} {
		if !slices.Contains(names, name) {
			t.Errorf("resource package %s missing", name)
		}
	}
	want := map[string]bool{"browser": true, "cua": true, "blender": true, "create": true, "vhtml": true, "office_studio": true, "drawio": true, "hello": true, "ppt_studio": true, "video_studio": true, "play_with_ai": true}
	for _, n := range names {
		if !want[n] {
			t.Fatalf("unexpected builtin package %q in %v", n, names)
		}
		dir, err := Open(n)
		if err != nil {
			t.Fatalf("Open %s: %v", n, err)
		}
		if _, err := fs.Stat(dir, "SKILL.md"); err != nil {
			t.Errorf("%s missing SKILL.md: %v", n, err)
		}
		for _, path := range []string{"provider", "cli/bin"} {
			if _, err := fs.Stat(dir, path); err == nil {
				t.Fatalf("%s contains runtime artifact %s", n, path)
			}
		}
		// Zip() 整目录打包：包内不得出现 zip / sqlite / 二进制等非静态内容
		//（cli/ 只收源码——产物随 embed 进发布会挤占 16MB 闸门且不可执行）。
		if err := fs.WalkDir(dir, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			for _, ext := range []string{".zip", ".sqlite", ".exe", ".dll", ".so", ".dylib"} {
				if strings.HasSuffix(p, ext) {
					t.Errorf("%s contains non-content artifact %s", n, p)
				}
			}
			return nil
		}); err != nil {
			t.Fatalf("walk %s: %v", n, err)
		}
	}
	if _, err := Open("ghost"); err == nil {
		t.Error("Open ghost should fail")
	}
}

func TestVersionFromFrontmatter(t *testing.T) {
	for name, want := range map[string]string{
		"browser":       "1.1.3",
		"cua":           "1.1.1",
		"blender":       "0.3.1",
		"create":        "1.0.3",
		"vhtml":         "0.5.1",
		"office_studio": "1.0.4",
		"drawio":        "1.0.3",
		"hello":         "1.0.1",
		"ppt_studio":    "1.0.4",
		"video_studio":  "1.0.3",
		"play_with_ai":  "1.0.4",
	} {
		if !slices.Contains(List(), name) {
			want = ""
		}
		if v := Version(name); v != want {
			t.Errorf("Version(%s) = %q, want %q", name, v, want)
		}
	}
	if v := Version("ghost"); v != "" {
		t.Errorf("Version(ghost) = %q, want empty", v)
	}
}

func TestZipRoundTrip(t *testing.T) {
	data, err := Zip("vhtml")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
		if f.Name == ".DS_Store" {
			t.Error("hidden junk file must not be packed")
		}
	}
	found := false
	for _, n := range names {
		if n == "SKILL.md" {
			found = true
		}
	}
	if !found {
		t.Fatalf("zip entries = %v, SKILL.md missing", names)
	}
	// frontmatter 与打包内容同源。
	name, version := Frontmatter([]byte("---\nname: demo\nversion: 2.0.0\nui:\n  - path: index.html\n---\nbody\n"))
	if name != "demo" || version != "2.0.0" {
		t.Errorf("Frontmatter = %q %q", name, version)
	}
	// 嵌套/缩进键不取（只认顶层标量）。
	name, version = Frontmatter([]byte("---\nui:\n  version: 9.9.9\nname: top\n---\n"))
	if name != "top" || version != "" {
		t.Errorf("nested frontmatter = %q %q", name, version)
	}
}

func readSkillFile(t *testing.T, dir fs.FS, path string) string {
	t.Helper()
	data, err := fs.ReadFile(dir, path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func TestCreateDataTemplateUsesExplicitRowid(t *testing.T) {
	dir, err := Open("create")
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Fields []struct {
			Name string `json:"name"`
		} `json:"fields"`
	}
	if err := json.Unmarshal([]byte(readSkillFile(t, dir, "templates/skill/tables/items.json")), &schema); err != nil {
		t.Fatal(err)
	}
	hasID := false
	for _, field := range schema.Fields {
		hasID = hasID || field.Name == "id"
	}
	list := readSkillFile(t, dir, "templates/skill/api/get.list.sqlx")
	remove := readSkillFile(t, dir, "templates/skill/api/post.remove.sqlx")
	if !hasID {
		if !strings.Contains(list, "rowid as id") || !strings.Contains(remove, "rowid = :id") {
			t.Fatalf("schema has no id; SQL must expose/use rowid explicitly:\n%s\n%s", list, remove)
		}
	}
	if !strings.Contains(list, "limit 200") {
		t.Fatalf("list query must stay bounded: %s", list)
	}
}

func TestCreateDeviceExamplesUseRealMCP(t *testing.T) {
	dir, err := Open("create")
	if err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{"templates/device", "examples/device_tool"} {
		main := readSkillFile(t, dir, root+"/cli/main.go")
		for _, want := range []string{"github.com/modelcontextprotocol/go-sdk/mcp", "mcp.NewServer", "mcp.StdioTransport"} {
			if !strings.Contains(main, want) {
				t.Errorf("%s is not a real MCP stdio service: missing %q", root, want)
			}
		}
		if strings.Contains(main, "io.ReadAll(os.Stdin)") {
			t.Errorf("%s regressed to a one-shot stdin CLI", root)
		}
		manifest := readSkillFile(t, dir, root+"/cli/manifest.json")
		if strings.Contains(manifest, `"stream"`) {
			t.Errorf("%s declares stream without a Streamer provider", root)
		}
		readSkillFile(t, dir, root+"/cli/go.mod.example")
		test := readSkillFile(t, dir, root+"/cli/main_test.go")
		if !strings.Contains(test, "TestMCPInitializeAndPing") {
			t.Errorf("%s lacks the SDK initialize + ping contract test", root)
		}
	}
}
