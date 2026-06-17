# Tool Package Split Implementation Plan

**Goal:** Extract each Pi tool into its own independently-installable package so behaviour is
tracked, versioned, and dep-managed at the tool level.

**Architecture:** Tools with no router coupling (`sudo_run`, `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`,
`todo`, `ask`, `toolbox`) become `@xynogen/pix-<name>`. The 9Router-specific tools (`fetch`,
`search`, `transcribe`) stay inside `pix-9router` — they are intrinsically coupled to the router
API and have no meaning outside it. General-purpose packages (`pix-data`, `pix-pretty`, `pix-core`,
`pix-optimizer`, `pix-skills`) stay as shared libraries and become explicit `dependencies` of the
tool packages that need them.

**Two coupling tiers — handled differently:**

- **Self-contained tools** (`todo`, `ask`, `toolbox`, `sudo_run`) register themselves with only the
  pi host API. These extract cleanly into standalone extensions exporting a default
  `(pi) => void`. `pix-core`/`pix-sudo` then re-export them.
- **Pretty renderer tools** (`bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`) do **not** self-register.
  Each registrar has signature `register*Tool(pi, createSdkToolFactory, ctx: ToolContext)` and
  depends on a shared runtime `ToolContext` (`cwd`, `sp`, `TextComponent`, `fffState`,
  `cursorStore`, `trackInvalidator`) plus an SDK tool-factory. That context is built **once** in
  `pix-pretty/src/index.ts` during a heavy boot (FFF finder, theme, resize listener, cursor store).
  Therefore each `pix-<tool>` package depends on `pix-pretty` **as a shared lib** (imports pure
  helpers via an `exports` map) and **exports its registrar**; `pix-pretty` remains the boot owner
  that builds `ToolContext` and **soft-loads** each tool package — registering only those actually
  installed (mirrors the existing `try { require("@ff-labs/fff-node") } catch {}` optional-dep
  pattern). Install `pix-pretty` alone → built-ins. Add `pix-bash` → bash gets pretty rendering.
  Fully à la carte; nothing is assumed installed.

**Import convention:** repo uses `.ts`/`.js` extensions on relative specifiers (`moduleResolution:
"Bundler"` + `allowImportingTsExtensions`). pix-pretty internals use `.js` (`"../config.js"`); core
tools use `.ts`. Match the existing convention in each package — do **not** rewrite extensions.

**Tech Stack:** Bun, TypeScript (ESM, ES2022), Biome, typebox, `@earendil-works/pi-coding-agent`,
`@earendil-works/pi-ai`, `@earendil-works/pi-tui`

---

## Current tool inventory

| Tool | Current home | Action | Shared deps needed |
|---|---|---|---|
| `fetch` | `pix-9router/src/fetch.ts` | **stays in pix-9router** — 9Router-specific | — |
| `search` | `pix-9router/src/search.ts` | **stays in pix-9router** — 9Router-specific | — |
| `transcribe` | `pix-9router/src/transcribe.ts` | **stays in pix-9router** — 9Router-specific | — |
| `sudo_run` | `pix-sudo/src/index.ts` | extract → `pix-sudo-run` | none |
| `bash` | `pix-pretty/src/tools/bash.ts` | extract → `pix-bash` | `pix-pretty` |
| `read` | `pix-pretty/src/tools/read.ts` | extract → `pix-read` | `pix-pretty` |
| `write` | `pix-pretty/src/tools/write.ts` | extract → `pix-write` | `pix-pretty` |
| `edit` | `pix-pretty/src/tools/edit.ts` | extract → `pix-edit` | `pix-pretty` |
| `find` | `pix-pretty/src/tools/find.ts` | extract → `pix-find` | `pix-pretty` |
| `grep` | `pix-pretty/src/tools/grep.ts` | extract → `pix-grep` | `pix-pretty` |
| `ls` | `pix-pretty/src/tools/ls.ts` | extract → `pix-ls` | `pix-pretty` |
| `todo` | `pix-core/src/tool/todo/todo.ts` | extract → `pix-todo` | none |
| `ask` | `pix-core/src/tool/ask/` | extract → `pix-ask` | none |
| `toolbox` | `pix-core/src/tool/toolbox/toolbox.ts` | extract → `pix-toolbox` | none |

