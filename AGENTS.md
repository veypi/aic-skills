# Repository Guidelines

Notes for AI agents and contributors working **in this repository**. The user-facing overview
is [README.md](README.md) (Chinese) / [README.en.md](README.en.md) (English).

## What this repo is

The **official AIC skill content repository**. A skill is static content only: `SKILL.md`
(required) plus optional `ui/`, `api/`, `tables/` and plain resources. The Go package embeds
that content and ships it inside the platform (aic) and the device client (aic-pod); it
contains **no runnable software** — no binaries, no CLI manifest, no provider/SDK layer.

Boundary (contract truth: aic `docs/skill.md`):

- Explanations, UI and cloud APIs are published and served by the platform; a skill has no
  installed/enabled/process/service state.
- CLIs and scripts run **natively** after the user installs them per the skill's own
  instructions.
- Stateful software is an **independent MCP service**; the Pod starts the official
  `agent-browser mcp` / `cua-driver mcp` (versions pinned by the Desktop bundle) or connects
  to entries from the device's `mcp.servers`.

## Layout

- `<skill>/SKILL.md` — the only required file; frontmatter + body.
- `<skill>/ui/` — optional cloud UI (`index.html` + modules), loaded at `/skills/cloud/{id}`.
- `<skill>/api/`, `<skill>/tables/` — optional cloud API and tables.
- `builtin.go` — `List` / `Open` / `Version` / `Zip` / `Frontmatter` helpers over the embed.
- `builtin_embed.go` — **the publication switch** (`//go:embed all:<dir> …`): a directory that
  is not listed is never published.
- `builtin_test.go` — contract tests (list/metadata/version/zip, and "no runtime artifacts").

## Publication & versioning rules

- Adding a skill = create `<name>/SKILL.md` with `name: <name>` **equal to the directory name**
  and a numeric `version:`, add `<name>` to the `//go:embed` list, and update the expected
  list/versions in `builtin_test.go`.
- `version:` is the **content version**: the platform's built-in seeding compares the embedded
  version with the row version (simplified numeric dotted comparison) and only overwrites on a
  strictly newer value; a missing/empty or non-numeric version never overwrites. Bump it on
  every content change that must reach existing installs.
- The **module version** (`VERSION` + `CHANGELOG.md`, tag `vX.Y.Z`) is the Go dependency
  surface used by consumers (aic). Release = commit → tag → push → consumers bump `require`.
- Never put runnable artifacts in a skill directory (`cli/manifest.json`, `provider/`,
  `cli/bin`, binaries, `*.zip`): `builtin_test.go` fails on them, and the contract forbids them.

## Writing skill content

- Frontmatter fields: `name` (required, == dir), `version` (required for published skills),
  `nickname`, `description`, `keywords`, `icon`, `ui` (list of `{path, desc, handles?}`).
- Chinese is the authoring language for user-facing skill content; `vhtml/` is the exception
  (framework guide, English).
- Page/resource addressing: the page entry and the HTTP package service share **one
  segment** — `/skills/cloud/{id}` (mirrors `/fs/cloud`): the bare entry loads `ui/index.html`,
  subpages are `/skills/cloud/{id}/{page}`, detail is `/skills_detail/cloud/{id}`, admin is
  `/skills_admin/cloud/{id}`. Use the `url_prefix` returned by `skill search/load` for
  API/static resources, `$mod.scoped` for HTTP package paths, `$router` / `$mod.router_prefix`
  for in-page navigation. The fs-tool package path stays `/skills/{id}/...` (a different
  segment from the URL). **Never hardcode platform hosts or ports** in skill content or UI.
- Shared page services (`$auth`, `$ai`, `$hosts`, `$skills`, `$account`, `$catalog`, `$fs`,
  `$pageExec`) are documented by `create_skill`; keep `create_skill` aligned whenever a
  contract changes — it is what other authors copy.
- When the Pod's tool surface changes (e.g. upstream MCP pins), update `browser/`/`cua/`
  prose and their skill `version:` in the same change.

## Build, test, verify

```sh
gofmt -l .            # must be empty
go vet ./...
go test ./...         # embed list / metadata / versions / zip round-trip

cd browser/ui && npm test     # zero-dependency: node --test (+ register hook)
cd cua/ui && npm test
```

- Go 1.27 (see `go.mod`). Node 22+ for the UI tests; they need **no** `npm install`.
- If `proxy.golang.org` is unreachable (this network), use
  `GOPROXY=https://goproxy.cn,direct`.
- CI (`.github/workflows/ci.yml`) runs gofmt/vet/test plus every `*/ui` `npm test`.

## Docs & language

- `README.md` is **Chinese** and is the repo's main, human-facing entry point; `README.en.md`
  is the English mirror. Both open with a language switcher line and must be updated together.
- `CHANGELOG.md`: one section per module version, breaking changes first; note the per-skill
  version bumps in the same entry.

## Commits & releases

Short imperative subjects scoped to one change (e.g. `feat(cua): …`, `docs: …`). To release:
update `VERSION`, add the `CHANGELOG.md` section, commit, tag `vX.Y.Z`, push, then bump the
`require` in consumers (aic) — local development there uses the root `go.work` instead of
`replace` directives.
