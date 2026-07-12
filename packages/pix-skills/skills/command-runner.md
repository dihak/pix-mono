---
name: command-runner
description: Inspect workspace health using pre-populated git context (status + diff).
disable-model-invocation: true
---

# Command Runner Skill

## Pre-Populated Git Context

The blocks below are populated with live repository state at skill-load time
via `\!`cmd`` directives — read them before acting.

### Working tree status

!`git status -s`

### Active diff

!`git diff HEAD`

## Instructions

1. Analyze the pre-populated status and diff above.
2. If unstaged files appear, ask the user before staging.
3. Only proceed with automations if the tree is clean or the user overrides.
