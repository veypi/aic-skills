// aicskills 契约测试：嵌入清单/目录/版本/打包/frontmatter（v6.1 内建机制）。
package aicskills

import (
	"archive/zip"
	"bytes"
	"io/fs"
	"slices"
	"testing"
)

func TestListAndOpen(t *testing.T) {
	names := List()
	if len(names) != 9 {
		t.Fatalf("List = %v, want nine static skills", names)
	}
	for _, name := range []string{"create_skill", "vhtml", "office_studio"} {
		if !slices.Contains(names, name) {
			t.Errorf("resource package %s missing", name)
		}
	}
	want := map[string]bool{"browser": true, "cua": true, "create_skill": true, "vhtml": true, "office_studio": true, "drawio": true, "hello": true, "ppt_studio": true, "video_studio": true}
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
		for _, path := range []string{"cli/manifest.json", "provider", "cli/bin"} {
			if _, err := fs.Stat(dir, path); err == nil {
				t.Fatalf("%s contains runtime artifact %s", n, path)
			}
		}
	}
	if _, err := Open("ghost"); err == nil {
		t.Error("Open ghost should fail")
	}
}

func TestVersionFromFrontmatter(t *testing.T) {
	for name, want := range map[string]string{
		"browser":       "1.0.10",
		"cua":           "1.0.7",
		"create_skill":  "1.0.4",
		"vhtml":         "0.1.1",
		"office_studio": "1.0.3",
		"drawio":        "1.0.0",
		"hello":         "1.0.0",
		"ppt_studio":    "1.0.0",
		"video_studio":  "1.0.0",
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
