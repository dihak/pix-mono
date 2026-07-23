# pix-footer

Pi extension — status bar footer.

## What it does

Renders a persistent status bar at the bottom of the Pi TUI. The footer shows: current mode, working directory with git branch (including dirty/ahead/behind markers), context usage percentage, active model name (with thinking level when available), cumulative session token counts (in/out), session cost after those tokens, and extension statuses. During a streaming response it displays live tokens-per-second (TPS). Extension statuses (e.g. plan mode) are surfaced as additional segments.

## Install

```bash
pi install npm:@dihak/pix-footer
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