## Target package layout

```
packages/
  pix-data/           # unchanged — shared model data
  pix-pretty/         # shrinks — rendering lib; tool/ re-exports from pix-*
  pix-core/           # shrinks — keeps UI/commands/nudges; tool/ re-exports from pix-*
  pix-optimizer/      # unchanged
  pix-skills/         # unchanged
  pix-tokyo-night/    # unchanged
  pix-9router/        # unchanged — keeps provider + fetch/search/transcribe (9Router-specific)
  pix-sudo/           # becomes thin wrapper re-exporting pix-sudo-run

  pix-sudo-run/        # NEW (extracted from pix-sudo)
  pix-bash/            # NEW
  pix-read/            # NEW
  pix-write/           # NEW
  pix-edit/            # NEW
  pix-find/            # NEW
  pix-grep/            # NEW
  pix-ls/              # NEW
  pix-todo/            # NEW
  pix-ask/             # NEW
  pix-toolbox/         # NEW
```

---

## Phasing

3 phases, each independently committable and CI-green.

- **Phase 1** — Extract pretty-renderer tools: `bash`, `read`, `write`, `edit`, `find`, `grep`, `ls`.
- **Phase 2** — Extract core tools: `todo`, `ask`, `toolbox`.
- **Phase 3** — Extract `sudo_run`; update AGENTS.md.

`pix-9router` is **not touched** — `fetch`, `search`, `transcribe` are 9Router-specific and stay there.

---

## Phase 1: Pretty renderer tools (bash / read / write / edit / find / grep / ls)

> **Design note.** These tools are **not** self-registering. Each registrar is
> `register*Tool(pi, createSdkToolFactory, ctx: ToolContext[, trackInvalidator])` and needs the
> shared `ToolContext` built once in `pix-pretty/src/index.ts`. So:
>
> - `pix-pretty` stays the **shared lib + boot owner**: exposes pure helpers + `ToolContext` type
>   via an `exports` map, builds the context once, and **soft-loads** each `pix-<tool>` package,
>   registering only those installed.
> - Each `pix-<tool>` depends on `pix-pretty`, re-exports its registrar, and ships its own test.
> - Nothing is assumed installed — `pix-pretty` alone yields pi built-ins; adding `pix-bash`
>   upgrades bash to pretty rendering.

### Task 1.1: Expose `pix-pretty` internals + `ToolContext` via exports map

Tool registrars import pure helpers (`../config.js`, `../renderers.js`, `../utils.js`, …) and the
`ToolContext` type (`./context.js`). After extraction those become `@xynogen/pix-pretty/<subpath>`
imports. Add an `exports` map so they resolve.

**Files:**

- Modify: `packages/pix-pretty/package.json`

**Step 1: Confirm the full set of internal modules imported by `tools/`**

Run:

```
grep -rhn 'from "\.\./[a-z-]*\.js"' packages/pix-pretty/src/tools/
```

Expected modules (verified): `ansi`, `config`, `diff`, `diff-render`, `highlight`, `lang`, `icons`,
`renderers`, `fff`, `types`, plus `utils`, and `context` (from `./context.js`).

**Step 2: Add exports map to `pix-pretty/package.json`**

```json
"exports": {
  ".": "./src/index.ts",
  "./ansi": "./src/ansi.ts",
  "./config": "./src/config.ts",
  "./diff": "./src/diff.ts",
  "./diff-render": "./src/diff-render.ts",
  "./highlight": "./src/highlight.ts",
  "./lang": "./src/lang.ts",
  "./icons": "./src/icons.ts",
  "./renderers": "./src/renderers.ts",
  "./fff": "./src/fff.ts",
  "./types": "./src/types.ts",
  "./utils": "./src/utils.ts",
  "./context": "./src/tools/context.ts"
}
```

Note: adding an `exports` map makes paths NOT listed here unreachable. Keep `"."` so the extension
entry still resolves.

**Step 3: Typecheck**

```
bun run typecheck
```

Expected: no new errors

**Step 4: Commit**

