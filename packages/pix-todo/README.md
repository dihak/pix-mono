# pix-todo

Pi tool — durable execution checklist (`todo`).

## What it does

Registers the `todo` tool, which gives the agent a persistent task checklist that survives context compaction and session restore. The checklist is seeded by the model via the `set` action and tracks items through four statuses: `pending` (○), `in_progress` (◐), `done` (●), and `blocked` (⊘). State is persisted via Pi's `appendEntry("todo-state")` so the agent can recover its position after long runs or compaction events. The agent calls `todo(action:"list")` to resume where it left off. Actions: `list`, `set`, `add`, `update`, `clear`.

## Auto-collapse

The checklist card auto-collapses after a configurable delay (default 10 seconds, previously hardcoded). The delay and the per-tool toggle are read from `~/.pi/agent/pix.json`:

```jsonc
{
  "collapse": {
    "enabled": true,
    "delayMs": 10000,
    "tools": { "todo": true }
  }
}
```

Set `collapse.tools.todo: false` to keep the checklist always expanded. See `@xynogen/pix-data/collapse` for the full API.

## Install

```bash
pi install npm:@xynogen/pix-todo
```

> Also included in [`@xynogen/pix-core`](https://www.npmjs.com/package/@xynogen/pix-core):
>
> ```bash
> pi install npm:@xynogen/pix-core
> ```

## Full distro

Source: [github.com/xynogen/pix-mono](https://github.com/xynogen/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
