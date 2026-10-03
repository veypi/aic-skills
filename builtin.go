// Package aicskills — 官方内建 skill 包：仓库为源、二进制内嵌、单一嵌入点。
// 契约定位 v6.1 内建机制（aic docs/skill.md §9.4）；aic 与 aic-pod 同一数据源：
//   - aic    InitBuiltin 定版到注册表（id=包名、owner='system' 公开行）+ /skills/{id}/；
//   - aic-pod 启动预装到 ~/.aic/skills（installZip 同一原子序列，零下载）。
//
// 版本取各包 SKILL.md。目录只包含完整包：源码构建提供纯资源包；
// cmd/build 为 browser/cua 构建目标平台的 provider 后，将完整包加入目录。

package aicskills

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

// List 内建包名（嵌入根下的目录名 = 包名 = 注册表 id）。按名排序，遍历稳定。
func List() []string {
	entries, err := builtin.ReadDir(".")
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// Open 包目录子树（只读；name 须为 List 成员）。
func Open(name string) (fs.FS, error) {
	sub, err := fs.Sub(builtin, name)
	if err != nil {
		return nil, fmt.Errorf("builtin skill %q: %w", name, err)
	}
	// fs.Sub 对不存在的路径不报错——显式探 SKILL.md 把 miss 摆到明处。
	if _, err := fs.Stat(sub, "SKILL.md"); err != nil {
		return nil, fmt.Errorf("builtin skill %q: %w", name, err)
	}
	return sub, nil
}

// Version 包版本（SKILL.md frontmatter version 标量；无 = ""）。
func Version(name string) string {
	dir, err := Open(name)
	if err != nil {
		return ""
	}
	data, err := fs.ReadFile(dir, "SKILL.md")
	if err != nil {
		return ""
	}
	_, v := Frontmatter(data)
	return v
}

// Zip 整包内存打包（条目相对包根，与 skillrun installZip 读侧契约一致；
// 平台垃圾文件不收）。
func Zip(name string) ([]byte, error) {
	dir, err := Open(name)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	err = fs.WalkDir(dir, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		base := filepath.Base(p)
		if strings.HasPrefix(base, ".") && p != "." {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil // .DS_Store 等隐藏文件不收
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		hdr, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(p)
		hdr.Method = zip.Deflate
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		f, err := dir.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})
	if err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Frontmatter 读 SKILL.md frontmatter 顶层 name/version（`---` 围栏内
// 无缩进 `key: value`；不引 yaml 依赖，只取两个标量键）。宽松提取，仅供
// 内嵌场景取版本真相（本包 Version / pod skillrun 预装身份解析）；aic 侧
// 完整契约走 skillhub parseSkillMD（yaml KnownFields 严格解析），两端各取
// 所需——frontmatter 字段契约真相 = aic docs/skill.md §1。
func Frontmatter(doc []byte) (name, version string) {
	lines := strings.Split(string(doc), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return "", ""
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		if line == "" || line[0] == ' ' || line[0] == '\t' || line[0] == '#' {
			continue // 只取顶层标量键
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "name":
			name = value
		case "version":
			version = value
		}
	}
	return name, version
}