```
git commit -m "chore(pix-pretty): add exports map for tool sub-paths + ToolContext"
```

---

### Task 1.2–1.8: Create `pix-bash`, `pix-read`, `pix-write`, `pix-edit`, `pix-find`, `pix-grep`, `pix-ls`

Each follows identical structure. Shown in full for `pix-bash`; repeat for the rest.

> **Test reality:** only `bash.test.ts` exists today. For `bash` you COPY the test; for the other
> six you WRITE a new minimal registrar test from scratch (assert the package's default export
> registers a tool of the right `name` against a mock `pi`/`ctx`). Model it on `bash.test.ts`.

#### Task 1.2: `pix-bash`

**Files:**

- Create: `packages/pix-bash/package.json`
- Create: `packages/pix-bash/src/index.ts`
- Create: `packages/pix-bash/src/bash.ts`
- Create: `packages/pix-bash/src/bash.test.ts`

**Step 1: Write failing test**

Copy `packages/pix-pretty/src/tools/bash.test.ts` → `packages/pix-bash/src/bash.test.ts`, updating
the import of `registerBashTool` from `./bash` to `./bash.js`. The test already builds a mock
`ToolContext` and SDK factory — reuse it unchanged.

**Step 2: Run — expect FAIL**

```
cd packages/pix-bash && bun test
```

Expected: FAIL — `Cannot find module './bash'`

**Step 3: Implement**

`packages/pix-bash/package.json`:

