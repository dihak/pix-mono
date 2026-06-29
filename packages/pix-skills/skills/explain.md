---
name: explain
description: Technical deconstruction and logic tracing. Use when user asks "how does X work", "explain this", "walk me through", "what does this do", or needs to understand existing code/architecture before changing it.
disable-model-invocation: true
---
# Explain Directive

## Goal

Make code understandable from local reading. After explaining, reader grasps intent without re-tracing codebase themselves.

## Below are what agent MUST do

### Phase 1: Locate & Scope

- **AUTO-RUN**: Run searches and reads needed without confirmation unless input required.
- **CONTEXT**: Identify exact target — file, function, class, or concept. Quote the `file:line` under discussion.
- **READ**: Read full target plus immediate callers and callees. Don't explain from name alone.

### Phase 2: Deconstruct

- **STRUCTURE**: Break logic into named components (inputs → transform → outputs → side effects).
- **TRACE**: Map data flow and call chain. State where data enters, what mutates it, where it exits.
- **RATIONALE**: Explain the *why* behind non-obvious choices. Why unknowable → say so, don't invent intent.
- **CONTRACTS**: Note types, invariants, assumptions code relies on.

### Phase 3: Report

Use this structure:

```
## What it does
[One sentence.]

## How it works
1. [Step] — `file:line`
2. [Step] — `file:line`

## Data flow
[input] → [transform] → [output/side-effect]

## Why this way
[Design rationale, or "rationale not documented" if unknown.]

## Gotchas
[Non-obvious behavior, edge cases, hidden dependencies.]
```

## Red Flags — STOP

- Explaining from function name without reading its body.
- Inventing rationale not supported by code or comments.
- Describing *what* a line does when self-evident — explain *why* instead.
