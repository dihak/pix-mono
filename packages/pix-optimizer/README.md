# pix-optimizer

Token-optimization suite for Pi Coding Agent. Three tools wired into one
extension via `src/index.ts`, fronted by a single `/opt` command and one
shared status-bar cell:

- **Caveman** (`⛏`) — terse-output system prompt
- **RTK** (`⚔`) — prefixes shell commands with `rtk` + injects RTK prompt
- **TOON** (`✂`) — jq + TOON guidance for dense JSON (+ bundled skill)

## Command

One command routes to every tool:

```text
/opt                  → status + help
/opt caveman <level>  → set caveman level (1/2/3/lite/full/ultra/micro/off/config)
/opt rtk [on|off]     → toggle RTK rewriting
/opt toon [on|off]    → toggle jq+TOON guidance
```

## Status bar

A single cell always shows all three icons in a fixed order (`⛏ ⚔ ✂`), color-
coded by state: **accent** when the tool is enabled, **dim** when disabled.

## Features

### Caveman Mode (`⛏`)

Cuts ~75% of output tokens while keeping full technical accuracy.

| # | Name  | Description                  |
|---|-------|------------------------------|
| 1 | lite  | Professional, no fluff       |
| 2 | full  | Classic caveman              |
| 3 | ultra | Maximum compression          |
| – | micro | Experimental prompt-minimized |

`/opt caveman config` opens a settings dialog. Default level for new sessions
and status-bar visibility are saved to `~/.pi/agent/caveman.json`.

### RTK Tool Rewriting (`⚔`)

Two layers, both active automatically:

1. **Prompt layer** — injects the RTK system prompt (tells the model to
   prefix commands with `rtk`).
2. **Execute layer** — rewrites `bash` tool calls, prefixing known commands
   (`git`, `gh`, `cargo`, `npm`, `pnpm`, `docker`, `kubectl`, `ls`, `grep`, …)
   with `rtk` when the model forgets. **Command chains are split on `&&`,
   `||`, `;` and `|`, and every known segment is prefixed** — e.g.
   `git add . && git push` becomes `rtk git add . && rtk git push`.
   Operators inside quotes are ignored, and unparseable commands are left
   untouched. Falls back gracefully when the `rtk` binary is missing
   (warns once).

**Requirement:** the `rtk` binary must be on `PATH`.

```bash
cargo install rtk-ai
```

### TOON / JSON Compression (`✂`)

Guidance + a bundled `toon-json` skill for handling information-dense JSON via
`jq` (query/reshape) and `toon` (compress). The system-prompt nudge is injected
**only when the user prompt mentions JSON** (`json`/`jsonl`/`jq`/`toon`/
`openapi`/…). TOON shines on uniform/tabular arrays; deeply nested or
array-of-arrays data and API contracts stay as JSON.

**Requirement:** `jq` and `toon` on `PATH`.

```bash
npm i -g @toon-format/cli
```

## Installation

```bash
pi install git:github.com/xynogen/pix-optimizer
```

## Architecture

| File              | Role                                                      |
|-------------------|-----------------------------------------------------------|
| `src/index.ts`    | Wires the three tools + shared status, registers `/opt`   |
| `src/opt.ts`      | The `/opt` router: parse, complete, dispatch              |
| `src/status.ts`   | Shared status-bar cell + `OptimizerHandle` contract       |
| `src/caveman.ts`  | Caveman logic, levels, prompt, settings dialog            |
| `src/rtk.ts`      | RTK prompt + bash command rewriting                       |
| `src/json.ts`     | jq+TOON guidance, heuristics, bundled skill registration  |

Each tool registers its own lifecycle hooks and exposes an `OptimizerHandle`
that `/opt` dispatches to. All three share one `OptimizerStatus`.

## Development

```bash
bun test
```

## Origin

This package was built by merging two upstream Pi community packages:

- **Caveman mode** — merged from [`git:github.com/jonjonrankin/pi-caveman`](https://github.com/jonjonrankin/pi-caveman)
  (itself a fork of `npm:pi-caveman`). Reimplemented here with multiple compression levels,
  a settings dialog, per-session persistence, and integration with the shared `/opt` command.

- **RTK rewriting** — merged from `npm:pi-rtk-optimizer`. Reimplemented here with a two-layer
  approach: prompt injection + live bash command rewriting that handles chained commands
  (`&&`, `||`, `;`, `|`).

Both upstreams are MIT licensed. Neither codebase was copied directly — the logic was
rewritten and combined into a single extension with a unified `/opt` command and shared status bar.
This package does not sync back to either upstream.

## License

MIT
