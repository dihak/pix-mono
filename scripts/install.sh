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
DEFAULT_TOOLS='["read", "bash", "edit", "write", "grep", "find", "ls", "ask_user", "todo", "read_skills"]'

# The distro installs as two modules:
#
#   CORE_PACKAGE       — pix-core, the meta/aggregator extension. Its
#                        package.json lists every core member (pix-welcome,
#                        pix-footer, pix-models, pix-update, pix-commands,
#                        pix-nudge, pix-diagnostics, pix-prompts, pix-skills —
#                        and transitively pix-data via footer/models) as npm
#                        `dependencies`, so a single `pi install` pulls the
#                        whole tree. pix-core/src/extension.ts then imports each
#                        member's factory and boots them in-process. Pi only
#                        needs the ONE extension registered — installing the
#                        members separately is redundant (npm already fetched
#                        them) and would double-register. So: install pix-core
#                        alone.
#   EXTENSION_PACKAGES — standalone extension + tool packages. No meta bundles
#                        these; each registers its own extension/tool and must
#                        be installed individually.
CORE_PACKAGE="npm:@xynogen/pix-core"

EXTENSION_PACKAGES="
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
npm:@xynogen/pix-sudo
npm:@xynogen/pix-todo
npm:@xynogen/pix-ask
npm:@xynogen/pix-toolbox
npm:@xynogen/pix-gate
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
# `pi install` is idempotent and reports its result on stdout. We must NOT
# pre-guard with `pi list | grep`: `pi list` emits a TTY-dependent listing —
# piped (no TTY) it omits the extension packages entirely, so the grep would
# always miss and re-install everything on every run. Call `pi install`
# unconditionally and classify by its output instead ("Installed" covers both
# a fresh install and an already-present package).
install_pi_pkg() {
	spec="$1"
	info "Installing pi pkg: $spec"
	out=$(pi install "$spec" 2>&1) || true
	if printf '%s' "$out" | grep -qiF 'installed'; then
		success "Pi pkg installed: $spec"
	else
		error "Failed to install pi pkg: $spec"
	fi
}

# pix-core alone — npm resolves its dependency tree (all core members +
# pix-data); the aggregator extension boots them in-process. No per-member
# install needed.
info "Installing Pix core module..."
install_pi_pkg "$CORE_PACKAGE"

info "Installing Pix extension module..."
for spec in $EXTENSION_PACKAGES; do
	install_pi_pkg "$spec"
done

mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/pi/fff"

# --- 4. done ----------------------------------------------------------------
# Note: the built-in /model command is removed by pix-core at extension load
# (self-healing across Pi upgrades) — no install-time patch needed here.
info "Authentication Setup:"
warn "Run 'pi' then '/login' to use a subscription (Claude/ChatGPT/Copilot)."
success "pix-mono setup complete!"
