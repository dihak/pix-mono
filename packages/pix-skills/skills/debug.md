---
name: debug
description: Root-Cause Analysis and self-annealing procedure for error resolution
disable-model-invocation: true
---
# Debug & Anneal Directive

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

Phase 1 not complete → you CANNOT propose fixes.

## First Principles Debugging

Before diving into symptoms, strip problem to fundamentals:

1. **What MUST be true** for system to work correctly? List the invariants.
2. **Which invariant violated?** Bug lives where reality diverges from required truth.
3. **Why violated?** Trace from violated invariant backward — ignore surface symptoms.
4. Do NOT reason by analogy ("last time this error meant X"). Reason from mechanism ("this error means Y in state Z, which requires W to have failed").

## Below are what agent MUST do

### Phase 1: Root Cause Investigation

- **READ**: Read error messages and stack traces completely. Note line numbers, file paths, error codes.
- **REPRODUCE**: Reproduce error consistently. Not reproducible → gather more data, do NOT guess.
- **CHANGES**: Check recent changes (git diff, recent commits, new deps, config changes).
- **EVIDENCE**: Multi-component systems → add diagnostic logging at each boundary BEFORE proposing fixes. Run once to gather evidence, THEN analyze.
- **TRACE**: Trace data flow backward through call stack to find original trigger. Fix at source, not symptom.

### Phase 2: Pattern Analysis

- **EXAMPLES**: Find working examples of similar code in codebase.
- **COMPARE**: Compare working vs broken. List every difference, however small.
- **DEPENDENCIES**: Understand what config, environment, or assumptions code relies on.

### Phase 3: Hypothesis and Testing

- **HYPOTHESIZE**: State clearly: "I think X is root cause because Y." Write it down.
- **TEST MINIMALLY**: Make SMALLEST possible change to test hypothesis. One variable at a time.
- **VERIFY**: Worked? Yes → Phase 4. No → form NEW hypothesis. Do NOT stack fixes.

### Phase 4: Implementation

- **TEST FIRST**: Create failing test reproducing bug BEFORE writing fix.
- **FIX**: Implement single, targeted fix addressing root cause. No "while I'm here" changes.
- **VERIFY**: Confirm test passes and no regressions via `/test`.
- **ANNEAL**: Error due to missing rules → update appropriate Directive.

## Escalation Rule

- 3+ fixes failed → **STOP**. Question the architecture. Discuss with user before more fixes. This is wrong architecture, not wrong hypothesis.

## Red Flags — STOP and Return to Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Each fix reveals new problem in different place
