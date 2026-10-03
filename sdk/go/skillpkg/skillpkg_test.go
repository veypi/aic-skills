package skillpkg

import "testing"

func TestManifestContract(t *testing.T) {
	for _, raw := range []string{
		`{"kind":"process","entry":"cli/bin/run"}`,
		`{"kind":"service","entry":"cli/bin/run","streams":["page.frames","page.input"]}`,
	} {
		if _, err := ParseManifest([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{
		`{"providers":[{"id":"main","kind":"process","entry":"run"}]}`,
		`{"kind":"process","entry":"run","streams":["frames"]}`,
		`{"kind":"service","entry":"run","streams":["frames","frames"]}`,
		`{"kind":"service","entry":"run","streams":[""]}`,
		`{"kind":"daemon","entry":"run"}`,
		`{"kind":"process","entry":"../run"}`,
		`{"kind":"process","entry":"cli/../../run"}`,
		`{"kind":"process","entry":"C:\\run.exe"}`,
		`{"kind":"process","entry":"/bin/run"}`,
		`{"kind":"process","entry":"."}`,
		`{"kind":"process","entry":""}`,
	} {
		if _, err := ParseManifest([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
