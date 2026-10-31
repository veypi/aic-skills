# aic-skills

The official AIC **skill content repository**. A skill is `SKILL.md` plus optional `ui/`,
`api/`, `tables/` and plain resources; device-side capabilities add a root `manifest.json` plus
`src/`. The Go embed carries cloud static content only (shipped with the platform, aic); device
program source lives in the package and is built on the device — the pod no longer embeds this repo.

[中文](README.md) | **English**

## Built-in skills

| Skill | Version | Shape |
| --- | --- | --- |
| `browser` | 1.2.7 | Prose + UI + device service: a Go service inside the package driving its own Chrome over CDP (AI tools + live view + human input) |
| `cua` | 1.1.3 | Prose + UI + device launcher: remote view and control through the official `cua-driver` (0.33.2) MCP |
| `blender` | 0.3.3 | Prose + device service: a Go service inside the package bridging to Blender on the device over vtools/tcp (inspect / render / run Python) |
| `create` | 1.0.5 | Guide + templates + intro page: the AIC extension authoring manual (cloud / page / host) and a human-facing capability page |
| `office_studio` | 1.0.4 | Prose + UI: office document workspace |
| `drawio` | 1.0.3 | Prose + UI: DrawIO diagram workspace |
| `ppt_studio` | 1.0.4 | Prose + UI: slide studio |
| `video_studio` | 1.0.3 | Prose + UI: video studio |
| `play_with_ai` | 1.0.4 | Prose + UI: multi-game table for playing against AI (gomoku / xiangqi) |
| `vhtml` | 0.5.1 | Prose: the vhtml frontend framework guide |
| `hello` | 1.0.1 | Example: a plain native CLI |

The `//go:embed` list in [`builtin_embed.go`](builtin_embed.go) is the **only publication
switch** — a directory that is not listed is never published.

## Boundaries

- Prose, UI and cloud APIs are published and served by the platform; a skill has no
  installed / enabled / process / service state.
- Ordinary CLIs and scripts run **natively** after user installation; a device-service package
  instead carries a root `manifest.json` (declaring `commands` / `streams`) plus `src/` program
  source. No binaries, build outputs or provider / SDK layer are committed.
- Stateful software is registered as a vsh root command through device-side **commands install**:
  browser/cua/blender behave like any other package (each ships its own service or launcher),
  while host-registered services come from device `mcp.servers`.
- Skill pages and package resources share **one segment**: `/skills/cloud/{id}` (mirrors
  `/fs/cloud` — the bare entry loads the package's `ui/index.html`, the same segment serves
  the package); subpages `/skills/cloud/{id}/{page}`; detail and management live at
  `/skills/detail/cloud/{id}` (role-dispatched; members `/members`, data `/data`). Locate resources
  through `url_prefix` / `$mod.scoped` and
  **never hardcode platform hosts**. Note the fs-tool path stays `/skills/{id}/...` (a
  different segment from the URL — do not mix them).

## Consuming it

On the platform side, aic's `skills.builtin` maintenance event seeds built-ins: first install writes
the package and creates the row (`id` = package name, owner `system`, public). Its fingerprint is the
sorted package-name + embedded-`version` list; a changed fingerprint triggers the event, and an administrator
can also force a rerun. **The run does not compare row versions**: it atomically replaces every embedded package
and fully refreshes row metadata. Bump a skill's version for every content change so the fingerprint changes.
Devices no longer share that embed: a device fetches a package with `commands install <id>` and
builds `bin/<name>` itself, as described in the package's SKILL.md.

```sh
go get github.com/veypi/aic-skills@latest
```

## Testing

```sh
go test ./...                # embed list, metadata, versions, zip round-trip

cd browser/ui && npm test    # page tests (zero dependencies, node --test)
cd cua/ui && npm test
cd play_with_ai/ui && npm test

# The root Go suite also covers both real MCP examples (initialize + tools/call)
GOWORK=off go test ./...
```

## Version surfaces

- **Module version**: [VERSION](VERSION) and the `vX.Y.Z` tag, changes in
  [CHANGELOG.md](CHANGELOG.md) — the Go dependency surface resolved by consumers (aic and aic-pod).
- **Skill version**: the `version:` field in each `SKILL.md` — the content version included in the
  `skills.builtin` fingerprint. Bump it to trigger automatic seeding; a run overwrites unconditionally and does not compare version ordering.

Contributor and AI-agent notes (contracts and invariants) live in [AGENTS.md](AGENTS.md);
the documentation map is [docs/index.md](docs/index.md).

## License

MIT — see [LICENSE](LICENSE).
