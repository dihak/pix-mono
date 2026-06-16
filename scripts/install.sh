#!/bin/sh
#
# Install the pix-mono distro into Pi Coding Agent.
#
# Self-contained + POSIX sh: installs Pi itself (via Bun), configures theme +
# tools, then installs every @xynogen/pix-* package from npm. Safe to re-run.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
#   # or, from a local checkout:
#   sh scripts/install.sh
#
# Prerequisites: Bun (https://bun.sh).
set -eu

PI_ROOT="$HOME/.pi/agent"
PI_THEME="pix-tokyo-night"
SETTINGS_FILE="$PI_ROOT/settings.json"
DEFAULT_TOOLS='["read", "bash", "edit", "write", "grep", "find", "ls", "search", "fetch", "transcribe", "ask_user", "todo", "read_skills", "ast_grep_search", "ast_grep_replace", "lsp_navigation", "lsp_diagnostics", "lens_diagnostics"]'

# Space-separated package list (POSIX sh has no arrays).
PIX_PACKAGES="
npm:@xynogen/pix-core
npm:@xynogen/pix-pretty
npm:@xynogen/pix-optimizer
npm:@xynogen/pix-skills
npm:@xynogen/pix-tokyo-night
npm:@xynogen/pix-9router
npm:@xynogen/pix-data
npm:@xynogen/pix-sudo
"

# --- minimal logging helpers (no external lib dependency) ------------------
info() { printf '\033[0;34m›\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m✖\033[0m %s\n' "$*" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# --- 1. install / update Pi -------------------------------------------------
# Prefer Bun; fall back to npm. JS_RUNTIME records which one is available so we
# can reuse it later for the settings.json merge (no python needed).
info "Setting up Pi Coding Agent..."

if command_exists bun; then
	JS_RUNTIME="bun"
	info "Installing @earendil-works/pi-coding-agent globally (bun)..."
	if bun add -g --ignore-scripts @earendil-works/pi-coding-agent; then
		success "Pi Coding Agent installed/updated."
	else
		error "Failed to install @earendil-works/pi-coding-agent via bun."
		exit 1
	fi
elif command_exists npm; then
	JS_RUNTIME="node"
	warn "Bun not found — falling back to npm."
	info "Installing @earendil-works/pi-coding-agent globally (npm)..."
	if npm install -g --ignore-scripts @earendil-works/pi-coding-agent; then
		success "Pi Coding Agent installed/updated."
	else
		error "Failed to install @earendil-works/pi-coding-agent via npm."
		exit 1
	fi
else
	error "Neither Bun (https://bun.sh) nor npm (https://nodejs.org) is installed."
	exit 1
fi

if ! command_exists pi; then
	error "'pi' not found on PATH after install. Ensure the global bin dir is on PATH."
	exit 1
fi

# --- 2. configure theme + tools --------------------------------------------
# Merge theme/tools into settings.json using the same JS runtime that installed
# Pi (bun or node) — no python dependency.
info "Configuring Pi environment..."
mkdir -p "$PI_ROOT"

info "Configuring tools/theme..."
"$JS_RUNTIME" -e '
const fs = require("fs");
const [file, theme, tools] = [process.argv[1], process.argv[2], JSON.parse(process.argv[3])];
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
settings.tools = tools;
settings.theme = theme;
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
' "$SETTINGS_FILE" "$PI_THEME" "$DEFAULT_TOOLS"

# --- 3. install the pix distro ---------------------------------------------
install_pi_pkg() {
	spec="$1"
	if pi list 2>/dev/null | grep -qF "$spec"; then
		success "Pi pkg already installed: $spec"
		return 0
	fi
	info "Installing pi pkg: $spec"
	if pi install "$spec" >/dev/null 2>&1; then
		success "Pi pkg installed: $spec"
	else
		error "Failed to install pi pkg: $spec"
	fi
}

info "Installing Pix Distro..."
for spec in $PIX_PACKAGES; do
	install_pi_pkg "$spec"
done

mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/pi/fff"

# --- 4. done ----------------------------------------------------------------
# Note: the built-in /model command is removed by pix-core at extension load
# (self-healing across Pi upgrades) — no install-time patch needed here.
info "Authentication Setup:"
warn "Run 'pi' then '/login' to use a subscription (Claude/ChatGPT/Copilot)."
success "pix-mono setup complete!"
