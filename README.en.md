# aic-skills

The official ivec.ai **skill content repository**. A skill is `SKILL.md` plus an optional root
`manifest.json`, `ui/`, `api/`, `tables/` and plain resources; device-side capabilities add `src/`.
The Go embed carries the package content: it ships inside the platform (aic), and the pod embeds
only the official preinstalled packages (browser/cua) to version them onto the device at startup.
Device program source lives in the package and is built on the device or taken from the prebuilt
binaries shipped with the release.

[中文](README.md) | **English**

## Built-in skills

| Skill | Version | Shape |
| --- | --- | --- |
| `browser` | 1.2.15 | Prose + UI + device service: a Go service inside the package driving its own Chrome over CDP (AI tools + live view + human input) |
| `cua` | 1.1.16 | Prose + UI + device launcher: remote view and control through the official `cua-driver` (0.47.19) MCP |
| `blender` | 0.3.7 | Prose + device launcher: runs the off-the-shelf `blender-mcp` service (inspect / render / run Python) |
| `create` | 1.0.16 | Guide + templates + intro page: the ivec extension authoring manual (cloud / page / host) and a human-facing capability page |
| `design` | 0.1.2 | Guide + live examples + tools: conversational UI/UX design, original prompts, theme tokens and evidence-based review |
| `office_studio` | 1.0.8 | Prose + UI: office document workspace |
| `drawio` | 1.0.5 | Prose + UI: DrawIO diagram workspace |
| `ppt_studio` | 1.0.8 | Prose + UI: slide studio |
| `video_studio` | 1.1.11 | Prose + UI: video studio |
| `play_with_ai` | 1.0.7 | Prose + UI: multi-game table for playing against AI (gomoku / xiangqi) |
| `3d_maker` | 1.0.2 | Prose + UI: in-browser parametric CAD modeling, assemblies, print-readiness checks and STL/OBJ/GLB/3MF export |
| `vhtml` | 0.5.2 | Prose: the vhtml frontend framework guide |
| `hello` | 1.0.1 | Example: a plain native CLI |

The `//go:embed` list in [`builtin_embed.go`](builtin_embed.go) is the **only publication
switch** — a directory that is not listed is never published.

## Boundaries

- Prose, UI and cloud APIs are published and served by the platform; a skill has no
  installed / enabled / process / service state.
- The root schema-1 `manifest.json` declares `ui.pages` as a map keyed by package-relative page
  paths without `.html` (values currently contain only `desc`), and `host` services with
  `run` / `url` / `protocol` / `idle_timeout`; streams are nested in their service and contain only
  `address_env`. Device program source lives in `src/`. No binaries, build outputs or provider / SDK
  layer are committed.
- Stateful software is registered as a vsh root command through device-side **commands install**:
  browser/cua are preinstalled and versioned onto the device by the pod (the release ships prebuilt
  `bin/<name>`), while blender and third-party packages are installed with `commands install <id>`
  (each ships its own service or launcher); owner-registered services come from `commands add` or
  the device `commands` config section.
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
Devices share that embed only for the official preinstalled packages (browser/cua are versioned onto the device by the pod); other packages are fetched with `commands install <id>`,
install the dependencies described in the package's SKILL.md, and build `bin/<name>` only when the package ships its own program — preinstalled packages use the prebuilt binaries shipped with the release and need no Go toolchain.

```sh
go get github.com/veypi/aic-skills@latest
```

## Testing

```sh
go test ./...                # embed list, metadata, versions, zip round-trip

cd browser/ui && npm test    # page tests (zero dependencies, node --test)
cd cua/ui && npm test
cd design/ui && npm test
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
