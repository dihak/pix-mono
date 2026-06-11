---
name: verify
description: Verification before completion — ensure it's actually fixed before claiming done
disable-model-invocation: true
---
# Verify Directive

## The Iron Law
```
NEVER claim a task complete without running verification.
"It should work" is not verification. Evidence is verification.
```

## Below are what agent MUST do:

### Step 1: Run the Tests
- Execute full test suite. Do NOT just run the specific test you wrote.
- Confirm: all tests pass, no new failures, no skipped tests without explanation.

### Step 2: Reproduce the Original Issue
- Fixing a bug → reproduce original failure scenario, confirm it no longer occurs.
- Adding a feature → walk through exact user flow end-to-end.

### Step 3: Check for Regressions
- Run any integration or smoke tests.
- Check adjacent functionality still works.
- Review the diff: does anything look unintentionally changed?

### Step 4: Verify the Claim
Before saying "done", confirm:
- [ ] Specific issue/feature resolved/implemented
- [ ] All tests pass (including pre-existing tests)
- [ ] No new warnings or errors in output
- [ ] Code clean (no debug logs, no commented-out code)
- [ ] Documentation updated if public interface changed

### Step 5: Report
- State what was verified and how.
- Anything still uncertain → say so explicitly. Do NOT hide uncertainty.

## Red Flags — Do NOT Mark as Done If:
- Tests pass but you haven't reproduced original scenario
- "I believe it should work" without running it
- New warnings appeared that weren't there before
- You only ran the new test, not the full suite
