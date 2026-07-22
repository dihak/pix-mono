# pix-hotkeys

Pi extension — replaces the built-in `/hotkeys` with a grouped, scrollable modal overlay.

## What it does

Pi's stock `/hotkeys` dumps a static markdown table into the chat scroll. This extension swaps it for an interactive overlay in the same visual language as the rest of the pix distro: a rounded bordered frame, an accent-colored header with a keyboard icon, muted separators, and a footer hint line.

Bindings stay grouped into **Navigation**, **Editing**, **Other**, and **Extensions** sections. Key displays are read live from the running session's keybindings manager, so any remaps in your `keybindings.json` are reflected. Extension-registered shortcuts appear in the **Extensions** section.

Controls: `↑↓` scroll, `pgup`/`pgdn` page, `home`/`end` jump, `esc`/`enter`/`q` close.

The command is bound to the same trigger as the built-in (default `/hotkeys`). The built-in `/hotkeys` slash command and its hardcoded submit intercept are patched out of Pi's compiled host on every load — idempotent and self-healing across Pi upgrades. On a read-only host install where the patch cannot apply, the overlay still works for core keys and simply omits the Extensions section.

## Install

```bash
pi install npm:@dihak/pix-hotkeys
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
