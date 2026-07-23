# pix-core

Pi coding agent extension — core UI/UX meta-package.

Installing `pix-core` pulls in all of the packages below as npm dependencies **and activates them**. A single `pi install npm:@dihak/pix-core` boots every core extension — you do not need to install the members individually.

## How it works

Pi activates extensions per installed package via each package's `pi.extensions` manifest; it does not walk npm dependencies. So `pix-core` ships a thin aggregator (`src/extension.ts`) that imports each member's extension factory and invokes it against the same host. Each member also carries a `globalThis` idempotency guard, so installing `pix-core` **and** a member standalone activates that member only once.

## What's included

**UI / UX extensions**

| Package | Description |
|---|---|
| `pix-welcome` | ASCII π banner + startup health checks (version, auth, models, gitignore) |
| `pix-footer` | Status bar: mode / git branch / model / cost / live TPS |
| `pix-models` | `/models` — enhanced model picker with coding score/rank, context, cost |
| `pix-update` | `/update` — self-update Pi + refresh extensions |
| `pix-commands` | Slash commands — `/clear` and concurrent, context-isolated `/btw` side questions |
| `pix-diagnostics` | Compact LSP diagnostic widget |
| `pix-display` | Paste chip rendering + thinking block display |

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
| `pix-todo-auto` | auto-continue while todos remain unfinished (`/todo-auto`) |
| `pix-ask` | `ask_user` — structured TUI questionnaire |

**Shared data + behaviour**

| Package | Description |
|---|---|
| `pix-data` | Shared model data layer (models.dev + BenchLM) cached at `~/.cache/pi`; hosts the unified `~/.pi/agent/pix.json` config loader and auto-collapse helper |
| `pix-gate` | Permission gate for dangerous bash commands |
| `pix-subagent` | `agent` / `agent_result` / `agent_steer` — planner-driven sub-agents with live widget |

## Install

```bash
pi install npm:@dihak/pix-core
```

> Installs and activates the core pix UI/UX extensions in one command. Members are deduped if also installed directly.

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
