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

# NOTE: this list is intentionally NOT symmetric with install.sh.
#
# install.sh installs only `pix-core` (npm pulls the member tree; the
# aggregator boots them in-process), so it lists a single CORE package. But
# uninstall MUST enumerate every package individually: a user may have
# `pi install`'d members standalone (e.g. just pix-bash + pix-read, never the
# meta), so we cannot assume the meta-tree shape and must sweep all known
# packages. `pi remove` on an absent package is a safe no-op ("No matching
# package found", exit 0), so the full sweep is fully idempotent.

# CORE module — pix-core meta extension, its sub-packages, and the shared
# pix-data model data layer they read from.
CORE_PACKAGES="
npm:@xynogen/pix-data
npm:@xynogen/pix-core
npm:@xynogen/pix-welcome
npm:@xynogen/pix-footer
npm:@xynogen/pix-commands
npm:@xynogen/pix-update
npm:@xynogen/pix-nudge
npm:@xynogen/pix-diagnostics
npm:@xynogen/pix-prompts
npm:@xynogen/pix-skills
npm:@xynogen/pix-models
"

# EXTENSION module — standalone extension + tool packages.
EXTENSION_PACKAGES="
npm:@xynogen/pix-themes
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

info() { printf '\033[0;34m›\033[0m %s\n' "$*"; }
success() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m✖\033[0m %s\n' "$*" >&2; }

if ! command -v pi >/dev/null 2>&1; then
	error "'pi' not found on PATH — nothing to uninstall."
	exit 1
fi

# Restore Pi's built-in /model slash command.
#
# pix-models strips the `/model` line from Pi's compiled slash-commands.js at
# load time (see packages/pix-models/src/patch-builtin.ts). Removing the
# package leaves that edit in place, so we re-insert the line here — mirroring
# the same host-resolution strategy and placing /model back as the first entry
# in BUILTIN_SLASH_COMMANDS, its original stock position. This exactly counters
# the strip in patch-builtin.ts. Idempotent: a no-op if the line is already present.
restore_builtin_model_command() {
	runtime=""
	if command -v bun >/dev/null 2>&1; then
		runtime="bun"
	elif command -v node >/dev/null 2>&1; then
		runtime="node"
	else
		warn "No bun/node runtime found — cannot restore built-in /model command."
		return 0
	fi

	info "Restoring Pi's built-in /model command..."
	"$runtime" -e '
const { execSync } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

// Anchor on the array opening so /model is restored as the first entry,
// matching stock Pi and inverting the position-agnostic strip in patch-builtin.
const ARRAY_OPEN_RE = /(export const BUILTIN_SLASH_COMMANDS = \[\n)([ \t]*)/m;

function candidatePaths() {
  const paths = [];
  try {
    const piReal = execSync("realpath $(which pi)", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (piReal) paths.push(join(resolve(dirname(piReal), "core"), "slash-commands.js"));
  } catch {}
  const home = homedir();
  for (const root of [
    join(home, ".bun", "install", "global", "node_modules"),
    join(home, ".npm-global", "lib", "node_modules"),
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
  ]) {
    paths.push(join(root, "@earendil-works", "pi-coding-agent", "dist", "core", "slash-commands.js"));
  }
  try {
    const req = createRequire(`${process.cwd()}/`);
    const entry = req.resolve("@earendil-works/pi-coding-agent");
    paths.push(resolve(dirname(entry), "core", "slash-commands.js"));
  } catch {}
  return paths;
}

const file = candidatePaths().find((p) => existsSync(p));
if (!file) process.exit(0);
let source;
try { source = readFileSync(file, "utf8"); } catch { process.exit(0); }
if (source.includes(`{ name: "model", description:`)) process.exit(0);
const m = source.match(ARRAY_OPEN_RE);
if (!m) process.exit(0);
const indent = m[2];
const line = `${indent}{ name: "model", description: "Select model (opens selector UI)" },\n`;
const patched = source.replace(ARRAY_OPEN_RE, `${m[1]}${line}${indent}`);
if (patched === source) process.exit(0);
try { writeFileSync(file, patched, "utf8"); } catch {}
' && success "Built-in /model command restored." || warn "Could not restore /model (read-only install?)."
}

# `pi remove` is itself idempotent: on an absent package it exits 0 and prints
# "No matching package found". We must NOT pre-guard with `pi list | grep`,
# because `pi list` emits a TTY-dependent listing — piped (no TTY) it omits the
# extension packages entirely, so the grep would always miss and skip every
# removal. Call `pi remove` unconditionally and classify by its output instead.
remove_pi_pkg() {
	spec="$1"
	info "Removing pi pkg: $spec"
	out=$(pi remove "$spec" 2>&1) || true
	if printf '%s' "$out" | grep -qiF 'no matching package'; then
		info "Not installed, skipping: $spec"
	elif printf '%s' "$out" | grep -qiF 'removed'; then
		success "Removed: $spec"
	else
		warn "Could not confirm removal of: $spec"
	fi
}

info "Uninstalling Pix core module..."
for spec in $CORE_PACKAGES; do
	remove_pi_pkg "$spec"
done

info "Uninstalling Pix extension module..."
for spec in $EXTENSION_PACKAGES; do
	remove_pi_pkg "$spec"
done

restore_builtin_model_command

success "pix-mono uninstalled. Restart pi to apply."
