---
name: diff
description: Review the current git changes using pre-populated status, staged, and unstaged diffs.
disable-model-invocation: true
---

# Diff Review Skill

## Pre-Populated Git Context

The blocks below are filled with live repository state at skill-load time via
`\!`cmd`` directives — read them before responding.

### Branch + short status

!`git status -sb`

### Staged changes (index vs HEAD)

!`git diff --cached --stat`

!`git diff --cached`

### Unstaged changes (working tree vs index)

!`git diff --stat`

!`git diff`

## Instructions

1. Summarize what changed: files touched, and the intent of each change.
2. Flag bugs, logic errors, security issues, and missing error handling.
3. Call out anything out of scope for the apparent goal of the change.
4. If nothing is staged and the working tree is clean, say so — there is
   nothing to review.
