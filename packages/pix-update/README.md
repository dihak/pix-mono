# pix-update

Pi extension — `/update` self-update command.

## What it does

Registers a `/update` slash command that updates Pi and refreshes all installed `@dihak/pix-*` extensions. Detects the Pi install method (Vite-Plus `vp`, Bun, npm, Homebrew, or native) and runs the appropriate upgrade command with a retry loop that distinguishes transient errors (rate limits, timeouts, network failures) from hard failures. After updating Pi, runs `pi update --extensions` to refresh extensions from npm. The command shows a progress overlay, confirms the action upfront, and closes Pi at the end so the next launch picks up the new binaries.

## Install

```bash
pi install npm:@dihak/pix-update
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
