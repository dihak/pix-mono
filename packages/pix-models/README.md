# pix-models

Pi extension — enhanced `/models` picker with coding score/rank.

## What it does

Registers a `/models` slash command that replaces Pi's built-in `/model` selector with a richer TUI picker. Each row shows the model id, context window, per-million-token cost, and a coding-focused score/rank (with star bar) when available. The list is sorted by coding score (best first), then alphabetically for unscored models. Fuzzy search filters the list as you type. Selecting a model switches the active model for the session. Model metadata is sourced from `~/.cache/pi/` via `pix-data`; the coding score/rank is computed locally from the modelgrep catalog (best = #1). Requires `@dihak/pix-data` as a dependency.

## Install

```bash
pi install npm:@dihak/pix-models
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
