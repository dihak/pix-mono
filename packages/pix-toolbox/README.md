# pix-toolbox

Pi tool — gated tool toggle UI (`/toolbox`).

## What it does

Registers a `/toolbox` slash command that opens a TUI fuzzy-search picker listing every registered tool (built-in, extension, and MCP). Users can toggle tools on/off, which controls which tools are described in the system prompt via `pi.setActiveTools()`. All tools remain callable via function definitions regardless of prompt visibility — toggling only affects what the model sees in its context. Four tools (`bash`, `edit`, `read`, `write`) are protected and can never be disabled. Gate state is persisted to `~/.pi/agent/toolbox.json`. Headless subcommands are also available: `/toolbox enable <names>`, `/toolbox disable <names>`, and `/toolbox list [query]`.

## Install

```bash
pi install npm:@dihak/pix-toolbox
```

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