```json
{
  "name": "@xynogen/pix-bash",
  "version": "0.1.0",
  "description": "Pi tool — bash shell execution with pretty output",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "bun test" },
  "files": ["src", "README.md", "LICENSE"],
  "pi": { "extensions": ["src/index.ts"] },
  "keywords": ["pi", "pi-package", "pi-extension", "bash"],
  "author": "xynogen",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xynogen/pix-mono.git",
    "directory": "packages/pix-bash"
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@xynogen/pix-pretty": "*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

`packages/pix-bash/src/bash.ts`: copy from `packages/pix-pretty/src/tools/bash.ts`, then rewrite
the relative `.js` imports to `@xynogen/pix-pretty/<subpath>`:

```ts
// before:  import { FG_DIM, RST } from "../ansi.js";
// after:   import { FG_DIM, RST } from "@xynogen/pix-pretty/ansi";
// before:  import { renderBashOutput } from "../renderers.js";
// after:   import { renderBashOutput } from "@xynogen/pix-pretty/renderers";
// before:  import type { ... } from "../types.js";  →  "@xynogen/pix-pretty/types"
// before:  import { ... } from "../utils.js";       →  "@xynogen/pix-pretty/utils"
```

Keep the `export function registerBashTool(pi, createBashTool, ctx)` signature exactly — it is the
public contract `pix-pretty` calls.

`packages/pix-bash/src/index.ts` — re-export the registrar so the package is both a lib (used by
`pix-pretty`) and a self-describing extension entry:

```ts
export { registerBashTool } from "./bash.js";
export { registerBashTool as default } from "./bash.js";
```

> The default export is the registrar, NOT a `(pi) => void`. `pix-pretty` calls it with the SDK
> factory + `ToolContext` it owns. A bare `(pi) => void` cannot work — the registrar needs both.

**Step 4: Run — expect PASS**

```
cd packages/pix-bash && bun test
```

**Step 5: Commit**

```
git commit -m "feat(pix-bash): extract bash tool into standalone package"
```

**Per-tool variations for Tasks 1.3–1.8:**

| Pkg | Registrar | Extra ctor arg | Subpaths imported |
|---|---|---|---|
| `pix-read` | `registerReadTool` | — | ansi, config, icons, renderers, types, utils |
| `pix-write` | `registerWriteTool` | `trackInvalidator` | config, diff, diff-render, highlight, lang, types, utils |
| `pix-edit` | `registerEditTool` | `trackInvalidator` | config, diff, diff-render, lang, types, utils |
| `pix-find` | `registerFindTool` | — | types, utils |
| `pix-grep` | `registerGrepTool` | — | fff, types, utils |
| `pix-ls` | `registerLsTool` | — | ansi, renderers, types, utils |

For `pix-write`/`pix-edit` the registrar takes a 4th arg `trackInvalidator` — keep that in the
signature; `pix-pretty` supplies it.

---

### Task 1.9: Make `pix-pretty` soft-load the extracted tool packages

**Files:**

- Modify: `packages/pix-pretty/src/index.ts`
- Modify: `packages/pix-pretty/package.json`

`pix-pretty` keeps owning the boot (context, FFF, theme, resize, cursor store) but now loads each
registrar from its own package **if installed**, falling back to nothing (pi built-in) if not.

**Step 1: Replace the static `./tools/*` imports with optional dynamic loads**

Delete the seven `import { registerXTool } from "./tools/X.js";` lines. After `toolCtx` is built,
replace the seven `if (isToolEnabled(...)) registerXTool(...)` blocks with a soft-load loop:

```ts
const toolPkgs: Array<{
  name: string;
  pkg: string;
  factory: ToolFactory<any> | undefined;
  extra?: unknown;
}> = [
  { name: "read",  pkg: "@xynogen/pix-read",  factory: createReadTool },
  { name: "bash",  pkg: "@xynogen/pix-bash",  factory: createBashTool },
  { name: "ls",    pkg: "@xynogen/pix-ls",    factory: createLsTool },
  { name: "find",  pkg: "@xynogen/pix-find",  factory: createFindTool },
  { name: "grep",  pkg: "@xynogen/pix-grep",  factory: createGrepTool },
  { name: "edit",  pkg: "@xynogen/pix-edit",  factory: createEditTool,  extra: trackInvalidator },
  { name: "write", pkg: "@xynogen/pix-write", factory: createWriteTool, extra: trackInvalidator },
];

for (const { name, pkg, factory, extra } of toolPkgs) {
  if (!isToolEnabled(name) || !factory) continue;
  try {
    const mod = await import(pkg);
    const register = mod.default ?? mod[`register${name[0].toUpperCase()}${name.slice(1)}Tool`];
    if (extra !== undefined) register(pi, factory, toolCtx, extra);
    else register(pi, factory, toolCtx);
  } catch {
    /* package not installed — leave pi built-in tool in place */
  }
}
```

> Mirrors the existing `try { require("@ff-labs/fff-node") } catch {}` optional-dep pattern in the
> same file. `await import()` is fine — the extension entry is already `async`-capable via the
> `session_start` handler; if the surrounding `default function` is sync, keep these as static
> imports wrapped in `try/catch` instead (see Step 1b).

**Step 1b (fallback if dynamic import is awkward in a sync entry):** keep static imports but mark
the deps `optional`. Use a top-level guarded import helper, or—simplest—keep the seven imports and
list the packages as `optionalDependencies` so install never fails when one is absent. Pick
whichever the host extension loader supports; verify by installing `pix-pretty` WITHOUT `pix-bash`
and confirming bash still works via the pi built-in.

**Step 2: Declare the tool packages as `optionalDependencies` in `pix-pretty/package.json`**

```json
"dependencies": {
  "cli-highlight": "^2.1.11",
  "@ff-labs/fff-node": "^0.5.2",
  "diff": "^7.0.0"
},
"optionalDependencies": {
  "@xynogen/pix-bash": "*",
  "@xynogen/pix-read": "*",
  "@xynogen/pix-write": "*",
  "@xynogen/pix-edit": "*",
  "@xynogen/pix-find": "*",
  "@xynogen/pix-grep": "*",
  "@xynogen/pix-ls": "*"
}
```

> `optionalDependencies` (not `dependencies`) is what makes "install only what you want" real — a
> missing package must not break `pix-pretty` install or boot.

**Step 3: Verify à-la-carte behaviour**

```
bun run typecheck && bun test
```

Then manually: with all seven linked → pretty tools active; remove one link → that tool falls back
to the pi built-in, no crash.

**Step 4: Commit**

```
git commit -m "refactor(pix-pretty): soft-load extracted pix-* tool packages (à la carte)"
```

---

## Phase 2: Core tools (todo / ask / toolbox)

### Task 2.1: Create `pix-todo`

**Files:**

- Create: `packages/pix-todo/package.json`
- Create: `packages/pix-todo/src/index.ts`
- Create: `packages/pix-todo/src/todo.ts`
- Create: `packages/pix-todo/src/todo.test.ts`

**Step 1: Write failing test**

Copy `packages/pix-core/src/tool/todo/todo.test.ts` → `packages/pix-todo/src/todo.test.ts`,
update import to `./todo.ts`.

**Step 2: Run — expect FAIL**

```
cd packages/pix-todo && bun test
```

**Step 3: Implement**

`packages/pix-todo/package.json`:

```json
{
  "name": "@xynogen/pix-todo",
  "version": "0.1.0",
  "description": "Pi tool — durable execution checklist (todo)",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "bun test" },
  "files": ["src", "README.md", "LICENSE"],
  "pi": { "extensions": ["src/index.ts"] },
  "keywords": ["pi", "pi-package", "pi-extension", "todo"],
  "author": "xynogen",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xynogen/pix-mono.git",
    "directory": "packages/pix-todo"
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

