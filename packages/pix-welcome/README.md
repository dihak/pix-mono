# pix-welcome

Pi extension — welcome banner with startup health checks.

## What it does

Renders a coloured ASCII π logo above the editor on session start and runs startup health checks in parallel while the banner is visible. Checks include: Pi version, auth status (at least one provider configured), loaded model + tool + skill counts, and ignore hygiene (auto-adds `.pi/` and `.pi-lens/` to `.git/info/exclude` in git repos). Each check updates the banner live as results arrive, showing ✓/⚠/✗ and a brief status. The banner auto-dismisses on the first user turn. No configuration required.

## Install

```bash
pi install npm:@dihak/pix-welcome
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
