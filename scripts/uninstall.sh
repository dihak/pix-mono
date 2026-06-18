#!/bin/sh
#
# Uninstall the pix-mono distro from Pi Coding Agent.
#
# Removes every @xynogen/pix-* package that the install script registers.
# Safe to re-run — skips packages that are already absent.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/uninstall.sh | sh
#   # or, from a local checkout:
#   sh scripts/uninstall.sh   # or: bun run uninstall:distro
set -eu

# Mirror of install.sh PIX_PACKAGES — keep in sync.
PIX_PACKAGES="
npm:@xynogen/pix-data
npm:@xynogen/pix-tokyo-night
npm:@xynogen/pix-optimizer
npm:@xynogen/pix-9router
npm:@xynogen/pix-pretty
npm:@xynogen/pix-bash
npm:@xynogen/pix-read
npm:@xynogen/pix-write
npm:@xynogen/pix-edit
npm:@xynogen/pix-find
npm:@xynogen/pix-grep
npm:@xynogen/pix-ls
npm:@xynogen/pix-sudo-run
npm:@xynogen/pix-core
"

# Sub-packages bundled inside pix-core's dep graph — not in settings.json after
# install, but `pi remove` is idempotent so listing them here is harmless and
# ensures a clean slate if someone had an older install with them listed.
PIX_SUBPACKAGES="
npm:@xynogen/pix-welcome
npm:@xynogen/pix-footer
npm:@xynogen/pix-diagnostics
npm:@xynogen/pix-prompts
npm:@xynogen/pix-skills
npm:@xynogen/pix-models
npm:@xynogen/pix-update
npm:@xynogen/pix-commands
npm:@xynogen/pix-nudge
npm:@xynogen/pix-todo
npm:@xynogen/pix-ask
npm:@xynogen/pix-toolbox
npm:@xynogen/pix-sudo
"

info() { printf '\033[0;34m›\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m✖\033[0m %s\n' "$*" >&2; }

if ! command -v pi >/dev/null 2>&1; then
	error "'pi' not found on PATH — nothing to uninstall."
	exit 1
fi

remove_pi_pkg() {
	spec="$1"
	if ! pi list 2>/dev/null | grep -qF "$spec"; then
		info "Not installed, skipping: $spec"
		return 0
	fi
	info "Removing pi pkg: $spec"
	if pi remove "$spec" >/dev/null 2>&1; then
		success "Removed: $spec"
	else
		warn "Failed to remove (may already be absent): $spec"
	fi
}

info "Uninstalling Pix Distro..."
for spec in $PIX_PACKAGES $PIX_SUBPACKAGES; do
	remove_pi_pkg "$spec"
done

success "pix-mono uninstalled. Restart pi to apply."
