# pix-mono — Agent Operating Guide

Monorepo of Pi Coding Agent extensions (`@xynogen/pix-*`).
**Bun** runtime · **Biome** lint/format · **tsc** types · **bun test** tests · all ESM (`"type": "module"`, ES2022).

---

## Repo Structure

```
packages/
  # ── Aggregator ─────────────────────────────────────────────────────
  pix-core/        # Meta-package — bundles + activates the core distro
  # ── Shared layers ──────────────────────────────────────────────────
  pix-data/        # Model data (modelgrep + BenchLM, cached at ~/.cache/pi), pix.json config loader, collapse helper
  pix-pretty/      # Rendering lib (highlight, diff, icons, fff) + FFF slash commands
  pix-themes/      # Theme pack — 7 dark themes
  # ── UI / UX (bundled by pix-core) ─────────────────────────────────
  pix-welcome/     # ASCII π banner + startup health checks
  pix-footer/      # Status bar — mode, git, model, tokens, cost, TPS
  pix-models/      # /models — model picker (score, context, cost)
  pix-update/      # /update — self-update Pi + extensions
  pix-commands/    # /clear cache + /btw isolated concurrent side questions
  pix-nudge/       # Tools + capability nudge
  pix-diagnostics/ # Compact session-files widget
  pix-display/     # Paste chip rendering + leaked <think> cleanup
  pix-prompts/     # System-prompt injection (AGENT.md + repo directive scan)
  pix-skills/      # Skill loader (read_skills tool + bundled skills)
  # ── Behaviour (bundled by pix-core) ────────────────────────────────
  pix-optimizer/   # Caveman + RTK + TOON + ponytail (/optimizer)
  pix-gate/        # Permission gate for dangerous commands
  pix-subagent/    # Sub-agent spawning (agent / agent_result / agent_steer)
  # ── Tool suite (bundled by pix-core — Pi built-in replacements) ───
  pix-bash/  pix-read/  pix-write/  pix-edit/
  pix-find/  pix-grep/  pix-ls/    pix-ask/
  pix-todo/        # Durable execution checklist (survives context compaction)
  # ── Standalone (opt-in, NOT bundled) ───────────────────────────────
  pix-9router/     # 9Router LLM provider + fetch/search/transcribe (needs API key)
  pix-sudo/        # sudo_run with PAM password prompt
  pix-toolbox/     # Gated tool toggle UI (/toolbox)
scripts/
  dev-link.sh      # Symlink packages into Pi for dev
  publish-all.ts   # Publish changed packages to npm (idempotent)
  install.sh       # Install all packages into Pi
  deps.test.ts     # CI dep-hygiene checks (workspace:*, bare *, caret ranges)
.github/workflows/
  ci.yml           # Lint + typecheck + test on push/PR
  publish.yml      # Publish to npm on release tag
```

---

## Development

```bash
bun install                # install deps
bun run dev:link           # symlink into Pi (restart Pi after)
bun run dev:unlink         # restore npm copies
bun run check              # biome lint + format
bun run check:fix          # auto-fix
bun run typecheck          # tsc --noEmit
bun test                   # unit tests
```

---

## Commits

Format: `type(scope): short description` — scope = package name, e.g. `fix(pix-core): ...`

Types: **feat** (new capability) · **fix** (bug fix) · **refactor** (no behavior change) · **chore** (deps/config/tooling) · **docs** (documentation)

---

## CI / CD

**CI** runs on every push to `main` and PRs: biome ci → tsc → bun test.

**CD** is triggered by a release tag (`release-YYYYMMDD-HHMM`), never by direct push.

```bash
# Bump version(s), commit, push, then:
TAG="release-$(date +%Y%m%d-%H%M)" && git tag "$TAG" && git push origin "$TAG"
```

The publish workflow re-runs CI, checks each `name@version` against npm, publishes only new versions (idempotent, OIDC trusted publishing — no NPM_TOKEN needed). Dry-run locally: `bun run publish:dry`.

### Agent runbook — "publish"

"publish" (alone) means: run this exact sequence, no re-asking which packages.

