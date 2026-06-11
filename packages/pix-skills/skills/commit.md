---
name: commit
description: Split, write, and maintain Conventional-Commit-style commits. Use only on explicit request — "commit this", "make a commit", "split these changes", "amend/squash the history".
disable-model-invocation: true
---
# Conventional Commit Management Directive

## The Iron Law
```
INVOCATION IS PERMISSION. User invoked this skill → commit without asking again.
Still forbidden: secrets, binaries, unrelated changes, trailer metadata.
```

## Below are what agent MUST do:

### Phase 1: Inspect
- **AUTO-RUN**: Run `git status` and `git diff` (staged + unstaged), then proceed straight to commit. Do NOT pause for "may I commit?" confirmation — user already asked.
- **GITIGNORE**: Before staging, inspect untracked/generated files. Add obvious ignore candidates to `.gitignore` (build dirs, caches, logs, temp files, editor/OS junk, local env files). Re-run `git status`. Uncertain whether file should be ignored vs committed → ask user before changing `.gitignore` or staging it.
- **GROUP**: Cluster changes by path/module and by functionality. Each cluster → one self-contained commit.
- **GUARD**: Scan diff for secrets, binaries, debug logs, unrelated edits. Halt and report if found.

### Phase 2: Validate

#### 2a. Detect runner
Scan project root for a task runner file in this priority order:
1. `justfile` — run `just lint check`, `just format check`, `just test unit`
2. `mise.toml` / `.mise.toml` — run `mise run lint check`, `mise run format check`, `mise run test unit`
3. `Makefile` — run `make lint-check`, `make format-check`, `make test-unit`
4. `Taskfile.yml` — run `task lint:check`, `task format:check`, `task test:unit`
5. `package.json` — run `npm run lint:check`, `npm run format:check`, `npm run test:unit`
6. `run.sh` — run `./run.sh lint check`, `./run.sh format check`, `./run.sh test unit`

#### 2b. Runner or tasks missing
If **no runner file exists** OR the runner exists but **lacks `lint`, `format`, or `test` tasks**:
- Ask user:
  > Runner / task(s) not found. Options:
  > A) **Create runner + tasks now** — invoke the `runner` skill to generate missing tasks, then run them before committing.
  > B) **Skip validation** — commit without lint/format/test (risky; recorded in commit body).
  > C) **Abort** — stop here; user will set up runner manually.
- If user picks A: invoke runner skill, generate the missing tasks, re-detect, then proceed with 2c.
- If user picks B: proceed to Phase 3. Append `skip-validation: lint format test` to commit body as a reminder.
- If user picks C: halt. Report what's missing and suggest running the `runner` skill manually.

#### 2c. Run checks (in order)
1. **Lint** (`lint check`) — static analysis. Failure → STOP, report issues, do not commit.
2. **Format** (`format check`) — style check (dry-run). Failure → auto-run `format fix`, show diff, then re-run `format check` to confirm clean. Still failing → STOP.
3. **Unit tests** (`test unit`) — correctness. Failure → STOP, report failing tests, do not commit.

All three must be green before proceeding to Phase 3.

### Phase 3: Compose
Format: `<type>(<scope>): <subject>`
- **type**: `feat` · `fix` · `chore` · `refactor` (also `docs`, `test`, `perf` when apt).
- **scope**: module/area touched. Clear, lowercase.
- **subject**: imperative, concise, no trailing period.

```
feat(auth): add token refresh on 401
fix(parser): handle empty CUDA frame without panic
refactor(api): extract response builder from handler
```

### Phase 4: Split & Stage
- Stage per cluster: `git add <paths>` (or `-p` for partial hunks).
- One commit per logical change. Never mix `feat` + unrelated `fix` in one commit.

### Phase 5: Maintain (when asked)
- Squash/amend/reorder to keep history clean. Remove WIP commits.
- Never rewrite pushed history without explicit confirmation (irreversible for collaborators).

## Authorship Rule
- Commits authored solely by user's git config identity.
- Do NOT add `Co-Authored-By`, `Signed-off-by`, or any trailer metadata.

## Red Flags — STOP
- Asking "should I commit?" after skill invoked — invocation already answered that.
- Secrets, binaries, or `console.log`/`print` debug lines in diff.
- One commit bundling unrelated changes.
- Tests/lints not run, or failing.
- Rewriting pushed history without confirmation.
