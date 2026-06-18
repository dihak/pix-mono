# pix-mono

Monorepo of [Pi Coding Agent](https://github.com/badlogic/pi-mono) extensions by xynogen.

> **⚠ Expect breaking changes.** This project is under active development. Packages are regularly split, merged, renamed, or removed. The recommended upgrade path is to **uninstall then reinstall** the distro rather than incrementally updating individual packages. When in doubt, run the uninstall script first.

## Packages

### Libraries

Shared dependencies pulled in automatically — install directly only if you need them standalone.

| Package | Description |
| --- | --- |
| [`@xynogen/pix-data`](packages/pix-data) | Shared model data layer (models.dev + BenchLM), cached at `~/.cache/pi` |
| [`@xynogen/pix-pretty`](packages/pix-pretty) | Enhanced tool output rendering — syntax highlighting, icons, tree views, FFF, paste chips |

### Theme

| Package | Description |
| --- | --- |
| [`@xynogen/pix-tokyo-night`](packages/pix-tokyo-night) | Tokyo Night Storm theme |

### Providers

| Package | Description |
| --- | --- |
| [`@xynogen/pix-9router`](packages/pix-9router) | 9Router LLM provider + `fetch`/`search` tools via router API |

### Tool replacements

Drop-in replacements for Pi's built-in tools with pretty output via `pix-pretty`.

| Package | Description |
| --- | --- |
| [`@xynogen/pix-bash`](packages/pix-bash) | `bash` — shell execution with framed output block and exit-code summary |
| [`@xynogen/pix-read`](packages/pix-read) | `read` — file read with syntax highlighting and image metadata |
| [`@xynogen/pix-write`](packages/pix-write) | `write` — file write with split-diff rendering on overwrite |
| [`@xynogen/pix-edit`](packages/pix-edit) | `edit` — precise text replacement with side-by-side diff per edit |
| [`@xynogen/pix-find`](packages/pix-find) | `find` — glob search with FFF acceleration and file icons |
| [`@xynogen/pix-grep`](packages/pix-grep) | `grep` — pattern search with FFF-prioritised results |
| [`@xynogen/pix-ls`](packages/pix-ls) | `ls` — directory listing as an indented icon tree |
| [`@xynogen/pix-ask`](packages/pix-ask) | `ask_user` — structured TUI questionnaire (multi-choice, multi-select, previews) |
| [`@xynogen/pix-todo`](packages/pix-todo) | `todo` — durable execution checklist, survives context compaction |
| [`@xynogen/pix-sudo`](packages/pix-sudo) | `sudo_run` — root execution with PAM password overlay, blocked in non-interactive mode |

### Core extensions

Bundled together by [`@xynogen/pix-core`](packages/pix-core) — install all of these in one command.

| Package | Description |
| --- | --- |
| [`@xynogen/pix-welcome`](packages/pix-welcome) | ASCII π banner + startup health checks (version, auth, gitignore) |
| [`@xynogen/pix-footer`](packages/pix-footer) | Status bar — mode, git branch, model, tokens, cost, live TPS |
| [`@xynogen/pix-models`](packages/pix-models) | `/models` — enhanced model picker with BenchLM rank, context window, cost |
| [`@xynogen/pix-update`](packages/pix-update) | `/update` — self-update Pi + all extensions, detects install method |
| [`@xynogen/pix-commands`](packages/pix-commands) | `/diff` and `/clear` slash commands |
| [`@xynogen/pix-nudge`](packages/pix-nudge) | Tools nudge + capability nudge hooks to steer model toward correct tools |
| [`@xynogen/pix-diagnostics`](packages/pix-diagnostics) | Compact LSP diagnostic widget (errors + warnings across session files) |
| [`@xynogen/pix-prompts`](packages/pix-prompts) | System-prompt injection — `AGENTS.md` baseline + repo directive files |
| [`@xynogen/pix-skills`](packages/pix-skills) | Agent skill loader (`read_skills` tool + 23 bundled skills) |

### Standalone extensions

Independently installable — not included in `pix-core`.

| Package | Description |
| --- | --- |
| [`@xynogen/pix-toolbox`](packages/pix-toolbox) | `/toolbox` — fuzzy-search tool picker, enable/disable tools from prompt |
| [`@xynogen/pix-gate`](packages/pix-gate) | Permission gate for dangerous bash commands — 3 severity tiers, configurable |
| [`@xynogen/pix-optimizer`](packages/pix-optimizer) | Caveman mode + RTK tool rewriting + jq/TOON JSON compression (`/opt`) |

## Install

One-shot installer — installs Pi, sets theme/tools, then installs the whole pix distro.

Straight from GitHub (no clone needed):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

Or from a local checkout:

```bash
sh scripts/install.sh   # or: bun run install:distro
```

## Uninstall

Removes all `@xynogen/pix-*` packages from Pi. Also cleans up sub-packages from older installs that listed them individually.

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/uninstall.sh | sh
```

Or from a local checkout:

```bash
sh scripts/uninstall.sh   # or: bun run uninstall:distro
```

### Upgrade / clean reinstall

When upgrading across breaking changes, uninstall first:

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/uninstall.sh | sh
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## Development

```bash
bun install        # install all workspace deps
bun test           # run all tests
bun run typecheck  # tsc across all packages
```

## Publishing

```bash
bun run publish:dry   # verify what would be published
bun run publish:all   # publish every package to npm
```

## Lineage

Several packages here originated as forks or merges of community Pi packages:

| Upstream | Disposition |
|---|---|
| `npm:pi-caveman` | replaced by `git:github.com/jonjonrankin/pi-caveman` fork |
| `git:github.com/jonjonrankin/pi-caveman` | merged into `pix-optimizer` |
| `npm:pi-rtk-optimizer` | merged into `pix-optimizer` |
| `npm:@heyhuynhgiabuu/pi-pretty` | replaced by `@xynogen/pix-pretty` |
| `npm:@heyhuynhgiabuu/pi-diff` | superseded (merged into `pix-core`) |
| `npm:@juicesharp/rpiv-ask-user-question` | rewritten as the `ask-user` skill in `pix-core` |

Previous standalone repos migrated into this monorepo: `pix-optimizer`, `pix-tokyo-night`, `pix-pretty`, `pix-core`, `pix-9router`, `pix-data`.

## License

MIT