1. **Gate** — `bun run check && bun run typecheck && bun test`. Red → STOP.
2. **Confirm bumps** — changed packages must have version ahead of npm. Unbumped → that package silently ships nothing (no error). Semver: `feat`→minor, `fix`/`perf`→patch, breaking→major.
3. **Commit + push** — confirm via `ask_user` first (shared-state push).
4. **Dry-run** — `bun run publish:dry` — note the exact `name@version` list.
5. **Confirm publish** — `ask_user` with the exact list. Prior approval never carries forward.
6. **Tag + push** — creates the release tag, triggers the Publish workflow.
7. **Verify GitHub Actions** — use `gh run list` to find the CI run for the tagged SHA, then `gh run watch <run-id> --exit-status`. After CI succeeds, find and watch the resulting Publish run. Confirm its log reports every expected `name@version` as published and ends with `0 failed`; report the Publish workflow URL and exact published versions. Red → STOP and report the failing step/log — never claim the release succeeded from the tag push alone.

---

## Package Independence

- **Three sanctioned shared layers:** `pix-data` (data + config), `pix-pretty` (rendering), `pix-core` (aggregator). Beyond these, keep packages self-contained.
- Prefer duplicating small utilities over adding a cross-package dep.
- Each package owns its own version — bump only what changed.
- Pi host is always a `peerDependency`, never a direct dep.
- Third-party deps go in the package that needs them, not hoisted to root.

---

## Dependency Versioning

**All `@xynogen/` deps must use caret ranges (`^x.y.z`).** Never `workspace:*` or bare `"*"` — these break npm publish and end-user installs.

- Set range to `^<current version>` of the target package.
- After a **minor bump** of a shared 0.x package, update the caret range in **all consumers** (e.g. `pix-data` 0.3→0.4 means `"^0.3.0"` → `"^0.4.0"` everywhere). Patch bumps within the same minor need no consumer edits (`^0.3.0` already matches `0.3.1`). Consumers whose dep range changed also need a patch bump + republish.
- `publish-all.ts` aborts if `workspace:` ranges survive.
- CI enforces via `scripts/deps.test.ts`: no `workspace:`, no bare `*`, all `@xynogen/` deps use `^`.

---

## Icon Catalog

**Never hardcode Nerd Font glyph codepoints** (terminals without Nerd Fonts render them as tofu). Use the semantic catalog in `pix-pretty`:

```ts
import { icon } from "@xynogen/pix-pretty/icon-catalog";
icon("cwd")           // resolves glyph for active mode (nerd/unicode/ascii)
```

- Keys are semantic roles (`"model"`, `"cwd"`, `"paste.image"`), never glyph names.
- `PRETTY_ICONS` env seeds default; `/pix` settings command switches live (persisted to `~/.pi/agent/pix.json`).
- New icons → add to `CATALOG` in `packages/pix-pretty/src/icon-catalog.ts` with all three variants.

---

## Unified Config — `~/.pi/agent/pix.json`

Auto-created with defaults on first session. Sections:

| Section | Consumers |
|---|---|
| `collapse` | pix-bash, pix-read, pix-grep, pix-edit, pix-write, pix-find, pix-ls, pix-todo |
| `pretty` | pix-pretty (theme, icons, preview, diff colors) |
| `optimizer` | pix-optimizer (caveman/rtk/toon/ponytail state) |
| `gate` | pix-gate (rules, auto-approve patterns) |

Loader: `@xynogen/pix-data/pix-config` · Collapse: `@xynogen/pix-data/collapse`. Full schema in `packages/pix-data/README.md`.

---

## Key Rules

- **Always run `bun run check` + `bun run typecheck` before committing** — CI will fail otherwise.
- **Never tag without bumping versions** — publish skips already-published versions.
- **Patch bumps only by default.** Minor/major require explicit user approval.
- **No `/toolbox` in agent-facing text** — it's a user slash command, not model-callable.
- Scripts are idempotent. Shared tsconfig: `tsconfig.base.json` — each package extends it.
- New packages: keep zero-dep on other `pix-*` packages if at all possible.
