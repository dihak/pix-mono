---
name: suggest
description: Multi-dimensional optimization and improvement recommendations. Use when user asks "how can I improve this", "what would you change", "any suggestions", "make this better", or wants prioritized options rather than a single fix.
disable-model-invocation: true
---
# Suggest Directive

## Goal
Produce ranked, actionable list of improvements — each concrete enough to act on without further research.

## Below are what agent MUST do:

### Phase 1: Ground in Reality
- **AUTO-RUN**: Read target code and its constraints before ideating. Don't suggest from assumptions.
- **CONSTRAINTS**: Note existing conventions, tech stack, prior architectural decisions. Suggestions must fit them.

### Phase 2: Ideate Across Dimensions
Cover, where relevant:
- **DX** — developer experience, readability, locality of behavior.
- **UX** — user-facing behavior, latency, error messages.
- **Performance** — hot paths, allocations, queries.
- **Maintainability** — coupling, test coverage, dead code.

### Phase 3: Rank
- Score each by **Impact × (1/Effort)**. High-impact/low-effort first.
- **YAGNI CHECK**: drop any suggestion that adds unused capability.

### Phase 4: Report
```
## Suggestions (ranked)

### 1. [Title] — Impact: High · Effort: Low
**Problem:** [what's wrong now] — `file:line`
**Change:** [exact change, with code if small]
**Why:** [benefit]

### 2. [Title] — Impact: Med · Effort: Med
...
```

## Red Flags — STOP
- Suggesting rewrite when local fix suffices.
- Vague advice ("improve error handling") without `file:line` and concrete change.
- Recommending feature nothing will use (violates YAGNI).
- Proposing changes that conflict with existing conventions you didn't check.
