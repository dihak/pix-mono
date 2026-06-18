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
#                        package.json lists every bundled member as an npm
#                        `dependency` — the core UI/UX extensions (pix-welcome,
#                        pix-footer, pix-models, pix-update, pix-commands,
#                        pix-nudge, pix-diagnostics, pix-prompts, pix-skills),
#                        the standard tool suite (pix-read, pix-write, pix-edit,
#                        pix-find, pix-grep, pix-ls, pix-bash, pix-todo,
#                        pix-ask), plus pix-optimizer and pix-gate — and pulls
#                        pix-data/pix-pretty transitively. A single
#                        `pi install` fetches the whole tree;
#                        pix-core/src/extension.ts imports each member's factory
#                        and boots them in-process. Pi only needs the ONE
#                        extension registered — installing bundled members
#                        separately is redundant. So: install pix-core alone.
#   THEME_PACKAGE      — pix-tokyo-night: the default theme. Not bundled by
#                        pix-core but installed unconditionally (it is the
#                        distro's default look, not an opt-in capability).
#   OPTIN_PACKAGES     — standalone extensions NOT bundled by pix-core, each
#                        carrying a setup cost or sensitive capability (API key,
#                        root execution, power-user UI). README documents WHY
#                        each is opt-in; the installer asks per package and
#                        defaults to NO when it cannot prompt (non-interactive
#                        `curl | sh`), keeping the default distro lean.
CORE_PACKAGE="npm:@xynogen/pix-core"
THEME_PACKAGE="npm:@xynogen/pix-tokyo-night"

# Each entry: "<spec>|<why it's opt-in>". The reason is shown in the prompt so
# the user can make an informed choice (sourced from README "Why it's opt-in").
OPTIN_PACKAGES="
npm:@xynogen/pix-9router|9Router LLM provider + fetch/search tools — needs a 9Router API key, so only useful if you route through 9Router.
npm:@xynogen/pix-sudo|sudo_run — root execution via a PAM password overlay; a privileged capability you opt into explicitly (blocked in non-interactive mode).
npm:@xynogen/pix-toolbox|/toolbox — fuzzy-search picker to enable/disable tools at runtime; a power-user utility, not needed for normal use.
"

# --- minimal logging helpers (no external lib dependency) ------------------
info() { printf '\033[0;34m›\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m✖\033[0m %s\n' "$*" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# Prompt a yes/no question on the controlling terminal. Returns 0 for yes.
#
# When piped (`curl ... | sh`) stdin is the script body, not a keyboard, so we
# read from /dev/tty. If we can't reach a usable terminal (CI, fully
# non-interactive), default to NO so opt-in packages are skipped, never
# installed by surprise. $1 = question, $2 = reason shown before the prompt.
ask_yes_no() {
	question="$1"
	reason="$2"

	# Pick a readable input source: current stdin if it's a tty, else /dev/tty.
	# A bare `-e /dev/tty` test is not enough — in sandboxes the node exists but
	# open() fails (ENXIO), so probe by actually opening it.
	if [ -t 0 ]; then
		tty_in=0
	elif { : </dev/tty; } 2>/dev/null; then
		tty_in=tty
	else
		warn "Non-interactive shell — skipping: $question"
		return 1
	fi

	printf '\033[0;34m›\033[0m %s\n' "$reason"
	printf '\033[0;34m›\033[0m %s [y/N] ' "$question"
	if [ "$tty_in" = tty ]; then
		read -r answer </dev/tty || answer=""
	else
		read -r answer || answer=""
	fi
	case "$answer" in
	[Yy] | [Yy][Ee][Ss]) return 0 ;;
	*) return 1 ;;
	esac
}

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

# Theme is the distro default — always installed.
info "Installing Pix theme..."
install_pi_pkg "$THEME_PACKAGE"

# Opt-in extensions — ask per package, with the reason it's opt-in. Each line is
# "<spec>|<reason>"; split on the first '|'. IFS swap keeps the loop POSIX.
info "Optional extensions (each carries a setup cost or sensitive capability):"
OLD_IFS=$IFS
IFS='
'
for entry in $OPTIN_PACKAGES; do
	IFS=$OLD_IFS
	[ -z "$entry" ] && continue
	spec=${entry%%|*}
	reason=${entry#*|}
	if ask_yes_no "Install ${spec#npm:@xynogen/}?" "$reason"; then
		install_pi_pkg "$spec"
	else
		info "Skipped: $spec"
	fi
	IFS='
'
done
IFS=$OLD_IFS

mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/pi/fff"

# --- 4. done ----------------------------------------------------------------
# Note: the built-in /model command is removed by pix-core at extension load
# (self-healing across Pi upgrades) — no install-time patch needed here.
info "Authentication Setup:"
warn "Run 'pi' then '/login' to use a subscription (Claude/ChatGPT/Copilot)."
success "pix-mono setup complete!"
