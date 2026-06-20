# pix-core

Pi coding agent extension — core UI/UX meta-package.

Installing `pix-core` pulls in all of the packages below as npm dependencies **and activates them**. A single `pi install npm:@xynogen/pix-core` boots every core extension — you do not need to install the members individually.

## How it works

Pi activates extensions per installed package via each package's `pi.extensions` manifest; it does not walk npm dependencies. So `pix-core` ships a thin aggregator (`src/extension.ts`) that imports each member's extension factory and invokes it against the same host. Each member also carries a `globalThis` idempotency guard, so installing `pix-core` **and** a member standalone activates that member only once.

## What's included

**UI / UX extensions**

| Package | Description |
|---|---|
| `pix-welcome` | ASCII π banner + startup health checks (version, auth, models, gitignore) |
| `pix-footer` | Status bar: mode / git branch / model / cost / live TPS |
| `pix-models` | `/models` — enhanced model picker with BenchLM rank, context, cost |
| `pix-update` | `/update` — self-update Pi + refresh extensions |
| `pix-commands` | `/clear` slash command |
| `pix-diagnostics` | Compact LSP diagnostic widget |
| `pix-prompts` | System-prompt injection (AGENTS.md + repo directive files) |
| `pix-skills` | Agent skill loader (`read_skills` tool + 28 bundled skills) |
| `pix-nudge` | Tool + capability nudge hooks |

**Tool suite** (drop-in replacements for Pi's built-in tools)

| Package | Description |
|---|---|
| `pix-read` | `read` — file read with syntax highlighting |
| `pix-write` | `write` — file write with split-diff rendering |
| `pix-edit` | `edit` — precise text replacement with per-edit diff |
| `pix-find` | `find` — glob search with FFF acceleration |
| `pix-grep` | `grep` — pattern search with FFF-prioritised results |
| `pix-ls` | `ls` — directory listing as an icon tree |
| `pix-bash` | `bash` — shell execution with framed output + exit-code summary |
| `pix-todo` | `todo` — durable execution checklist |
| `pix-ask` | `ask_user` — structured TUI questionnaire |

**Behaviour**

| Package | Description |
|---|---|
| `pix-optimizer` | Caveman mode + RTK tool rewriting + jq/TOON JSON compression (`/opt`) |
| `pix-gate` | Permission gate for dangerous bash commands |

## Install

```bash
pi install npm:@xynogen/pix-core
```

> Installs and activates the core pix UI/UX extensions in one command. Members are deduped if also installed directly.

## Full distro

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
