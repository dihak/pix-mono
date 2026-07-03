# @xynogen/pix-subagent

Pi extension — planner-driven sub-agents with 3 tools, live widget (model always visible), and explicit work-splitting.

## Install

```bash
pi install npm:@xynogen/pix-subagent
```

> Also included in [`@xynogen/pix-core`](https://www.npmjs.com/package/@xynogen/pix-core):
>
> ```bash
> pi install npm:@xynogen/pix-core
> ```

## What it does

Gives the parent agent (planner) three tools to delegate work to isolated child sessions:

| Tool | Purpose |
|---|---|
| `agent` | Spawn a background sub-agent |
| `agent_result` | Fetch latest output / full conversation by ID |
| `agent_steer` | Inject a message into a running background agent |

### The pix twist

**Model name is always visible** — in the widget header and completion notification, regardless of whether the child uses the same model as the parent. Looks like:

```
● Agents
├─ ⠹ Explore [haiku]  scout auth flow  · ↻2 · 3 tool uses · 12.4k · 1.2s
│     ⎿  grep "middleware" src/
└─ ✓ Plan [sonnet]  design refactor  · ↻5 · 2.1s
```

## Tools

### `agent` — spawn a sub-agent

```
prompt           string    Self-contained task description
description      string    3-5 words, shown in widget
subagent_type    string    Agent type (see available types in tool description)
model?           string    "provider/id" or fuzzy ("haiku") — from the live model list
allowed_tools?   string[]  Restrict child's tools (intersected, never widens)
thinking?        string    off|minimal|low|medium|high|xhigh
max_turns?       number    Omit for unlimited
resume?          string    Agent ID to continue
```

**`allowed_tools[]`** is the work-splitting hook. Pass `["read","grep","find"]` to scope an Explore agent to read-only ops. The list is intersected with the agent type's default set — it can only narrow, never widen.

**`model`** accepts `"provider/id"` or fuzzy strings like `"haiku"`, `"sonnet"`. The live list of available models (those with auth configured) is injected into the tool description so the planner can pick correctly. Unknown → error returned to planner to re-pick.

### `agent_result` — fetch result

```
agent_id   string   ID returned by agent (background)
verbose?   bool     true = full conversation; false (default) = latest text
```

Calling this suppresses the completion notification (result already consumed).

### `agent_steer` — redirect running agent

```
agent_id   string   Running background agent ID
message    string   Steering message to inject
```

Delivered after the agent's current tool execution. If the session isn't ready yet, the message is queued and delivered on session start.

## Default agent types

| Type | Tools |
|---|---|
| `general-purpose` | all (read/bash/edit/write/grep/find/ls) |
| `Explore` | read/bash/grep/find/ls (read-only) |
| `Plan` | read/bash/grep/find/ls (read-only) |

Built-in types set the **tool allowlist and persona only** — never a model. The
caller picks the model per call via the `model` parameter on the `agent` tool,
or omits it to inherit the parent's. For mechanical/read-only work pass a cheap
tier; for hard reasoning match or exceed the parent. A read-only `Explore`
worker is not automatically cheap — you make it cheap by passing a cheap-tier
model. See `model` in the `agent` tool above.

## Custom agents

Drop a `.md` file in `.pi/agents/` (project) or `~/.pi/agent/agents/` (global):

```markdown
---
description: Scout for auth-related code patterns
tools: read, grep, find
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
---
You are a read-only code scout. Find patterns, never write files.
```

Frontmatter fields: `description`, `tools` (CSV), `model` (caller-overridable default), `thinking`, `max_turns`, `extensions` (true/false/CSV), `skills` (true/false/CSV), `isolated`, `inherit_context`, `prompt_mode` (replace/append), `enabled` (false to disable).

**`model`** in a custom agent is a *caller-overridable default*: it applies
when the caller's `model:` param is omitted, but a caller's explicit `model:`
always wins. This is the pix principle — model selection is caller-decided,
always; the type/persona config never overrides it.

## Deferred (v2+)

- Git worktree isolation (`isolation: "worktree"`)
- Cron/interval scheduling (`schedule` param)
- Cross-extension RPC event bus
- `/agents` conversation viewer overlay
- Persistent agent memory (user/project/local scope)
- Smart group-join notifications for parallel fan-outs
- Chain/parallel orchestration modes

## Attribution

Spawn engine ported from [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) (MIT).
Work-splitting design inspired by [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) (MIT).
