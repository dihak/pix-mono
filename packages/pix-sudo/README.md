# pix-sudo

Pi tool — `sudo_run` with interactive PAM password prompt.

## What it does

Registers the `sudo_run` tool, which executes shell commands as root behind a permission dialog (the shared overlay component from `@xynogen/pix-pretty`). Every command requires explicit per-call Allow/Deny approval in the UI, with a 30-second auto-deny timeout — that approval step is never skipped. The dialog shape depends on PAM's sudo ticket cache: if a valid cached ticket exists (`sudo -n true`), the tool shows a confirm-only dialog (Allow/Deny, body notes "sudo session active") and runs with an empty password; if no valid ticket exists, it runs the two-stage flow — Allow/Deny first, then a masked password input (`●` per character). The password is passed to `sudo -S -- sh -c <cmd>` via stdin, never written to disk, and cleared from memory immediately after use; pix-sudo itself stores nothing. The ticket cache is the kernel/PAM tty timestamp (default ~15 min, OS-managed sudoers timeout), so it only skips re-typing the password, never the approval. Output is truncated to 50 KB / 2000 lines. In non-interactive (RPC/JSON) mode the tool is blocked immediately with an error.

## Install

```bash
pi install npm:@xynogen/pix-sudo
```

## Full distro

Source: [github.com/xynogen/pix-mono](https://github.com/xynogen/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