`packages/pix-todo/src/todo.ts`: copy verbatim from `packages/pix-core/src/tool/todo/todo.ts`.
Imports `typebox` (schema) — listed above; no other shared deps.

`packages/pix-todo/src/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerTodo from "./todo.ts";

export default function (pi: ExtensionAPI): void {
  registerTodo(pi);
}
```

**Step 4: Run — expect PASS**

```
cd packages/pix-todo && bun test
```

**Step 5: Commit**

```
git commit -m "feat(pix-todo): extract todo tool into standalone package"
```

---

### Task 2.2: Create `pix-ask`

**Files:**

- Create: `packages/pix-ask/package.json`
- Create: `packages/pix-ask/src/` — copy ALL 9 files from `pix-core/src/tool/ask/`:
  `index.ts`, `helpers.ts`, `questionnaire.ts`, `rpc.ts`, `schema.ts`, `types.ts`,
  `components.ts`, `single-select-layout.ts`, and BOTH tests `ask.test.ts` +
  `single-select-layout.test.ts`

**Step 1: Audit deps — confirm `ask/` is self-contained**

```
grep -rn 'from "\.\./\.\.' packages/pix-core/src/tool/ask/
```

Expected: NO output (verified — no imports escape the `ask/` dir). All relative imports are
intra-package (`./helpers.js`, `./schema.js`, …) and survive the copy unchanged.

**Step 2: Copy the two test files first (they ARE the failing tests)**

Copy `ask.test.ts` and `single-select-layout.test.ts` into `packages/pix-ask/src/` verbatim —
their imports (`./index.js`, `./helpers.js`, `./single-select-layout.js`) already match the new
layout, no rewrite needed.

**Step 3: Run — expect FAIL**

```
cd packages/pix-ask && bun test
```

Expected: FAIL — source modules not yet copied.

**Step 4: Implement**

Copy the remaining 7 source files from `packages/pix-core/src/tool/ask/` →
`packages/pix-ask/src/`.

Note: `ask/index.ts` is already a self-contained barrel — it both re-exports the helper/type
symbols consumed by `ask.test.ts` and `single-select-layout.ts`, **and** has
`export default function registerAsk(pi)`. Copy it verbatim as `pix-ask/src/index.ts`; no rename,
no extra wrapper. The package entry IS the registrar + barrel. Copy the sibling files
(`helpers.ts`, `questionnaire.ts`, `rpc.ts`, `schema.ts`, `types.ts`, `components.ts`,
`single-select-layout.ts`) unchanged — their relative `.js` imports stay intra-package.

`packages/pix-ask/package.json`:

