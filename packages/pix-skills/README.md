# pix-skills

Pi coding agent extension — skill loader tool + skills bundle.

## What's included

| Resource | Type | Description |
|---|---|---|
| `read_skill` | tool | Load a bundled skill's full instructions by name. `name="list"` lists all skills with descriptions. |
| `skills/` | skills | 21 bundled skills (auto-loaded by pi at startup — names + descriptions in system prompt) |

## How it works

Pi loads skill *descriptions* into the system prompt at startup (progressive disclosure). Full content
only enters context when the agent calls `read_skill(name=<skill>)` — or reads the file via the `read` tool.

`read_skill` is the safe version of "agent prompts itself":
- Agent calls tool explicitly — no autonomous injection
- Orchestrator (user or system prompt) decides when skill loading is appropriate
- Auditable: tool call is visible in the conversation

## Skills

| Skill | Trigger |
|---|---|
| `audit` | manual |
| `bootstrap` | manual |
| `brainstorm` | manual |
| `clone` | auto — git URL / `owner/repo` |
| `commit` | manual — "commit this", "make a commit" |
| `debug` | auto — bug / error / doesn't work |
| `explain` | auto — explain / how does |
| `finish` | manual |
| `handoff` | manual |
| `plan` | auto — plan / design / architect |
| `readme` | manual |
| `review` | auto — review / check / audit |
| `runner` | manual |
| `search` | auto — search / find / look up |
| `standup` | manual |
| `suggest` | auto — suggest / recommend |
| `task` | auto — task / todo / checklist |
| `test` | auto — test / spec / coverage |
| `tldr` | auto — tldr / summarize |
| `ui` | manual |
| `verify` | auto — verify / validate / confirm |

## Usage

```
# Agent lists available skills
read_skill(name="list")

# Agent loads full commit procedure before committing
read_skill(name="commit")

# User explicitly triggers a skill
/skill:commit
```

## Install

```bash
pi install git:github.com/xynogen/pix-mono#packages/pix-skills
```

Or from the monorepo:

```bash
pi install ./packages/pix-skills
```

## License

MIT
