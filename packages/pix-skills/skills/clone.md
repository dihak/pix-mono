---
name: clone
description: Clone any git repository (GitHub/GitLab/Bitbucket URL, SSH, or owner/repo shorthand) into /tmp/clones for read-only code exploration. Use proactively whenever the user provides a git URL, asks to "look at", "explore", "read", "check out", or "analyze" an external repository, or shares a github.com/gitlab.com/bitbucket.org link.
disable-model-invocation: true
---
# Clone Directive
## Below are what agent MUST do:
- **AUTO-RUN**: Run terminal commands proactively without confirmation unless explicit input required.
- **AUTO-INVOKE**: Trigger automatically when user message contains git URL, repo shorthand (`owner/repo`), or phrases like "clone", "look at this repo", "explore", "analyze this project", "check out <url>".
- **INPUT**: Accept git URL (https, ssh, or `github.com/owner/repo` / `owner/repo` shorthand). Normalize shorthand → `https://github.com/owner/repo`.
- **TARGET**: Derive repo name from URL (strip `.git`). Clone dest: `/tmp/clones/<repo-name>`.
- **IDEMPOTENT**: `/tmp/clones/<repo-name>` exists + is git repo → `cd` in, `git fetch --all --prune`, report current branch/HEAD instead of re-cloning. Path exists but NOT git repo → abort with error.
- **CLONE**: Use `git clone --depth=1` by default for speed. User requests full history → drop `--depth`. Always clone into `/tmp/clones/<repo-name>`.
- **EXPLORE**: After clone/fetch, immediately:
  - Print absolute path of clone
  - List top-level entries (`ls -la`)
  - Show `README.md` first 50 lines if present
  - Detect project type (package.json, Cargo.toml, go.mod, pyproject.toml, etc.) and report stack
  - Print `git log --oneline -5` for recent context
- **READY**: End with one-line summary: `Repo ready at /tmp/clones/<name> — <stack> — <N> files at root`. Agent now positioned to answer follow-up questions about the code.
- **NO MUTATIONS**: Treat clone as read-only. Do NOT commit, push, or modify files unless user explicitly requests it.
- **CLEANUP NOTE**: `/tmp` is ephemeral (cleared on reboot). Inform user if they want persistence to move it elsewhere.
