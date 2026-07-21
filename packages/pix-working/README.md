<!-- markdownlint-disable MD013 -->

# pix-working

Pi core extension — shows elapsed time on the streaming **Working** indicator.

While the agent streams a response, the loader label ticks once per second:

```
Working (12s)
Working (1m 05s)
```

The counter runs from `agent_start` until `agent_end` (and clears on session shutdown), then restores pi's default label.

When the run ends, it pops a toast with the total:

```
Done in 1m 05s
```

## Install

Bundled in `@dihak/pix-core`. Standalone:

```bash
pi install npm:@dihak/pix-working
```

## Behavior

- Format: `0s` → `59s` → `1m 00s` → `1h 02m 03s`.
- Only affects the interactive TUI working message; compaction/retry loaders keep their own styling.
- No config. It's a plain counter — upgrade path: add a `pix.json` toggle if a quiet mode is ever needed.
