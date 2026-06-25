# pix-mono — Agent Operating Guide

Monorepo of Pi Coding Agent extensions (`@xynogen/pix-*`).
Runtime: **Bun**. Linter/formatter: **Biome**. Type checker: **tsc**. Test runner: **bun test**.

---

## Repo Structure

```
packages/
  # ── Aggregator ──────────────────────────────────────────────────────────
  pix-core/        # Meta-package — bundles + activates the core distro (depends on the packages below)
  # ── Shared layers ───────────────────────────────────────────────────────
  pix-data/        # Shared model data layer (modelgrep catalog + BenchLM scores), cached at ~/.cache/pi
  pix-pretty/      # Shared rendering lib (highlight, diff, icons, fff) + FFF slash commands
  pix-themes/      # Theme pack — 7 dark themes
  # ── UI / UX extensions (bundled by pix-core) ────────────────────────────
  pix-welcome/     # ASCII π banner + startup health checks (version, auth, models, tools, skills, gitignore)
  pix-footer/      # Status bar — mode, git branch, model, tokens, cost, live TPS
  pix-models/      # /models — enhanced model picker (coding score/rank, context, cost)
  pix-update/      # /update — self-update Pi + extensions (detects install method)
  pix-commands/    # /clear — flush ~/.cache/pi
  pix-nudge/       # Tools nudge + capability nudge (steer model toward correct tools)
  pix-diagnostics/ # Compact session-files widget (overrides pi-lens widget id)
  pix-display/     # Paste chip rendering + leaked <think> tag → native thinking blocks
  pix-prompts/     # System-prompt injection — bundled AGENT.md baseline + repo directive scan
  pix-skills/      # Agent skill loader (read_skills tool + bundled skills)
  # ── Behaviour (bundled by pix-core) ─────────────────────────────────────
  pix-optimizer/   # Caveman + RTK + jq/TOON + ponytail modes (/optimizer overlay)
  pix-gate/        # Permission gate for dangerous bash + path commands (confirm/block TUI dialog)
  pix-subagent/    # Sub-agent spawning — agent / agent_result / agent_steer tools + model widget
  # ── Tool suite (bundled by pix-core — drop-in replacements for Pi built-ins) ──
  pix-bash/        # Tool — bash shell execution with pretty output
  pix-read/        # Tool — file read with syntax highlight
  pix-write/       # Tool — file write with diff rendering
  pix-edit/        # Tool — precise text replacement edit with diff rendering
  pix-find/        # Tool — glob file search (FFF-accelerated)
  pix-grep/        # Tool — pattern search in files (FFF-accelerated)
  pix-ls/          # Tool — directory listing with tree view
  pix-todo/        # Tool — durable execution checklist (survives context compaction)
  pix-ask/         # Tool — structured questionnaire UI (ask_user)
  # ── Standalone extensions (opt-in, NOT bundled by pix-core) ─────────────
  pix-9router/     # 9Router LLM provider + fetch/search/transcribe tools (needs API key)
  pix-sudo/        # Tool — sudo_run with interactive PAM password prompt
  pix-toolbox/     # Tool — gated tool toggle UI (/toolbox)
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

### Agent runbook — when the user says "publish"

"publish" (alone) means: run this exact sequence, no re-asking which packages.

1. **Verify clean gate** — `bun run check && bun run typecheck && bun test`. Red → STOP, do not publish.
2. **Confirm bumps landed** — every changed package's `package.json` version is ahead of npm. Unbumped → no publish for that package (the tag ships nothing). Match type → semver: `feat`→minor, `fix`/`perf`→patch, breaking→major.
3. **Commit + push to `main`** — `rtk git add … && rtk git commit -m "…" && rtk git push`. Push to `main` is shared-state: confirm via `ask_user` first.
4. **Dry-run** — `bun run publish:dry`. Read the "Publishing N package(s)" list; that is exactly what the tag will ship.
5. **Confirm the publish (irreversible §1 gate)** — state the precise list (`name@version`) the dry-run reported, then `ask_user` Confirm/Cancel. A prior approval never carries forward.
6. **Tag + push** — `TAG="release-$(date +%Y%m%d-%H%M)" && git tag "$TAG" && git push origin "$TAG"`. This triggers the Publish workflow (re-runs CI, skips already-published versions).

The tag, not the commit, triggers publishing. Only packages with a new version ship — everything else is skipped idempotently.

---

## Package Independence

Each package is intended to be **independently installable and usable**.

- **No cross-package imports unless unavoidable.** Three packages are sanctioned shared layers, each a different kind: `pix-data` (shared **data** — models.dev + BenchLM cache), `pix-pretty` (shared **render code** — highlight/diff/icons/fff; most tool packages depend on it), and `pix-core` (the **aggregator** that bundles the rest). Depending on these is intentional. Beyond them, keep packages self-contained.
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
