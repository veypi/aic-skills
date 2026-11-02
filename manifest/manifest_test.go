package manifest

import (
	"strings"
	"testing"
)

func TestParseUIAndHost(t *testing.T) {
	m, err := Parse([]byte(`{
		"schema":1,
		"ui":{
			"pages":{"index":{"desc":" Home "},"admin/panel":{}},
			"components":{"dock":{"component":"dock.html"}},
			"openers":{"web":{"page":"index","match":{"schemes":["HTTPS","http"]}},
				"drawing":{"page":"index","match":{"prefixes":["/fs/"],"extensions":[".DRAWIO"]}}}
		},
		"host":{"browser":{
			"run":["bin/browser"],"protocol":"mcp","idle_timeout":"30m",
			"streams":{"view":{"address_env":"BROWSER_STREAM_ADDR"}}
		}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Schema != 1 || len(m.UI.Pages) != 2 || len(m.Host) != 1 {
		t.Fatalf("manifest = %+v", m)
	}
	if got := m.UI.Pages["index"].Desc; got != "Home" {
		t.Fatalf("desc = %q", got)
	}
	if got := m.UI.Openers["web"].Match.Schemes; strings.Join(got, ",") != "https,http" {
		t.Fatalf("schemes = %v", got)
	}
	if got := m.UI.Openers["drawing"].Match.Extensions[0]; got != "drawio" {
		t.Fatalf("extension = %q", got)
	}
	if got := m.Host["browser"].Streams["view"].AddressEnv; got != "BROWSER_STREAM_ADDR" {
		t.Fatalf("address_env = %q", got)
	}
}

func TestParseAllowsUIOnlyAndHostOnly(t *testing.T) {
	for _, input := range []string{
		`{"schema":1,"ui":{"pages":{"index":{}}}}`,
		`{"schema":1,"host":{"hello":{"run":["bin/hello"]}}}`,
		`{"schema":1,"host":{"remote":{"url":"http://127.0.0.1:9000/mcp","protocol":"mcp","idle_timeout":"30m"}}}`,
		`{"schema":1}`,
	} {
		if _, err := Parse([]byte(input)); err != nil {
			t.Errorf("%s: %v", input, err)
		}
	}
}

func TestParseRejectsInvalidDeclarations(t *testing.T) {
	cases := map[string]string{
		"old commands":       `{"schema":1,"commands":{"hello":{"run":["hello"]}}}`,
		"unknown field":      `{"schema":1,"ui":{"pages":{"index":{}}},"extra":true}`,
		"trailing json":      `{"schema":1} {}`,
		"bad page id":        `{"schema":1,"ui":{"pages":{"../index":{}}}}`,
		"html page id":       `{"schema":1,"ui":{"pages":{"index.html":{}}}}`,
		"bad component path": `{"schema":1,"ui":{"components":{"dock":{"component":"../dock.html"}}}}`,
		"bad opener page":    `{"schema":1,"ui":{"pages":{"index":{}},"openers":{"web":{"page":"missing","match":{"schemes":["https"]}}}}}`,
		"empty match":        `{"schema":1,"ui":{"pages":{"index":{}},"openers":{"web":{"page":"index","match":{}}}}}`,
		"wild match":         `{"schema":1,"ui":{"pages":{"index":{}},"openers":{"web":{"page":"index","match":{"schemes":["*"]}}}}}`,
		"bad scheme":         `{"schema":1,"ui":{"pages":{"index":{}},"openers":{"web":{"page":"index","match":{"schemes":["1http"]}}}}}`,
		"bad prefix":         `{"schema":1,"ui":{"pages":{"index":{}},"openers":{"web":{"page":"index","match":{"prefixes":["fs/"]}}}}}`,
		"bad host alias":     `{"schema":1,"host":{"1x":{"run":["x"]}}}`,
		"zero idle":          `{"schema":1,"host":{"x":{"run":["x"],"protocol":"mcp","idle_timeout":"0s"}}}`,
		"negative idle":      `{"schema":1,"host":{"x":{"run":["x"],"protocol":"mcp","idle_timeout":"-1s"}}}`,
		"blank url":          `{"schema":1,"host":{"x":{"url":" ","protocol":"mcp"}}}`,
		"bad url":            `{"schema":1,"host":{"x":{"url":"not a url","protocol":"mcp"}}}`,
		"tcp url":            `{"schema":1,"host":{"x":{"url":"tcp://127.0.0.1:9000","protocol":"mcp"}}}`,
		"run and url":        `{"schema":1,"host":{"x":{"run":["x"],"url":"http://localhost","protocol":"mcp"}}}`,
		"url stream":         `{"schema":1,"host":{"x":{"url":"http://localhost","protocol":"mcp","streams":{"view":{"address_env":"VIEW_ADDR"}}}}}`,
		"shared stream env":  `{"schema":1,"host":{"x":{"run":["x"],"streams":{"a":{"address_env":"ADDR"},"b":{"address_env":"ADDR"}}}}}`,
		"device owner cwd":   `{"schema":1,"host":{"x":{"run":["x"],"cwd":"/tmp"}}}`,
		"device owner env":   `{"schema":1,"host":{"x":{"run":["x"],"env":{"A":"B"}}}}`,
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(input)); err == nil {
				t.Fatalf("expected rejection: %s", input)
			}
		})
	}
}