```json
{
  "name": "@xynogen/pix-ask",
  "version": "0.1.0",
  "description": "Pi tool — structured questionnaire UI (ask)",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "bun test" },
  "files": ["src", "README.md", "LICENSE"],
  "pi": { "extensions": ["src/index.ts"] },
  "keywords": ["pi", "pi-package", "pi-extension", "ask"],
  "author": "xynogen",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xynogen/pix-mono.git",
    "directory": "packages/pix-ask"
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

**Step 5: Run — expect PASS**

```
cd packages/pix-ask && bun test
```

**Step 6: Commit**

```
git commit -m "feat(pix-ask): extract ask tool into standalone package"
```

---

### Task 2.3: Create `pix-toolbox`

**Files:**

- Create: `packages/pix-toolbox/package.json`
- Create: `packages/pix-toolbox/src/index.ts`
- Create: `packages/pix-toolbox/src/toolbox.ts`
- Create: `packages/pix-toolbox/src/toolbox.test.ts`

**Step 1: Audit deps**

```
grep -rn "from \"\.\./" packages/pix-core/src/tool/toolbox/toolbox.ts
```

Expected: only pi host APIs — no cross-imports.

**Step 2: Write failing test**

Copy `packages/pix-core/src/tool/toolbox/toolbox.test.ts` →
`packages/pix-toolbox/src/toolbox.test.ts`, update imports.

**Step 3: Run — expect FAIL**

```
cd packages/pix-toolbox && bun test
```

**Step 4: Implement**

`packages/pix-toolbox/package.json`: same shape as `pix-todo` but **no `dependencies` block**
(toolbox does not use typebox). Name `@xynogen/pix-toolbox`; add `@earendil-works/pi-tui` to
peerDeps (uses TUI components).

`packages/pix-toolbox/src/toolbox.ts`: copy from `packages/pix-core/src/tool/toolbox/toolbox.ts`.

`packages/pix-toolbox/src/index.ts`: thin wrapper calling `registerToolbox(pi)`.

**Step 5: Run — expect PASS**

```
cd packages/pix-toolbox && bun test
```

**Step 6: Commit**

```
git commit -m "feat(pix-toolbox): extract toolbox tool into standalone package"
```

---

### Task 2.4: Update `pix-core` to re-export from new packages

**Files:**

- Modify: `packages/pix-core/src/index.ts`
- Modify: `packages/pix-core/package.json`

**Step 1: Update imports**

In `pix-core/src/index.ts` replace:

```ts
import registerTodo from "./tool/todo/todo.ts";
import registerAsk from "./tool/ask/index.ts";
import registerToolbox from "./tool/toolbox/toolbox.ts";
```

With:

```ts
import registerTodo from "@xynogen/pix-todo";
import registerAsk from "@xynogen/pix-ask";
import registerToolbox from "@xynogen/pix-toolbox";
```

**Step 2: Update `pix-core/package.json` dependencies**

Add:

```json
"@xynogen/pix-todo": "*",
"@xynogen/pix-ask": "*",
"@xynogen/pix-toolbox": "*"
```

Delete `tool/todo/`, `tool/ask/`, `tool/toolbox/` source dirs once confirmed no other imports.

**Step 3: Run**

```
bun run typecheck && bun test
```

Expected: PASS

**Step 4: Commit**

```
git commit -m "refactor(pix-core): delegate todo/ask/toolbox to pix-* packages"
```

---

## Phase 3: sudo_run + AGENTS.md

### Task 3.1: Create `pix-sudo-run`

**Files:**

- Create: `packages/pix-sudo-run/package.json`
- Create: `packages/pix-sudo-run/src/index.ts` ← copy from `pix-sudo/src/index.ts`
- Create: `packages/pix-sudo-run/src/lib.ts` ← copy from `pix-sudo/src/lib.ts`
- Create: `packages/pix-sudo-run/src/sudo.test.ts`

**Step 1: Write failing test**

Copy `packages/pix-sudo/src/sudo.test.ts` → `packages/pix-sudo-run/src/sudo.test.ts`,
update imports.

**Step 2: Run — expect FAIL**

```
cd packages/pix-sudo-run && bun test
```

**Step 3: Implement**

`packages/pix-sudo-run/package.json`:

```json
{
  "name": "@xynogen/pix-sudo-run",
  "version": "0.1.0",
  "description": "Pi tool — sudo_run with interactive PAM password prompt",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "bun test" },
  "files": ["src", "README.md", "LICENSE"],
  "pi": { "extensions": ["src/index.ts"] },
  "keywords": ["pi", "pi-package", "pi-extension", "sudo"],
  "author": "xynogen",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xynogen/pix-mono.git",
    "directory": "packages/pix-sudo-run"
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

