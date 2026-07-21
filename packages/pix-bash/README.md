# pix-bash

Pi tool — bash shell execution with pretty output.

## What it does

Replaces Pi's default `bash` tool with an enhanced version backed by `pix-pretty`. Output is rendered in a full-width framed block showing an exit-code summary, line count, and truncation notice. Call labels display the command inline; multi-line commands collapse to the first line with `… (+N lines)` until expanded. In expanded mode the full output is shown; collapsed mode caps the preview to a configurable line limit. Depends on `@dihak/pix-pretty`, which is installed automatically as a dependency.

## Auto-collapse

After a configurable delay (default 10 seconds), completed output collapses to one line, for example `✓ bash bun test · exit 0 · 42 lines`. Structured failures remain readable until the same delay, then use a compact `✗` row. Expanding either row restores the normal output or exact diagnostic without restarting the elapsed timer. The delay and per-tool toggle are controlled via the `collapse` section of `~/.pi/agent/pix.json`:

```jsonc
{
  "collapse": {
    "enabled": true,
    "delaySec": 10,
    "tools": { "bash": true }
  }
}
```

Set `collapse.tools.bash: false` (or `collapse.enabled: false`) to disable. See `@dihak/pix-data/collapse` for the full API.

## Install

```bash
pi install npm:@dihak/pix-bash
```

> Also included in [`@dihak/pix-core`](https://www.npmjs.com/package/@dihak/pix-core):
>
> ```bash
> pi install npm:@dihak/pix-core
> ```

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
