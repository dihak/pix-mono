# pix-skills

Pi coding agent extension — skill loader tool + skills bundle.

## What's included

| Resource | Type | Description |
|---|---|---|
| `read_skills` | tool | Browse and load bundled skills. No args → list all. `name` only → description. `name + full=true` → full instructions. |
| `skills/` | skills | 23 bundled skills (auto-loaded by pi at startup — names + descriptions in system prompt) |

## How it works

Pi loads skill *descriptions* into the system prompt at startup (progressive disclosure). Full content
only enters context when the agent calls `read_skills(name=<skill>, full=true)` — or reads the file via the `read` tool.

Skills are also discovered from `~/.pi/agent/skills/` (user-level). Bundled skills take precedence on name collision.

`read_skills` is the safe version of "agent prompts itself":

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
| `graphify` | auto — codebase question / architecture |
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
# Agent lists available skills (no args)
read_skills()

# Agent reads description of a specific skill
read_skills(name="commit")

# Agent loads full commit procedure
read_skills(name="commit", full=true)
```

## Install

```bash
pi install npm:@xynogen/pix-skills
```

Or from the monorepo:

```bash
pi install ./packages/pix-skills
```

## Full distro

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
