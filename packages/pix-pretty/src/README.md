# pix-pretty/src

> **Historical doc — kept for reference only.**
>
> This file originally described pix-pretty as a vendored fork of
> `@heyhuynhgiabuu/pi-pretty`. That is no longer accurate: pix-pretty has
> been completely reimplemented. The current source layout, exports, and
> dependency graph live in the package-level [`README.md`](../README.md).
>
> The notes below remain only as a record of two behavioral decisions that
> differ from the original upstream; both are still in force.

## Behavioral decisions that survive the rewrite

These two changes were made when pix-pretty was a vendored fork and are
preserved in the reimplementation:

1. **Highlight engine: shiki → cli-highlight.**
   Upstream used `@shikijs/cli` (`codeToANSI`, TextMate grammars + WASM).
   The reimplementation uses [`cli-highlight`](https://www.npmjs.com/package/cli-highlight)
   (highlight.js-backed, synchronous). `HLJS_LANG_ALIAS` maps shiki-style ids
   (`tsx`, `jsx`, `jsonc`, `mdx`, `make`, `svelte`, `vue`) onto
   highlight.js-supported ids. The `hlBlock` interface, language table,
   line-number layout, and low-contrast normalization are unchanged.

2. **FFF state dir: `~/.pi/agent/pi-pretty/fff` → `~/.cache/pi/fff`.**
   `getPiPrettyFffDir()` resolves to `$XDG_CACHE_HOME/pi/fff` (default
   `~/.cache/pi/fff`), overridable with `PRETTY_FFF_DIR`.

## What moved out

- **Paste chip formatting** → [`@dihak/pix-display`](../pix-display)
- **Reasoning tag (`<think>`/`<thinking>`) rendering** →
  [`@dihak/pix-display`](../pix-display)

See the package-level README for the current export map.
