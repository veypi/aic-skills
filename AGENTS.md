# Repository Guidelines

Notes for AI agents and contributors working **in this repository**. The user-facing overview
is [README.md](README.md) (Chinese) / [README.en.md](README.en.md) (English).

## What this repo is

The **official AIC skill content repository**. A skill package is the plugin unit:
`SKILL.md` (required, the AI manual) plus optional orthogonal parts — a root
`manifest.json`, `ui/`, `api/`, `tables/` for the cloud, and `src/` for execution ends (aic-pod).
The Go package embeds the package content and ships it inside the platform (aic); aic-pod
depends on this module only to distribute the official preinstalled packages (browser/cua),
versioning them onto the device at startup. Other packages are fetched by the device with
`commands install <id>` and built from `src/` when they ship their own program.

Boundary (contract truth: aic `docs/reference/skill.md`):

- Explanations, UI and cloud APIs are published and served by the platform; a skill has no
  installed/enabled/process/service state of its own.
- The root `manifest.json` uses schema 1: `ui.pages` maps page IDs (package-relative paths
  without `.html`) to `{desc}`, and `host` maps service aliases to
  `{run, url, protocol, idle_timeout}` with optional nested `streams` (`{address_env}` only).
  The device installs the package (`commands install <skill_id>`; browser/cua are preinstalled by the pod)
  and, when present, builds the program from `src/`, and registers the command; a stream is an opaque bidirectional TCP byte relay — the platform
  never parses the payload, the package owns its protocol. **Only source is committed** — no
  binaries, no build outputs.

## Layout

- Documentation follows the unified ivec layout: only `README.md` / `README.en.md` /
  `CHANGELOG.md` / `AGENTS.md` at the root, plus [docs/index.md](docs/index.md) as the map.
  Skill manuals stay inside their package (`<skill>/SKILL.md`, `<skill>/references/`) —
  they are published content, not repo docs, and are never moved into `docs/`.

- `<skill>/SKILL.md` — the only required file; frontmatter + body.
- `<skill>/manifest.json` — optional schema-1 package declaration (`ui.pages` and/or `host`).
- `<skill>/ui/` — optional cloud UI (`index.html` + modules), loaded at `/skills/cloud/{id}`.
- `<skill>/api/`, `<skill>/tables/` — optional cloud API and tables.
- `<skill>/src/` — optional device program source; the root `manifest.json` points at the
  built program (`bin/<name>`). Built on the device from this source; never executed on the cloud.
- `builtin.go` — `List` / `Open` / `Version` / `Zip` / `Frontmatter` helpers over the embed.
- `builtin_embed.go` — **the publication switch** (`//go:embed all:<dir> …`): a directory that
  is not listed is never published.
- `builtin_test.go` — contract tests (list/metadata/version/zip, and "no runtime artifacts").

## Publication & versioning rules

- Adding a skill = create `<name>/SKILL.md` with `name: <name>` **equal to the directory name**
  and a numeric `version:`, add `<name>` to the `//go:embed` list, and update the expected
  list/versions in `builtin_test.go`.
- `version:` is the **content version** and part of aic's `skills.builtin` maintenance-event
  fingerprint (package name + embedded version). A changed fingerprint triggers seeding; a forced
  rerun is also available. Once the event runs, every embedded package is replaced and its row metadata
  fully refreshed **without comparing version ordering**. This repository keeps numeric dotted versions;
  bump the affected skill on every content change so automatic seeding sees the change.
- The **module version** (`VERSION` + `CHANGELOG.md`, tag `vX.Y.Z`) is the Go dependency
  surface used by the platform consumer (aic). Release = commit → tag → push → consumer bumps `require`.
- Never put build artifacts in a skill directory (binaries, `*.zip`, `*.sqlite`):
  `builtin_test.go` fails on them, and the contract forbids them.
- Do not put a nested `go.mod` inside a skill: `go:embed` skips nested module directories,
  so the published package would ship without its source. Keep the source in the repository
  root module and ship `src/go.mod.example` so the device can build it standalone
  (`cp go.mod.example go.mod && go mod tidy && go build -o ../bin/<name> .`).

## Writing skill content

- Frontmatter fields: `name` (required, == dir), `version` (required for published skills),
  `nickname`, `description`, `keywords`, `icon` — nothing else. Page/component/opener
  declarations live in root `manifest.json` (schema 1): `ui.pages` (page id → `ui/<id>.html`),
  `ui.components`, `ui.openers`; device commands in `host`. There is no launcher section:
  `ui.pages` automatically become launcher subpages. The authoritative parser is
  `manifest/` (shared by aic and aic-pod); `manifest_contract_test.go` runs it over every
  builtin package and create template.
- Chinese is the authoring language for user-facing skill content; `vhtml/` is the exception
  (framework guide, English).
- Page/resource addressing: the page entry and the HTTP package service share **one
  segment** — `/skills/cloud/{id}` (mirrors `/fs/cloud`): the bare entry loads `ui/index.html`,
  subpages are `/skills/cloud/{id}/{page}`; detail and management live at
  `/skills/detail/cloud/{id}` (role-dispatched; members `/members`, data `/data`). Use the
  `url_prefix` returned by the `skills` tool's `search` / `load` actions for
  API/static resources, `$mod.scoped` for HTTP package paths, `$router` / `$mod.router_prefix`
  for in-page navigation. The fs-tool package path stays `/skills/{id}/...` (a different
  segment from the URL). **Never hardcode platform hosts or ports** in skill content or UI.
- Shared page services (`$auth`, `$ai`, `$hosts`, `$skills`, `$account`, `$catalog`, `$fs`,
  `$pageExec`) are documented by `create`; keep `create` aligned whenever a
  contract changes — it is what other authors copy.
- When the device tool surface changes (e.g. upstream MCP pins), update `browser/`/`cua/`
  prose and their skill `version:` in the same change.

## Build, test, verify

```sh
gofmt -l .            # must be empty
go vet ./...
go test ./...         # embed list / metadata / versions / zip round-trip

cd browser/ui && npm test     # zero-dependency: node --test (+ register hook)
cd cua/ui && npm test
cd play_with_ai/ui && npm test

# The root Go suite also covers both real MCP examples (initialize + tools/call).
GOWORK=off go test ./...
```

- Go 1.27 (see `go.mod`). Node 22+ for the UI tests; they need **no** `npm install`.
- If `proxy.golang.org` is unreachable (this network), use
  `GOPROXY=https://goproxy.cn,direct`.
- CI (`.github/workflows/ci.yml`) runs gofmt/vet/test (including both MCP example contract
  suites) and every `*/ui` `npm test`.

## Docs & language

- `README.md` is **Chinese** and is the repo's main, human-facing entry point; `README.en.md`
  is the English mirror. Both open with a language switcher line and must be updated together.
- `CHANGELOG.md`: one section per module version, breaking changes first; note the per-skill
  version bumps in the same entry.

## Commits & releases

Short imperative subjects scoped to one change (e.g. `feat(cua): …`, `docs: …`). To release:
update `VERSION`, add the `CHANGELOG.md` section, commit, tag `vX.Y.Z`, push, then bump the
`require` in the consumer (aic) — local development there uses the root `go.work` instead of
`replace` directives.
