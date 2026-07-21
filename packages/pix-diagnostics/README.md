# pix-diagnostics

Pi extension — lightweight file-touched widget.

## What it does

Registers a compact widget using the `pi-lens` widget id, overriding the external pi-lens package when both are installed. The widget tracks files touched in the current session via `write` and `edit` tool results and renders a single line showing the up-to-3 most recently-touched file basenames with a `+N more` suffix when more exist. The widget does not currently query live LSP diagnostics (that requires a full LSP client) — the file list is the placeholder, intended to be filled by LSP integration in a future version. Widget state is per-session and cleared on `session_shutdown`.

## Install

```bash
pi install npm:@dihak/pix-diagnostics
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
