---
name: brainstorm
description: Design exploration and spec refinement before any implementation begins
disable-model-invocation: true
---
# Brainstorm Directive

## Hard Gate

```
DO NOT write code, scaffold project, or take implementation action
until you present a design AND user approves it.
```

Applies to EVERY request, regardless of perceived simplicity.

## Below are what agent MUST do

### Step 1: Explore Context

- Check existing files, docs, recent git commits.
- Understand what already exists before proposing anything new.

### Step 2: Ask Clarifying Questions

- Ask ONE question at a time. Don't overwhelm.
- Prefer multiple-choice when possible.
- Focus on: purpose, constraints, success criteria, edge cases.
- Continue until you understand full scope.

### Step 3: Propose 2-3 Approaches

- Present distinct approaches with trade-offs.
- Lead with recommended option, explain WHY.
- Apply YAGNI ruthlessly — remove unnecessary features from all proposals.

### Step 4: Present Design for Approval

- Present design in sections scaled to complexity.
- Cover: architecture, components, data flow, error handling, testing strategy.
- Ask approval after each section. Revise if needed.

### Step 5: Write Design Doc

- Save validated design to `docs/plans/YYYY-MM-DD-<topic>-design.md`.
- Commit design document to git.

### Step 6: Transition to Implementation

- Invoke `/plan` workflow to create detailed implementation plan.
- Do NOT start coding directly. `/plan` is next step.

## Key Principles

- **One question at a time** — Don't overwhelm
- **YAGNI ruthlessly** — Remove unnecessary features from all designs
- **Explore alternatives** — Always propose 2-3 approaches before settling
- **Incremental validation** — Present design, get approval before moving on
