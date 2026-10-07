# aic-skills

The official AIC **skill content repository**. A skill is `SKILL.md` plus optional `ui/`,
`api/`, `tables/` and plain resources; the Go embed carries only that static content and ships
it inside the platform (aic) and the device client (aic-pod).

[中文](README.md) | **English**

## Built-in skills

| Skill | Version | Shape |
| --- | --- | --- |
| `browser` | 1.0.10 | Prose + UI: using the device-side official `agent-browser` (0.38.2) MCP, with a live view |
| `cua` | 1.0.7 | Prose + UI: remote view and control through the official `cua-driver` (0.33.2) MCP |
| `create_skill` | 1.0.4 | Guide + templates: how to author a skill (static prose + optional cloud UI/API) |
| `office_studio` | 1.0.3 | Prose + UI: office document workspace |
| `drawio` | 1.0.0 | Prose + UI: DrawIO diagram workspace |
| `ppt_studio` | 1.0.0 | Prose + UI: slide studio |
| `video_studio` | 1.0.0 | Prose + UI: video studio |
| `vhtml` | 0.1.1 | Prose: the vhtml frontend framework guide |
| `hello` | 1.0.0 | Example: a plain native CLI |

The `//go:embed` list in [`builtin_embed.go`](builtin_embed.go) is the **only publication
switch** — a directory that is not listed is never published.

## Boundaries

- Prose, UI and cloud APIs are published and served by the platform; a skill has no
  installed / enabled / process / service state.
- CLIs and scripts run **natively**: the user installs them following the skill's instructions;
  this repository ships no binaries, no manifest and no provider / SDK layer.
- Stateful software is an **independent MCP service**: the Pod starts the official
  `agent-browser mcp` and `cua-driver mcp` (versions pinned by the Desktop bundle; standalone
  CLIs install them per the prose), and third-party services come from the device's
  `mcp.servers`.
- Skill pages open at `/skills/{id}` (loading the package's `ui/index.html`) and package
  resources are served from `/skills/cloud/{id}`; locate resources through `url_prefix` /
  `$mod.scoped` and **never hardcode platform hosts**.

## Consuming it

On the platform side, aic's `libs/skillhub` seeds built-ins at startup: on first run it writes
the whole package and creates the row (`id` = package name, owner `system`, public); a newer
embedded `version` triggers an atomic directory swap, and an equal or older version is
skipped. Devices share the same package — nothing to download.

```sh
go get github.com/veypi/aic-skills@v0.1.0
```

## Testing

```sh
go test ./...                # embed list, metadata, versions, zip round-trip

cd browser/ui && npm test    # page tests (zero dependencies, node --test)
cd cua/ui && npm test
```

## Version surfaces

- **Module version**: [VERSION](VERSION) and the `vX.Y.Z` tag, changes in
  [CHANGELOG.md](CHANGELOG.md) — the Go dependency surface consumers (aic) resolve.
- **Skill version**: the `version:` field in each `SKILL.md` — the content version the platform
  compares when deciding whether to overwrite already-seeded content.

Contributor and AI-agent notes (contracts and invariants) live in [AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
