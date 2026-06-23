---
name: subagent
description: Plan a task, break it into small independent units, and fan them out in parallel to cheaper/less-capable subagent models for faster, cheaper, more efficient execution. Use when a task is large enough to split into parts that do not depend on each other and a strong model is overkill for each part.
---

# Parallel Delegate

Plan first, decompose into small independent units, then fan those units out to
**cheaper** subagent models running **in parallel**. A capable orchestrator (you)
keeps the plan, the decisions, and the final integration. Cheap workers do the
bulk grunt work concurrently.

**The real trade is not intelligence for speed — it is spending *less of* the
orchestrator's intelligence.** The strong model's context window and attention
are the scarce resource. Every mechanical unit it does itself burns that finite
budget on work that does not need it. Offloading those units to cheap workers
keeps the smart model's context clean and reserved for the hard 10% — the plan,
the seams, the integration. Faster wall-clock and lower cost are byproducts; the
point is preserving the expensive model's intelligence for where it actually
matters.

This skill is for the **parent orchestrator only**. Children receive concrete,
self-contained tasks — they do not plan, do not decompose further, and do not
launch their own subagents.

## When to use

Use when **all** of these hold:

- The task splits into **2+ units that do not depend on each other** (no unit
  needs another unit's output mid-flight).
- Each unit is **mechanical enough** that a smaller model can do it reliably
  given a precise spec (boilerplate, repetitive edits across files, test
  scaffolding, format conversions, doc stubs, per-module refactors).
- The shared decisions (architecture, contracts, naming) can be **fixed up
  front** by the orchestrator so workers don't have to make them.

Do **not** use when:

- Units share a write target (same file/region) — that needs a single writer,
  not a swarm. Use the single-writer pattern or `worktree: true`.
- The work is genuinely hard reasoning end-to-end — a cheap model will produce
  slop you pay to fix.
- The pieces are tightly coupled and must be done in sequence — use a chain.

## The flow

```
1. PLAN      → decide architecture, contracts, naming, acceptance up front
2. DECOMPOSE → split into N independent, fully-specified units
3. FAN OUT   → subagent({ tasks:[...], concurrency }) with a cheap model per task
4. INTEGRATE → orchestrator wires units together, resolves seams, runs the gate
5. VERIFY    → lint + typecheck + tests; fix seams the cheap workers couldn't
```

### 1. Plan

For simple/medium tasks, plan inline using the `plan` skill's discipline: fix the
exact file paths, the shared contracts (types, function signatures, interfaces),
the naming, and the acceptance criteria **before** splitting. The whole point is
that workers inherit decisions instead of inventing them.

For large/complex tasks, delegate planning to the builtin `planner` first, get
the plan, then decompose it:

```typescript
subagent({ agent: "planner", task: "Plan: <task>. Emphasize independent, parallelizable units." })
```

### 2. Decompose

Split the plan into units that satisfy the independence test:

- **No cross-unit dependency** — a unit must be completable with only the spec
  the orchestrator hands it, never another running unit's output.
- **No shared write target** — two units must not edit the same file/region.
- **Self-contained spec** — each unit's task string carries everything: exact
  paths, the shared contract it must conform to, the expected output shape, and
  how to validate locally.

If a unit fails the test, either merge it back, sequence it (chain), or keep it
on the orchestrator.

> **Delegating ≠ branching.** A foreground/blocking subagent call where the
> parent waits for the result before launching the next is *serial delegation* —
> it only buys context isolation, **zero wall-clock gain**. The whole point of
> this skill is branching: all independent units must be launched **together in
> one fan-out** (`tasks:[...]` with `async: true`, or N background launches in a
> single turn) so they run concurrently. If you spawn one, wait, spawn the next,
> you are not using the power of subagents — you are just relaying work serially.
> Splitting a *dependency chain* into separate agents wins nothing either: they
> serialize on each other's data. Branch only truly-independent units.

### 3. Fan out to cheap models

Use top-level parallel tasks with a per-task `model` override pointing at a
cheaper/smaller model.

> **Delegating ≠ branching — serial fan-out is pure loss.** A foreground/blocking
> subagent call where the parent waits for one result before launching the next
> is *serial delegation*, and it is **strictly worse than doing the work
> yourself**. The orchestrator stays tied up relaying the unit — so its scarce
> context/attention was spent anyway — *and* the unit ran on a weaker model. You
> traded the strong model's intelligence away and got nothing back, not even less
> of it spent. The only thing serial delegation buys is context isolation, which
> rarely justifies the quality hit.
>
> The entire value of this skill is **branching**: launch every independent unit
> **together in one fan-out** (`tasks:[...]` with `async: true`, or N background
> launches in a single turn) so they run concurrently. Concurrency is what makes
> the trade pay — N units of mechanical work leave the orchestrator's context at
> once, freeing its budget for the hard parts. Remove the parallelism and you
> keep none of that upside, only the downside.
>
> Corollary: splitting a *dependency chain* into separate agents wins nothing
> either — the units serialize on each other's data, collapsing back to serial.
> Branch **only** truly-independent units; if you cannot fan them out
> concurrently, keep the work on the orchestrator instead of delegating it.

**Resolve the cheap model at call time — never hardcode it.** The active model is
dynamic: the user can switch it mid-chat, and the orchestrator's own model is
whatever is current. So before fanning out:

1. If the user named a cheap model for the workers, use that.
2. Otherwise pick a cheaper sibling of the **current** model (smaller/mini/flash
   tier of the same or a comparable provider).
3. If no clearly-cheaper option is obvious, **ask** which model to delegate to
   rather than guessing — the wrong pick wastes the run.

The per-task `model` override is the right mechanism precisely because the main
model can change: the override pins each worker to the chosen cheap model
regardless of what the orchestrator is running at that moment. Examples below use
`<cheap-model>` as a placeholder — substitute the resolved model.

```typescript
subagent({
  tasks: [
    { agent: "worker", model: "<cheap-model>", task: "<full self-contained spec for unit A>", output: "units/a.md", outputMode: "file-only" },
    { agent: "worker", model: "<cheap-model>", task: "<full self-contained spec for unit B>", output: "units/b.md", outputMode: "file-only" },
    { agent: "worker", model: "<cheap-model>", task: "<full self-contained spec for unit C>", output: "units/c.md", outputMode: "file-only" }
  ],
  concurrency: 3,
  async: true
})
```

Rules for the fan-out:

- **One cheap model per task** via `model`. Keep the orchestrator on the strong
  model; only the workers get downgraded.
- **`concurrency`** caps how many run at once. Default 3–4; raise it for many
  tiny units, lower it if the units are heavy.
- **`async: true`** so the main chat stays unblocked. While workers run, the
  orchestrator does integration prep, not parallel edits to the same files.
- **Distinct `output` paths** — concurrent children must never write the same
  file. Use `outputMode: "file-only"` for large outputs so the parent result
  stays compact.
- **No shared worktree writes.** If units genuinely must edit the repo
  concurrently, isolate each with `worktree: true` instead of letting them
  collide.

#### Cheap-worker prompt contract

Because the worker is less capable, the spec must be **tighter**, not looser.
Each task string should carry:

- **Goal** — the one concrete artifact this unit produces.
- **Contract** — the exact types/signatures/paths it must conform to (copied in,
  not referenced from parent history — children don't see it).
- **Constraints** — what not to touch; "edit only `<paths>`"; no scope creep.
- **Validation** — the local check to run and the expected result.
- **Output** — the exact shape to return (file written, summary format).

Add structured `acceptance` for write units so the runtime runs a bounded
self-check before reporting done:

```typescript
{
  agent: "worker",
  model: "<cheap-model>",
  task: "<full spec>",
  acceptance: {
    criteria: ["Conforms to the given contract", "Edits only the named files", "Local check passes"],
    evidence: ["changed-files", "validation-output"],
    verify: [{ id: "check", command: "<targeted test/lint command>" }],
    stopRules: ["Do not edit files outside the named paths", "Stop and report if the contract is ambiguous"],
    maxFinalizationTurns: 2
  }
}
```

### 4. Integrate

When the workers finish, the **orchestrator** (strong model) does the joins that
cheap models are bad at: reconciling seams between units, fixing contract drift,
wiring the pieces into the whole, and removing any slop. This is where the
expensive model earns its cost — on the 10% that's hard, not the 90% that's
mechanical.

If a worker produced something off-contract, prefer to fix it inline rather than
re-spawning, unless the miss is large and clean to redo.

### 5. Verify

Run the repo's quality gate on the integrated result — never trust the sum of
green per-unit checks to mean the whole is green:

```
lint → typecheck → tests
```

Fix the cross-unit failures (the seams) yourself. A unit passing in isolation
does not mean it composes correctly.

## Worked shape: repetitive edit across modules

Task: "Add the same new field + validation to 6 independent API handlers."

1. **Plan** — fix the field name, type, validation rule, and error message once.
2. **Decompose** — 6 units, one per handler file, each fully independent.
3. **Fan out** — 6 `worker` tasks at a cheap model, `concurrency: 4`, each told
   the exact field/type/rule and "edit only `handlers/<name>.ts`".
4. **Integrate** — orchestrator checks the shared validation helper is consistent
   across all 6, dedupes if they each inlined it.
5. **Verify** — full test suite; fix any handler that drifted from the contract.

## Cost / efficiency notes

- The win is **decomposition quality**, not raw parallelism. Bad splits create
  coupling that the orchestrator pays to untangle, erasing the savings.
- Cheap models need **more spec, less latitude**. The orchestrator spends its
  tokens on a precise plan once, then amortizes it across N cheap runs.
- Parallelism cuts **wall-clock**; cheap models cut **cost**. You get both only
  when units are truly independent and truly mechanical.
- If you find yourself re-spawning workers to fix their output repeatedly, the
  unit was too hard for the cheap model — pull it back to the orchestrator or a
  capable `worker`.

## Constraints

- **Parent owns orchestration.** Children get concrete tasks; they do not plan,
  decompose, or spawn subagents.
- **Single writer per target.** Independent files or isolated worktrees only —
  never concurrent writes to the same region.
- **Self-contained specs.** Children don't inherit parent history; copy every
  contract detail into the task string.
- **Strong model integrates and verifies.** Cheap models do bulk units; the
  orchestrator owns the seams and the final gate.
- **Resolve the worker model at call time.** The active model can change
  mid-chat; pick the cheap model per fan-out via the per-task `model` override,
  never a hardcoded default. Ask if no clearly-cheaper option is obvious.
