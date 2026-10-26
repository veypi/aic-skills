# aic-skills

The official AIC **skill content repository**. A skill is `SKILL.md` plus optional `ui/`,
`api/`, `tables/`, `cli/` and plain resources; the Go embed carries static content and device
program source, and ships it inside the platform (aic) and the device client (aic-pod).

[中文](README.md) | **English**

## Built-in skills

| Skill | Version | Shape |
| --- | --- | --- |
| `browser` | 1.1.3 | Prose + UI: using the device-side official `agent-browser` (0.38.2) MCP, with a live view |
| `cua` | 1.1.1 | Prose + UI: remote view and control through the official `cua-driver` (0.33.2) MCP |
| `blender` | 0.3.1 | Prose: direct bridge to Blender on the device (inspect / render / run Python) |
| `create` | 1.0.3 | Guide + templates + intro page: the AIC extension authoring manual (cloud / page / host) and a human-facing capability page |
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
- Ordinary CLIs and scripts run **natively** after user installation; `cli/` may instead carry
  a device-service `manifest.json` plus program source. No binaries, build outputs or provider / SDK layer are committed.
- Stateful software is registered through **vtools** as a device service command: Browser/CUA use MCP,
  while Blender uses vtools/tcp. The Pod reads official embedded manifests at startup; third-party services
  come from device `mcp.servers`, and automatic installation/registration for user packages is not available yet.
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
Devices share the same embed — nothing to download.

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
