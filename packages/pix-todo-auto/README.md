# @dihak/pix-todo-auto

Auto-continue the agent while [`pix-todo`](../pix-todo) items remain unfinished.

## What it does

On every `agent_settled`, it reads the latest persisted `todo-state` and, if any
item is still `pending` or `in_progress`, sends the agent a short nudge to keep
working through the list. No new tool — it reuses `pix-todo`'s state end to end.

It stops cleanly when:

- all items are `done`,
- any item is `blocked`,
- the user interrupted the run (Esc → the last assistant message has
  `stopReason: "aborted"`), or
- no progress was made across 3 consecutive nudges (stall guard).

## Commands

- `/todo-auto` — toggle auto-continue on/off.

## Scope

Interactive TUI only. It never auto-drives `print`, `json`, or `rpc` runs
(`ctx.hasUI` is false there).