Copy `pix-sudo/src/index.ts` and `pix-sudo/src/lib.ts` verbatim — no import changes needed.

**Step 4: Run — expect PASS**

```
cd packages/pix-sudo-run && bun test
```

**Step 5: Commit**

```
git commit -m "feat(pix-sudo-run): extract sudo_run into standalone package"
```

---

### Task 3.2: Update `pix-sudo` to thin wrapper

**Files:**

- Modify: `packages/pix-sudo/src/index.ts`
- Modify: `packages/pix-sudo/package.json`
- Delete: `packages/pix-sudo/src/lib.ts` (moved to `pix-sudo-run`)
- Delete: `packages/pix-sudo/src/sudo.test.ts` (moved to `pix-sudo-run`; it imports `./lib.ts` +
  `./index.ts` which no longer carry the logic — the test now lives with the implementation)

`packages/pix-sudo/src/index.ts`:

```ts
export { default } from "@xynogen/pix-sudo-run";
```

> After deletion `pix-sudo` has no own test — correct: it is a pure re-export shim, covered
> transitively by `pix-sudo-run`'s suite.

`packages/pix-sudo/package.json` dependencies:

```json
"dependencies": {
  "@xynogen/pix-sudo-run": "*"
}
```

**Step 1: Apply changes**

**Step 2: Run**

```
bun run typecheck && bun test
```

**Step 3: Commit**

```
git commit -m "refactor(pix-sudo): thin wrapper re-exporting pix-sudo-run"
```

---

### Task 3.3: Update AGENTS.md

**Files:**

- Modify: `AGENTS.md`

Update Repo Structure:

```
  pix-sudo/            # Thin wrapper re-exporting pix-sudo-run
  pix-sudo-run/        # Tool — sudo_run with interactive PAM password prompt
  pix-bash/            # Tool — bash shell execution (pretty output)
  pix-read/            # Tool — file read with syntax highlight
  pix-write/           # Tool — file write
  pix-edit/            # Tool — precise text replacement edit
  pix-find/            # Tool — glob file search
  pix-grep/            # Tool — pattern search in files
  pix-ls/              # Tool — directory listing
  pix-todo/            # Tool — durable execution checklist
  pix-ask/             # Tool — structured questionnaire UI
  pix-toolbox/         # Tool — gated tool toggle UI (/toolbox)
```

**Step 1: Update `AGENTS.md`**

**Step 2: Commit**

```
git commit -m "docs(AGENTS.md): document new pix-* tool package layout"
```

---

## Verification checklist (run after each phase)

```bash
bun run check        # biome lint + format
bun run typecheck    # tsc --noEmit
bun test             # all tests pass
```

Each new package must pass `bun test` in its own directory before the parent bundle is updated.

---

## Dependency graph after all phases

```
pix-bash         → pix-pretty (dependency — shared lib)
pix-read         → pix-pretty
pix-write        → pix-pretty
pix-edit         → pix-pretty
pix-find         → pix-pretty
pix-grep         → pix-pretty
pix-ls           → pix-pretty
pix-todo         → (none — self-contained)
pix-ask          → (none — only pi host peerDeps)
pix-toolbox      → (none — only pi host peerDeps)
pix-sudo-run     → (none — only pi host peerDeps)

pix-9router      → pix-data  (fetch/search/transcribe stay internal — no change)
pix-pretty       → optionalDependencies: pix-bash, pix-read, pix-write, pix-edit,
                   pix-find, pix-grep, pix-ls  (soft-loaded; boot owner, à la carte)
pix-core         → pix-data, pix-skills, pix-todo, pix-ask, pix-toolbox
pix-sudo         → pix-sudo-run
pix-optimizer    → (unchanged)
pix-skills       → (unchanged)
pix-tokyo-night  → (unchanged)
pix-data         → (unchanged)

Note: pix-pretty ↔ pix-bash is a deliberate cycle in the package graph (pix-bash depends on
pix-pretty for the lib; pix-pretty optionally soft-loads pix-bash for boot). Safe because the
soft-load is runtime + optional — no static import cycle, no install failure when absent.
```
