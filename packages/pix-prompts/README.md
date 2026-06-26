# pix-prompts

Pi extension — system-prompt injection (SOP.md + repo directives).

## What it does

Injects structured context into the system prompt at the start of every agent turn via `before_agent_start`. Two sources are injected in order: the bundled `SOP.md` (the pix agent operating spec baseline), followed by any repo-root directive files found in the current working directory (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`). Each source is wrapped in a labelled XML tag for provenance.

Injection is **idempotent and host-aware**. A file is skipped when either (a) our own tag is already present in the prompt (retry turns), or (b) the Pi host has already injected that same absolute path as `<project_instructions path="...">`. Pi natively auto-loads `AGENTS.md` / `CLAUDE.md`, so the host-path check prevents a byte-identical double-injection without statically assuming what the host will do — if the host stops injecting a file, pix-prompts picks it back up; if it injects one, pix-prompts skips it. Coverage can never silently double or drop.

## Install

```bash
pi install npm:@xynogen/pix-prompts
```

> Also included in [`@xynogen/pix-core`](https://www.npmjs.com/package/@xynogen/pix-core):
>
> ```bash
> pi install npm:@xynogen/pix-core
> ```

## Full distro

Source: [github.com/xynogen/pix-mono](https://github.com/xynogen/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
