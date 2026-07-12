---
name: task
description: Task Orchestration and Ambiguity Resolution
disable-model-invocation: true
---
# Task Orchestration Directive

## Below are what agent MUST do

- **AUTO-RUN**: Run terminal commands and tool calls needed proactively without confirmation unless explicit input required.
- **CONTEXT**: Synthesize intent from recent history. Link "orders" to last proposed `/plan` or `/suggest`.
- **RESOLVE**: Identify and fill "Human Ambiguities" (e.g., 'fix that' → define 'that' via `/audit` or `/search` context).
- **IMPACT**: Calculate implications of task. Identify affected docs, tests, downstream dependencies. Flag potential breaking changes.
- **PRE-FLIGHT**: Audit current system state. Confirm paths, versions, permissions. Map dependency chains that could break.

## Phased Execution

Order tasks logically:

1. **Backup** — Snapshot state if destructive changes planned.
2. **Execution** — Implement changes in bite-sized steps (2-5 minutes each).
3. **Configuration** — Apply config changes after code changes verified.
4. **Validation** — Run `/test` and `/verify` to confirm correctness.

**CAUTION**: Run one chunk at a time. Verify outcome of Step N before starting Step N+1.

## Bite-Sized Task Structure

Each task step MUST be atomic and verifiable:

```
Step N: [Action]
- Files: [exact paths]
- Command: [exact command to run]
- Expected: [what success looks like]
```

## Batch Execution Pattern

For multi-task plans, execute in batches of 3 tasks:

1. Execute batch → verify each step → report what was done
2. Say: "Ready for feedback." and wait
3. Apply feedback if any → execute next batch → repeat

## Stop-When-Blocked Rule

Blocker hit mid-batch (missing dependency, failing test, unclear instruction):

- **STOP immediately** — don't guess or work around it
- Report blocker with exact context
- Ask for clarification before continuing

## Report

Provide Final Answer using Response Contract, detailing exactly what was performed.
