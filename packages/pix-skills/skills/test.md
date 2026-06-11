---
name: test
description: Test execution, analysis, and failure resolution using TDD
disable-model-invocation: true
---
# Test Directive

## The Iron Law
```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```
Wrote code before the test? Delete it. Start over.

## Below are what agent MUST do:

### Red-Green-Refactor Cycle (for new features/bugfixes)
- **RED**: Write one minimal failing test showing what SHOULD happen. Run it. Confirm it fails for right reason (feature missing, not a typo).
- **GREEN**: Write SIMPLEST possible code to make test pass. No extra features. No refactoring other code.
- **VERIFY GREEN**: Run the test. Confirm it passes. Confirm all other tests still pass.
- **REFACTOR**: Clean up duplication and names. Keep tests green. Do NOT add new behavior.
- **REPEAT**: Write next failing test for next behavior.

### Test Execution (for existing codebases)
- **AUTO-RUN**: Run terminal commands and tool calls proactively without confirmation.
- **DISCOVER**: Identify test frameworks and test files in project.
- **EXECUTE**: Run relevant tests with appropriate flags and coverage.
- **ANALYZE**: Parse test output to identify failures, errors, coverage gaps.
- **FIX**: Resolve test failures by addressing root causes in code or tests. Use `/debug` for complex failures.
- **REPORT**: Provide test results summary with pass/fail counts and any issues found.

## Verification Checklist
Before marking work complete:
- [ ] Every new function/method has a test
- [ ] Watched each test FAIL before implementing
- [ ] Each test failed for expected reason
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass with no errors or warnings
- [ ] Edge cases and error paths covered

Cannot check all boxes? You skipped TDD. Start over.

## Red Flags — STOP and Start Over
- Code written before the test
- Test passes immediately (you're testing existing behavior)
- "I'll write tests after to verify it works"
- "Already manually tested all the edge cases"
- "Tests after achieve the same goals"
