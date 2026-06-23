---
name: handoff
description: Toggle session handoff — if HANDOFF.md does not exist, write one (giving mode); if it exists, read and delete it (receiving mode)
---

# Handoff Directive

## Overview

Single-agent session handoff via toggle. One session closes, next picks up exactly where it left off.

**Core principle:** Detect file → Give or Receive → Leave no loose ends.

## Below are what agent MUST do

### Step 1: Determine Repo Root

Resolve the directory where `HANDOFF.md` should live:

- User mentioned a specific path/repo in the prompt? Use that as root.
- Otherwise: use the `bash` tool to run `git rev-parse --show-toplevel` from the relevant directory.
- Still unclear? Ask: "Which directory is the repo root for this handoff?"

Call this resolved path **REPO_ROOT** in your reasoning only — never pass it as a shell variable.

### Step 2: Detect Mode

Use the `bash` tool to check if `HANDOFF.md` exists in REPO_ROOT:

```
bash: ls <REPO_ROOT>/HANDOFF.md
```

- File found → **Receiving Mode**
- File not found (error/empty) → **Giving Mode**

---

### Giving Mode

> No `HANDOFF.md` found. This session closing.

**Step 1: Gather context from current conversation + codebase**

Collect all of the following — summarize if long, but never drop critical decisions or failures:

- What is being built and why (goal)
- Where progress stands right now (current state)
- Which files actively being modified (files in flight)
- What changed this session (touched files + what changed)
- Every failed attempt with its reason — **most critical section**
- Single next concrete action for next session

**Step 2: Write `HANDOFF.md` in the resolved repo root using this exact structure**

```markdown
# Handoff — [feature / work area name]
**Date:** YYYY-MM-DD

## Goal
[What is being built and why — one short paragraph]

## Current State
[What works, what doesn't, where things stand]

## Files in Flight
- `path/to/file.ext` — [why this file is relevant]

## Changed
- `path/to/file.ext` — [what changed this session]

## Failed Attempts
- ❌ [What was tried] — [why it failed / what error appeared]

## Next Step
[The one concrete thing to do first in the next session]
```

**Step 3: Confirm to user**

```
Handoff written → <REPO_ROOT>/HANDOFF.md
Next session: call this skill again to resume.
```

---

### Receiving Mode

> `HANDOFF.md` found. Previous session left context.

**Step 1: Read the file**

Use the `read` tool on `<REPO_ROOT>/HANDOFF.md`.

**Step 2: Internalize before doing anything**

- Understand goal and current state fully
- Register all **Failed Attempts** — do not retry anything listed here
- Note **Files in Flight** as starting point for code exploration
- Treat **Next Step** as first action to execute

**Step 3: Delete the file**

Use the `bash` tool: `rm <REPO_ROOT>/HANDOFF.md`

Deleted immediately so next session starts fresh in giving mode.

**Step 4: Confirm and continue**

```
Handoff received. Resuming from:
→ [Next Step content]

Skipping: [brief list of Failed Attempts to avoid]
```

Then execute Next Step directly — don't ask user to repeat context already in the handoff.

---

## Red Flags — Never

- Skip mode detection step
- Write handoff without **Failed Attempts** section — even if empty, write `(none this session)`
- Leave `HANDOFF.md` on disk after receiving it
- Ask user to re-explain context already captured in handoff file
- Retry anything explicitly listed under Failed Attempts
