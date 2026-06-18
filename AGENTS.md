# pix-mono — Agent Operating Guide

Monorepo of Pi Coding Agent extensions (`@xynogen/pix-*`).
Runtime: **Bun**. Linter/formatter: **Biome**. Type checker: **tsc**. Test runner: **bun test**.

---

## Repo Structure

```
packages/
  pix-9router/     # 9Router LLM provider + fetch/search tools
  pix-core/        # Core UX: welcome, footer, model picker, capability nudge, self-update
  pix-data/        # Shared model data layer (models.dev + BenchLM), cached at ~/.cache/pi
  pix-optimizer/   # Caveman mode, RTK tool rewriting, jq/TOON JSON compression
  pix-pretty/      # Shared rendering lib (highlight, diff, icons, fff) + à-la-carte tool boot
  pix-skills/      # Agent skill loader + bundled skills
  pix-themes/      # Theme pack — Tokyo Night Storm + One Dark Pro
  # ── Standalone tool packages (independently installable) ────────────────
  pix-bash/        # Tool — bash shell execution with pretty output
  pix-read/        # Tool — file read with syntax highlight
  pix-write/       # Tool — file write with diff rendering
  pix-edit/        # Tool — precise text replacement edit with diff rendering
  pix-find/        # Tool — glob file search (FFF-accelerated)
  pix-grep/        # Tool — pattern search in files (FFF-accelerated)
  pix-ls/          # Tool — directory listing with tree view
  pix-todo/        # Tool — durable execution checklist (survives context compaction)
  pix-ask/         # Tool — structured questionnaire UI (ask_user)
  pix-toolbox/     # Tool — gated tool toggle UI (/toolbox)
  pix-gate/        # Tool — permission gate for dangerous bash commands (confirm/block TUI dialog)
  pix-sudo/        # Tool — sudo_run with interactive PAM password prompt
scripts/
  dev-link.sh      # Symlink local packages into Pi for instant dev iteration
  publish-all.sh   # Publish changed packages to npm (idempotent — skips already-published versions)
  install.sh       # Install all packages into Pi
.github/workflows/
  ci.yml           # Lint + typecheck + test on push/PR to main
  publish.yml      # Publish to npm on release tag
```

---

## Development

### Install deps

```bash
bun install
```

### Local dev (symlink into Pi — no publish round-trip)

```bash
bun run dev:link     # symlink packages/pix-* → ~/.pi/agent/npm/node_modules/@xynogen/
bun run dev:unlink   # restore npm-installed copies
```

Restart Pi session after linking.

### Quality checks (run before every commit)

```bash
bun run check        # biome lint + format check
bun run typecheck    # tsc --noEmit
bun test             # unit tests
```

Auto-fix lint/format:

```bash
bun run check:fix
```

---

## Commit Convention

`type(scope): short description`

| type | when |
|------|------|
| `feat` | new capability |
| `fix` | bug fix |
| `refactor` | restructure, no behavior change |
| `chore` | deps, config, tooling |
| `docs` | documentation only |

Scope = package name without prefix, e.g. `pix-core` → `fix(pix-core): ...`

Example:

```
fix(pix-core): remove /toolbox from nudge, fire reminder every 10 turns
```

---

## CI — Push to `main`

Triggered automatically on every push to `main` and on PRs.
Runs: **biome ci** → **tsc** → **bun test**.

No manual trigger needed — just push.

---

## CD — Publish to npm

Publishing is triggered by a **release tag**, never by direct push.

### Tag format

```
release-YYYYMMDD-HHMM
```

### How to publish

```bash
# 1. Bump version(s) in the relevant package.json(s)
# 2. Commit + push to main
git add packages/<name>/package.json
git commit -m "chore(<name>): bump version to x.y.z"
git push

# 3. Tag and push — this triggers the Publish workflow
TAG="release-$(date +%Y%m%d-%H%M)" && git tag "$TAG" && git push origin "$TAG"
```

### What the publish workflow does

1. Re-runs the full CI gate (lint + typecheck + test).
2. For each package: checks if `name@version` already exists on npm — skips if so.
3. Publishes only packages whose version is new (idempotent).
4. Uses npm OIDC trusted publishing — no `NPM_TOKEN` needed in CI.

### Dry run (local check before tagging)

```bash
bun run publish:dry
```

---

## Package Independence

Each package is intended to be **independently installable and usable**.

- **No cross-package imports unless unavoidable.** `pix-9router` and `pix-core` depend on `pix-data` — that's an intentional shared data layer. Beyond that, keep packages self-contained.
- **Prefer duplicating small utilities over adding a cross-package dep.** A shared dep creates a hard install coupling.
- **Each package has its own `package.json` version.** Bump only the package(s) actually changed — unrelated packages keep their version and are skipped at publish time.
- **Pi host is always a `peerDependency`**, never a direct dep. Users already have Pi installed.
- **Third-party deps go in the package that needs them**, not hoisted to the root.
- When adding a new package: keep it zero-dep on other `pix-*` packages if at all possible.

---

## Key Rules

- **Never commit directly without running `bun run check` + `bun run typecheck`** — CI will fail.
- **Never push a tag without bumping the version** in the package(s) you changed — publish skips already-published versions.
- **Default version bumps to PATCH only.** Agents may bump the patch field (`x.y.Z`) freely. **Minor (`x.Y.0`) and major (`X.0.0`) bumps require explicit user approval** before applying — never bump minor/major on your own initiative.
- **Do not add `/toolbox` references in agent-facing text** — `/toolbox` is a user slash command, not model-callable.
- **Scripts are idempotent** — safe to re-run `dev-link.sh`, `publish-all.sh`.
- All packages are ESM (`"type": "module"`), target ES2022.
- Shared tsconfig at root: `tsconfig.base.json`. Each package extends it.
