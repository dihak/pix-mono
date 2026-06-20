# pix-gate

Pi extension — permission gate for dangerous bash commands.

## What it does

Intercepts every `bash` tool call and classifies the command against a set of severity rules before it runs. Three tiers apply: `critical` commands are blocked outright in non-interactive mode and hard-denied via dialog in TUI mode; `dangerous` commands (including any `sudo` invocation, which is redirected to `sudo_run`) show a 30-second auto-deny confirmation dialog; `risky` commands show a 60-second allow-first dialog and silently pass in non-interactive mode. Auto-approve patterns and extra rules can be configured in `~/.pi/agent/pix-gate.json`. Built-in rules can be replaced entirely by setting `disableDefaults: true` in the config file.

## Install

```bash
pi install npm:@xynogen/pix-gate
```

## Reusable exports

The gate is split into a pure rule engine and the interactive prompt, so the
classification logic can be reused without the TUI:

- `@xynogen/pix-gate/lib` — pure rules: `DEFAULT_RULES`, `buildRules`,
  `classify`, `loadUserConfig`, `isSudoCommand`. No Pi/TUI dependency.
- `@xynogen/pix-gate/prompt` — `promptGateDecision()`, the confirm/deny dialog
  (depends on `pi-tui`).

`pix-skills` imports `./lib` to gate skill `` !`cmd` `` directives with the same
rules as the bash tool (auto-deny on match, no prompt).

## Configuration

`~/.pi/agent/pix-gate.json`:

```json
{
  "disableDefaults": false,
  "extraRules": [
    { "pattern": "rm -rf /my-dir", "severity": "critical", "reason": "Deletes project root" }
  ],
  "autoApprove": ["^echo "]
}
```

## Full distro

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
