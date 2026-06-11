---
name: audit
description: Security audit, integrity check, and health scan. Use only on explicit request — "audit this", "security scan", "check for secrets", "is this safe", "find vulnerabilities".
disable-model-invocation: true
---
# Audit Directive

## Goal
Surface every risk with evidence + severity. No vague warnings — each finding locatable + actionable.

## Below are what agent MUST do:

### Phase 1: Scan
- **AUTO-RUN**: Run scans without confirmation unless input required.
- **SECRETS**: Grep credential patterns — API keys, tokens, `password=`, private keys, connection strings. Check committed files AND history if asked.
- **INTEGRITY**: Verify imports resolve, symlinks valid, cross-module refs intact.
- **BLOAT**: Find duplicate logic, unused deps, dead files.
- **HEALTH**: Flag outdated packages, deprecated APIs, known CVEs.
- **INPUTS**: Check unvalidated user input → injection, path traversal, unsafe deserialization.

### Phase 2: Report
```
## Audit Findings

### 🔴 Critical
- **[Issue]** — `file:line`
  Evidence: [exact match/snippet]
  Fix: [remediation step]

### 🟡 Warning
- **[Issue]** — `file:line` · Fix: [step]

### 🔵 Info
- **[Issue]** — `file:line` · Note: [context]

## Summary
[N critical, N warning, N info. Top priority: ...]
```

## Severity Rules
- **🔴 Critical**: exposed secret, RCE, injection, auth bypass. Fix first.
- **🟡 Warning**: outdated dep with CVE, missing input validation, weak crypto.
- **🔵 Info**: dead code, style risk, hardening opportunity.

## Red Flags — STOP
- Reporting finding without `file:line` evidence.
- Claiming "no issues found" without stating what scanned.
- Auto-fixing secrets in git history (destructive — confirm with user first).
