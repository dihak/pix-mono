---
name: bootstrap
description: Project and tool scaffolding using authoritative docs for best practices. Use only on explicit request — "scaffold a project", "set up X", "bootstrap this", "init a new service".
disable-model-invocation: true
---
# Bootstrap & Scaffolding Directive

## Goal

Produce runnable, convention-correct project skeleton. New developer clones it + runs it in five minutes.

## Below are what agent MUST do

### Phase 1: Research

- **AUTO-RUN**: Run setup commands without confirmation unless input required.
- **RESEARCH**: Use authoritative docs for target language/framework setup. Don't guess flags — verify with `--help` or docs.
- **CONFIRM STACK**: Language/framework/package-manager ambiguous → ask one question before scaffolding.

### Phase 2: Scaffold

- **INIT**: Run standard init (`npm init -y`, `cargo init`, `go mod init`, `uv init`, etc.).
- **STRUCTURE**: Create standard layout — `src/`, `tests/`, `docs/`. Mirror community conventions for that ecosystem.
- **DEPENDENCIES**: Install core libs via project manager. Pin versions.
- **ENVIRONMENT**: Generate `.env.example`; document every required env var. Never write real secrets.
- **TOOLING**: Set up linter, formatter, CI config matching ecosystem defaults.

### Phase 3: Verify

- Run project build/test command. Confirm clean baseline passes.
- Confirm `README` or `.env.example` lists everything needed to run.

### Phase 4: Report

```
## Scaffolded: [project name]

**Stack:** [lang/framework/pm]
**Layout:**
  src/ ...
  tests/ ...

**Run it:**
  1. [command]
  2. [command]

**Env vars required:** see `.env.example`
**Baseline:** `[test command]` → PASS
```

## Red Flags — STOP

- Scaffolding before confirming ambiguous stack.
- Inventing init flags instead of checking docs.
- Writing real secrets into `.env` (use `.env.example` with placeholders).
- Declaring done without running baseline build/test once.
