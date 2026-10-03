// Build assembles complete builtin packages, then runs go build, run, or test.
// Run from the consuming module: go run ../aic-skills/cmd/build [flags] -- [go arguments].
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func main() {
	targetOS := flag.String("goos", runtime.GOOS, "target OS")
	targetArch := flag.String("goarch", runtime.GOARCH, "target architecture")
	command := flag.String("command", "build", "Go command: build, run, or test")
	flag.Parse()
	if err := build(*command, *targetOS, *targetArch, flag.Args()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		os.Exit(1)
	}
}

func build(command, goos, goarch string, args []string) error {
	switch command {
	case "build", "test":
	case "run":
		if goos != runtime.GOOS || goarch != runtime.GOARCH {
			return fmt.Errorf("go run requires the host target %s/%s", runtime.GOOS, runtime.GOARCH)
		}
	default:
		return fmt.Errorf("unsupported Go command %q", command)
	}
	rootBytes, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", "github.com/veypi/aic-skills").Output()
	if err != nil {
		return fmt.Errorf("locate aic-skills: %w", err)
	}
	root := strings.TrimSpace(string(rootBytes))
	dir, err := os.MkdirTemp("", "aic-build-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	env := append(os.Environ(), "GOOS="+goos, "GOARCH="+goarch, "CGO_ENABLED=0")
	run := func(argv ...string) error {
		cmd := exec.Command("go", argv...)
		cmd.Env = env
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	replace := map[string]string{}
	assets := []string{"all:create_skill", "all:vhtml", "all:office_studio"}
	for _, name := range []string{"browser", "cua"} {
		binary := filepath.Join(dir, name+"-service")
		if err := run("build", "-trimpath", "-o", binary, filepath.Join(root, name, "provider", "service")); err != nil {
			return fmt.Errorf("build %s for %s/%s: %w", name, goos, goarch, err)
		}
		asset := name + "/cli/bin/" + name + "-service"
		assets = append(assets, "all:"+name+"/SKILL.md", "all:"+name+"/cli/manifest.json", "all:"+name+"/ui", asset)
		replace[filepath.Join(root, filepath.FromSlash(asset))] = binary
	}
	// This file owns only the embed declaration; no application source is rewritten.
	data := "package aicskills\n\nimport \"embed\"\n\n//go:embed " + strings.Join(assets, " ") + "\nvar builtin embed.FS\n"
	generated := filepath.Join(dir, "builtin_embed.go")
	if err := os.WriteFile(generated, []byte(data), 0600); err != nil {
		return err
	}
	replace[filepath.Join(root, "builtin_embed.go")] = generated
	overlay, err := json.Marshal(struct{ Replace map[string]string }{replace})
	if err != nil {
		return err
	}
	overlayPath := filepath.Join(dir, "overlay.json")
	if err := os.WriteFile(overlayPath, overlay, 0600); err != nil {
		return err
	}
	return run(append([]string{command, "-overlay", overlayPath}, args...)...)
}
