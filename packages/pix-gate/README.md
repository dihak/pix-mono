# pix-gate

Pi extension — permission gate for dangerous bash commands.

## What it does

Intercepts every `bash` tool call and classifies the command against a set of severity rules before it runs. Two rule sets: **path rules** (block / warn / info) protect the `read` / `write` / `edit` tools from touching private keys, credential files, etc. — `block` is deny-first (15s timeout), `warn` is allow-first (30s), `info` is a blue notify that never blocks. **Command rules** (critical / dangerous / risky) gate `bash` invocations: `critical` (force pushes to main, recursive deletes, `dd` to disks, etc.) is hard-blocked in non-interactive mode and hard-denied via a 15-second auto-deny dialog in TUI mode; `dangerous` commands (including any `sudo` invocation, which is hard-redirected to the `sudo_run` tool — no bypass) show a 30-second auto-deny confirmation dialog; `risky` commands show a 60-second allow-first dialog and silently pass in non-interactive mode. Auto-approve patterns and extra rules can be configured in `~/.pi/agent/pix-gate.json`. Built-in rules can be replaced entirely by setting `disableDefaults: true` in the config file.

## Install

```bash
pi install npm:@dihak/pix-gate
```

> Also included in [`@dihak/pix-core`](https://www.npmjs.com/package/@dihak/pix-core):
>
> ```bash
> pi install npm:@dihak/pix-core
> ```

## Reusable exports

The gate is split into a pure rule engine and the interactive prompt, so the
classification logic can be reused without the TUI:

- `@dihak/pix-gate/lib` — pure rules: `DEFAULT_RULES`, `buildRules`,
  `classify`, `loadUserConfig`, `isSudoCommand`. No Pi/TUI dependency.
- `@dihak/pix-gate/prompt` — `promptGateDecision()`, the confirm/deny dialog
  (depends on `pi-tui`). This is now a thin adapter over the shared
  `@dihak/pix-pretty/gate-overlay` component, so the gate and `sudo_run`
  dialogs share one implementation.

`pix-skills` imports `./lib` to gate skill `` !`cmd` `` directives with the same
rules as the bash tool (auto-deny on match, no prompt).

## Configuration

Gate rules are read from the **`gate` section of `~/.pi/agent/pix.json`** (the unified config file). The legacy `~/.pi/agent/pix-gate.json` file is no longer used.

`~/.pi/agent/pix.json` — `gate` section:

```jsonc
{
  "gate": {
    "disableDefaults": false,
    "extraRules": [
      { "pattern": "rm -rf /my-dir", "severity": "critical", "reason": "Deletes project root" }
    ],
    "autoApprove": ["^echo "]
  }
}
```

The schema is identical to the old `pix-gate.json` — move your existing config into `pix.json` under the `gate` key.

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
