// manifest_contract_test.go — 全部内嵌包与 create 示例/模板的根 manifest 契约守护。
// 解析与校验走权威实现（./manifest，与 aic / aic-pod 同一 parser，不再维护本地副本）；
// 本文件只保留仓内资产检查：声明的 page 必须有对应的 ui/<id>.html。
package aicskills

import (
	"io/fs"
	"path"
	"testing"

	skillmanifest "github.com/veypi/aic-skills/manifest"
)

// checkContractManifest 校验一个包根 manifest；dir 为包根 fs，prefix 为包内相对根
// （内嵌包为 ""，create 示例/模板为各自子目录）。
func checkContractManifest(t *testing.T, dir fs.FS, prefix string) {
	t.Helper()
	label := prefix
	if label == "" {
		label = "."
	}
	data, err := fs.ReadFile(dir, path.Join(prefix, skillmanifest.FileName))
	if err != nil {
		t.Fatalf("%s: read manifest.json: %v", label, err)
	}
	m, err := skillmanifest.Parse(data)
	if err != nil {
		t.Fatalf("%s: %v", label, err)
	}
	for id := range m.UI.Pages {
		if _, err := fs.Stat(dir, path.Join(prefix, "ui", id+".html")); err != nil {
			t.Errorf("%s: page %q has no ui/%s.html: %v", label, id, id, err)
		}
	}
}

func TestBuiltinManifestContracts(t *testing.T) {
	for _, name := range List() {
		dir, err := Open(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fs.Stat(dir, "manifest.json"); err != nil {
			continue // 无 manifest 的包（纯手册）无需校验
		}
		t.Run(name, func(t *testing.T) { checkContractManifest(t, dir, "") })
	}
}

func TestCreateExampleAndTemplateManifestContracts(t *testing.T) {
	dir, err := Open("create")
	if err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{
		"examples/hello", "examples/notes", "examples/todo_min", "examples/device_tool",
		"templates/skill", "templates/device",
	} {
		t.Run(prefix, func(t *testing.T) { checkContractManifest(t, dir, prefix) })
	}
}
