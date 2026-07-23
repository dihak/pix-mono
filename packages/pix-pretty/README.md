# pix-pretty

Rendering and formatting library for Pi Coding Agent with syntax highlighting, file icons, tree views, FFF search integration, and gate-dialog overlay.

## What it does

This package is a **library + a small extension** that other pix packages
consume. It does not register user-facing tools itself — the tool renderers
(`pix-read`, `pix-bash`, `pix-ls`, `pix-find`, `pix-grep`, `pix-edit`,
`pix-write`) import from it. The extension entry point (`src/index.ts`) only
initializes the syntax-highlight theme from Pi settings, clears the highlight
cache, seeds the icon mode from `pix.json`, and registers two FFF slash
commands (`/fff-health`, `/fff-rescan`) once `pix-grep` has brought the FFF
finder online. The `/pix` settings command lives in `pix-data`.
(Activated by `pix-core`; not a standalone extension.)

### Rendering

- **Syntax highlighting** — `cli-highlight` (highlight.js-backed)
- **File icons** — type-aware icons in ls/find output
- **Tree views** — hierarchical directory display for ls
- **Diff rendering** — side-by-side split diff for edit/write
- **Bash exit summary** — colored status, line count, truncation notice

### Icon catalog (l10n-style)

Icons are treated like a localization catalog: packages never hardcode glyph
codepoints — they ask for a **semantic role** and the catalog resolves it
against one global icon mode. Reskinning, or fixing a missing-glyph (“tofu”)
problem on terminals without a Nerd Font, becomes a one-file edit here.

- **`./icon-catalog`** — `icon(key)` resolves a semantic key (`"cwd"`,
  `"model"`, `"paste.image"`, …) to a glyph for the active
  mode. Modes: `nerd` (Nerd Font PUA, default), `unicode` (standard BMP glyphs,
  no patched font needed), `ascii` (plain letters). Also `iconFor(key, mode)`,
  `getIconMode()`, `setIconMode()`, `ICON_KEYS`, `ICON_MODES`.
- **`./icon-persist`** — reads/writes the icon mode via `pix.json`
  (`pretty.icons`); `initIconMode()` applies it on load.
- **`/pix`** (in `pix-data`) — unified settings overlay that includes the icon
  mode switch. One global knob governs every pix-* package (footer, paste
  chips, model picker, welcome banner). Seeded from
  `PRETTY_ICONS` (`none`/`off` → `ascii`) when no choice is saved.

### Shared overlay

- **Gate overlay** (`./gate-overlay`) — the one permission-dialog component
  shared by `pix-gate` and `pix-sudo`. Two modes: `confirm` (SelectList) and
  `sudo` (SelectList + masked password). Returns
  `{ action: "approved" | "denied" | "timeout", password? }`. Padded with
  `Box` `paddingX=2`, `paddingY=1`. The simpler `./confirm` export is the
  plain boolean Yes/No dialog.

UI features that used to live here have moved to [`pix-display`](packages/pix-display):
paste chip rendering and reasoning-tag (`<think>`/`<thinking>`) → native
`thinking` content blocks.

## Install

```bash
pi install npm:@dihak/pix-pretty
```

## Configuration

Configuration is read from **`~/.pi/agent/pix.json`** (the unified config file hosted by `@dihak/pix-data/pix-config`). The `pretty` section of that file sets the defaults for theme, icon mode, and preview lines. Environment variables still override `pix.json` values.

> **Note:** `pix-config.ts` and `collapse.ts` previously shipped with `pix-pretty` — they have moved to `pix-data` (`@dihak/pix-data/pix-config` and `@dihak/pix-data/collapse`). Update any direct imports.

### `pix.json` — `pretty` section

```jsonc
{
  "pretty": {
    "syntaxTheme": "monokai",       // syntax-highlight theme
    "icons": "nerd",          // nerd | unicode | ascii
    "maxPreviewLines": 50,
    "diffColors": true
  }
}
```

### Environment Variables (override `pix.json`)

- `PRETTY_THEME` — color theme for syntax highlighting
- `PRETTY_MAX_HL_CHARS` — max characters to highlight (default: 80000)
- `PRETTY_MAX_PREVIEW_LINES` — max lines in preview output
- `PRETTY_CACHE_LIMIT` — FFF cache size limit
- `PRETTY_ICONS` — default icon mode when none is persisted: `nerd` (default),
  `unicode`, `ascii`, or `none`/`off` (→ `ascii`).
  Note: this seeds the file-icon helpers AND the semantic icon catalog.
  Overridden by the `/pix` settings command.
- `PRETTY_MAX_RENDER_LINES` — max lines in edit/write diff render (default: 150)
- `PRETTY_FFF_DIR` — override FFF state dir (default: `~/.cache/pi/fff`)

## Public exports

The package exposes its sub-modules via `exports`:

```
@dihak/pix-pretty            (default — extension entry)
@dihak/pix-pretty/ansi
@dihak/pix-pretty/confirm
@dihak/pix-pretty/progress
@dihak/pix-pretty/config
@dihak/pix-pretty/diff
@dihak/pix-pretty/diff-render
@dihak/pix-pretty/highlight
@dihak/pix-pretty/lang
@dihak/pix-pretty/icons
@dihak/pix-pretty/icon-catalog
@dihak/pix-pretty/icon-persist
@dihak/pix-pretty/renderers
@dihak/pix-pretty/fff
@dihak/pix-pretty/types
@dihak/pix-pretty/utils
@dihak/pix-pretty/resize
@dihak/pix-pretty/context
@dihak/pix-pretty/gate-overlay
@dihak/pix-pretty/modal-frame
```

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
