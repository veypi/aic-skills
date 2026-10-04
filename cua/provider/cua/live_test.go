//go:build darwin

package cua

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Explicitly opt in; only the temporary fixture window is operated on.
func TestNativeTypedLive(t *testing.T) {
	bin := os.Getenv("AIC_CUA_FIXTURE")
	if bin == "" {
		t.Skip("set AIC_CUA_FIXTURE to compiled testdata/ui_fixture.swift")
	}
	state := filepath.Join(t.TempDir(), "state.json")
	cmd := exec.Command(bin, state)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	s := New(Config{Logf: t.Logf})
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	invoke := func(args ...string) map[string]any {
		t.Helper()
		var out, errBuf bytes.Buffer
		code := s.Run(ctx, append(args, "--json"), "", &out, &errBuf)
		if code != 0 {
			t.Fatalf("%v: code=%d (%s)", args, code, errBuf.String())
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(out.String())), &m); err != nil {
			t.Fatalf("%v: stdout not JSON: %q", args, out.String())
		}
		return m
	}
	var window string
	for window == "" {
		r := invoke("window.list", "--pid", strconv.Itoa(cmd.Process.Pid))
		if rows, ok := r["data"].([]any); ok {
			for _, row := range rows {
				v := row.(map[string]any)
				if v["title"] == "AIC UI protocol fixture" {
					window = v["id"].(string)
				}
			}
		}
		if window != "" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("fixture window unavailable")
		case <-time.After(100 * time.Millisecond):
		}
	}
	invoke("window.observe", window)
	invoke("window.fill", window, "--label", "Fixture name", "--text", "typed native")
	invoke("window.click", window, "--role", "button", "--name", "Fixture save")
	for {
		var got struct {
			Value  string `json:"value"`
			Clicks int    `json:"clicks"`
		}
		b, _ := os.ReadFile(state)
		_ = json.Unmarshal(b, &got)
		if got.Value == "typed native" && got.Clicks == 1 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("fixture state: %s", b)
		case <-time.After(30 * time.Millisecond):
		}
	}
	r := invoke("window.observe", window, "--image")
	observation := r["observation"].(map[string]any)
	image := observation["image"].(map[string]any)
	total := 0
	for {
		part := invoke("observation.image.read", window, image["image_id"].(string), "--offset", strconv.Itoa(total))
		var v ImagePart
		raw, _ := json.Marshal(part)
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		if v.Offset != total || len(v.Bytes) == 0 {
			t.Fatal("invalid image range")
		}
		total += len(v.Bytes)
		if v.EOF {
			break
		}
	}
	if total < 100 {
		t.Fatal("empty screenshot")
	}
	type fixtureState struct {
		Clicks  int                  `json:"clicks"`
		ScrollY float64              `json:"scroll_y"`
		Points  map[string][]float64 `json:"points"`
	}
	readState := func() fixtureState {
		t.Helper()
		b, err := os.ReadFile(state)
		if err != nil {
			t.Fatal(err)
		}
		var got fixtureState
		if err := json.Unmarshal(b, &got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	point := func(obs map[string]any, name string) string {
		t.Helper()
		p := readState().Points[name]
		if len(p) != 2 {
			t.Fatalf("fixture has no %s point", name)
		}
		img := obs["image"].(map[string]any)
		return fmt.Sprintf("%g,%g", p[0]*img["width"].(float64), p[1]*img["height"].(float64))
	}
	awaitEffect := func(name string, check func(fixtureState) bool) {
		t.Helper()
		for {
			got := readState()
			if check(got) {
				return
			}
			select {
			case <-ctx.Done():
				t.Fatalf("%s not observed: %+v", name, got)
			case <-time.After(30 * time.Millisecond):
			}
		}
	}
	// Use the actual delivered image dimensions, including any wrapper scaling.
	clicked := invoke("window.click", window, "--snapshot", observation["snapshot"].(string), "--at", point(observation, "button"), "--after", "image")
	awaitEffect("coordinate click", func(got fixtureState) bool { return got.Clicks == 2 })
	t.Log("coordinate click changed fixture clicks from 1 to 2")
	observation = clicked["observation"].(map[string]any)
	before := readState().ScrollY
	invoke("window.scroll", window, "--snapshot", observation["snapshot"].(string), "--at="+point(observation, "scroll"), "--dy", "400", "--after", "image")
	awaitEffect("coordinate scroll", func(got fixtureState) bool { return got.ScrollY > before })
	t.Logf("coordinate scroll changed fixture offset from %g to %g", before, readState().ScrollY)
}
