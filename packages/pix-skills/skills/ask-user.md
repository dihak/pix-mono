---
name: ask-user
description: "MUST use before high-stakes/irreversible decisions or when requirements are ambiguous. Gather context, present 2-5 options via ask_user, get explicit choice, then proceed."
metadata:
  short-description: Decision gate for ambiguity and high-stakes choices
---

# ask_user decision gate

Decision control, not chit-chat.

## Gate (call ask_user before proceeding if ANY true)
- changes architecture/schema/API/deploy/security
- costly to undo (big refactor, migration, destructive edit, prod behavior)
- requirements unclear/conflicting/missing
- multiple valid options, trade-off is preference-dependent
- about to assume something that changes implementation

Skip only if user already gave an explicit decision for THIS exact trade-off.

## Handshake
1. classify step: high_stakes | ambiguous | both | clear. clear → no gate.
2. gather evidence first (read/bash/web/ref). don't ask blind.
3. synthesize: 3-7 bullets — state, constraints, trade-offs, recommendation.
4. ask ONE focused question: `question`, `context`(summary), `options`(2-5),
   `allowMultiple:false` unless truly independent, `allowFreeform:true`.
   `inline` displayMode when the preceding summary must stay visible.
5. commit: restate decision, say next step, proceed.
6. re-ask only on materially new ambiguity. no confirm loops.

## Budget (anti-overasking)
- max 1 call per boundary normally; max 2 if first is unclear/cancelled.
- never re-ask same trade-off without new evidence.
- attempt 2 = narrower question: [Proceed w/ recommended] [Choose other (freeform)] [Stop].
- after attempt 2: high_stakes/both → STOP, mark blocked.
  ambiguous-only + user says "your call" → take most reversible default, state assumptions.

## Quality
- question: concrete decision boundary, one decision only.
- options: short, outcome-oriented, explicit trade-offs; add description when non-obvious.

## Anti-patterns
asking without context · trivial formatting choices · forcing options when freeform fits ·
repeat questions w/o new info · proceeding high-stakes after unclear/cancelled answer.

## On cancel / unclear
Pause, explain what's blocked. At most one narrower follow-up.
Then: high-stakes → stay blocked until explicit decision; ambiguity-only → proceed only if user delegated.
