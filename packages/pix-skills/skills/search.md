---
name: search
description: Deep logic discovery and project context mapping. Use when user asks "where is X", "find all usages of Y", "how is Z wired up", "what handles this", or location of a behavior is unknown across many files.
disable-model-invocation: true
---
# Deep Context Search Directive

## Goal
Build precise map of where a behavior lives and how it connects — so next action operates on full context, not single match.

## Tool Tiers (match tool to scope)
- **Unknown location, pattern across many files, comments/strings/config** → native `Grep` / `Read`.
- **Known symbol — definition, usages, type** → LSP `goToDefinition` / `findReferences` / `hover`.
- Start with `Grep` to locate, then switch to LSP for exact navigation. Never grep what LSP can resolve exactly.

## Below are what agent MUST do:

### Phase 1: Scan
- **AUTO-RUN**: Run searches without confirmation unless input required.
- **SEARCH**: Grep for content, glob for structure. Search synonyms and likely alternate spellings, not just literal term.
- **GROUP**: Cluster matches by intent — Logic, Config, Tests, Docs.

### Phase 2: Trace
- **FLOW**: For each cluster, identify how data flows in and out. Note every call site.
- **DEPENDENCIES**: Map cross-module references the matches rely on.
- **IDENTIFY**: Flag inconsistencies, anti-patterns, deviations from project convention.

### Phase 3: Report
```
## Target: [what was searched]

## Found in
- **Logic**: `path:line` — [role]
- **Config**: `path:line` — [role]
- **Tests**: `path:line` — [role]

## How it connects
[entry point] → [path:line] → [path:line] → [exit]

## Notes
[Inconsistencies, dead code, missing coverage, surprises.]
```

## Red Flags — STOP
- Reporting first match without checking for others.
- Searching only literal string when synonyms/aliases likely exist.
- Using LSP for broad sweep, or grep for exact symbol resolution.
