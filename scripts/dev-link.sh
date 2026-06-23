#!/usr/bin/env bash
#
# Symlink local workspace packages into Pi's extension node_modules so edits
# in this repo are picked up instantly — no npm publish / reinstall round-trip.
#
# For packages that declare "pi.extensions", also patches settings.json so Pi
# loads their extension entry. Packages without "pi.extensions" (lib packages
# like pix-bash that are soft-loaded by pix-pretty) only need the symlink.
#
# Usage:
#   scripts/dev-link.sh           # link repo packages into Pi
#   scripts/dev-link.sh --unlink  # restore the real npm-installed copies
#
# After (un)linking, restart your Pi session so the extension host reloads.
#
# A `pi install` / `npm install` inside the Pi extensions dir will replace the
# symlinks with fresh npm copies; just re-run this script to relink.
set -euo pipefail

# Where Pi installs npm extensions. Override with PI_NPM_DIR if non-default.
PI_NPM_DIR="${PI_NPM_DIR:-$HOME/.pi/agent/npm}"
TARGET_DIR="${PI_NPM_DIR}/node_modules/@xynogen"
SETTINGS_FILE="${HOME}/.pi/agent/settings.json"

repo_root=$(cd "$(dirname "$0")/.." && pwd)
packages_dir="${repo_root}/packages"

if [ ! -d "$TARGET_DIR" ]; then
	echo "✖ Pi extensions dir not found: ${TARGET_DIR}" >&2
	echo "  Install the packages once via 'pi install' first, or set PI_NPM_DIR." >&2
	exit 1
fi

unlink=false
[ "${1:-}" = "--unlink" ] && unlink=true

linked=0
restored=0
registered=0
unregistered=0

# ── helpers ──────────────────────────────────────────────────────────────────

# Resolve pix-core's full transitive @xynogen/* dependency closure (members +
# shared libs like pix-pretty/pix-data they pull in). These are all booted in
# process by pix-core's aggregator, so none may be registered independently —
# doing so double-registers their tools/extensions and triggers Pi conflicts.
# Printed once, newline-separated, into CORE_CLOSURE.
CORE_CLOSURE=""
compute_core_closure() {
	CORE_CLOSURE=$(node -e "
const fs = require('fs');
const path = require('path');
const pkgDir = '${packages_dir}';
const readDeps = (name) => {
  const short = name.replace(/^@xynogen\//, '');
  const pj = path.join(pkgDir, short, 'package.json');
  try { return Object.keys(JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies || {}); }
  catch { return []; }
};
const seen = new Set();
const stack = readDeps('@xynogen/pix-core').filter((d) => d.startsWith('@xynogen/'));
while (stack.length) {
  const d = stack.pop();
  if (seen.has(d)) continue;
  seen.add(d);
  for (const next of readDeps(d)) if (next.startsWith('@xynogen/')) stack.push(next);
}
process.stdout.write([...seen].join('\n'));
" 2>/dev/null)
}

# Returns 0 if the package is in pix-core's transitive closure.
# pix-core is always the aggregator when dev-link runs, so we don't gate on
# whether it's already in settings.json — it will be registered this run.
is_aggregated_by_core() {
	local pkg_name="$1"
	printf '%s\n' "$CORE_CLOSURE" | grep -qx "$pkg_name"
}

# Returns 0 if package.json has pi.extensions OR pi.themes (needs settings.json entry).
has_pi_extensions() {
	node -e "
const p = require('$1');
const hasExt = p.pi && Array.isArray(p.pi.extensions) && p.pi.extensions.length > 0;
const hasTheme = p.pi && (typeof p.pi.themes === 'string' || Array.isArray(p.pi.themes));
process.exit((hasExt || hasTheme) ? 0 : 1);
" 2>/dev/null
}

# Add "npm:<name>" to settings.json packages array if not already present.
settings_add() {
	local spec="npm:$1"
	[ -f "$SETTINGS_FILE" ] || return
	node -e "
const fs = require('fs');
const f = '$SETTINGS_FILE';
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!Array.isArray(s.packages)) s.packages = [];
if (!s.packages.includes('$spec')) {
  s.packages.push('$spec');
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
  process.exit(0);
}
process.exit(1);
" 2>/dev/null && return 0 || return 1
}

# Remove "npm:<name>" from settings.json packages array.
settings_remove() {
	local spec="npm:$1"
	[ -f "$SETTINGS_FILE" ] || return
	node -e "
const fs = require('fs');
const f = '$SETTINGS_FILE';
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!Array.isArray(s.packages)) process.exit(1);
const before = s.packages.length;
s.packages = s.packages.filter(p => p !== '$spec');
if (s.packages.length < before) {
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
  process.exit(0);
}
process.exit(1);
" 2>/dev/null && return 0 || return 1
}

# ── main loop ─────────────────────────────────────────────────────────────────

# Also symlink packages into the repo's own node_modules/@xynogen so that
# Node can resolve @xynogen/* imports when traversing up from a symlink target
# (packages/<pkg>/src/). Without this, cross-package imports like
# @xynogen/pix-pretty/ansi fail at runtime because Node follows the real path
# of a symlink when walking node_modules ancestors.
REPO_NM_DIR="${repo_root}/node_modules/@xynogen"
mkdir -p "$REPO_NM_DIR"

compute_core_closure

for dir in "$packages_dir"/*/; do
	pkg_json="${dir}package.json"
	[ -f "$pkg_json" ] || continue

	name=$(node -p "require('${pkg_json}').name")
	# Strip the @xynogen/ scope to get the dir name under @xynogen.
	short="${name#@xynogen/}"
	dest="${TARGET_DIR}/${short}"
	needs_registration=false
	has_pi_extensions "$pkg_json" && needs_registration=true

	if [ "$unlink" = true ]; then
		# Only restore entries we previously symlinked.
		if [ -L "$dest" ]; then
			rm "$dest"
			echo "↩ unlinked ${name}"
			restored=$((restored + 1))
		fi
		# Remove repo node_modules symlink too.
		[ -L "${REPO_NM_DIR}/${short}" ] && rm "${REPO_NM_DIR}/${short}"
		# Remove from settings.json if it was registered.
		if [ "$needs_registration" = true ]; then
			if settings_remove "$name"; then
				echo "  ✖ removed ${name} from settings.json"
				unregistered=$((unregistered + 1))
			fi
		fi
		continue
	fi

	# Remove the existing npm copy (or stale link) and point at the repo.
	rm -rf "$dest"
	ln -s "${dir%/}" "$dest"
	# Also symlink into repo node_modules so Node traversal resolves @xynogen/*.
	rm -rf "${REPO_NM_DIR}/${short}"
	ln -s "${dir%/}" "${REPO_NM_DIR}/${short}"
	echo "→ linked ${name} → ${dir%/}"
	linked=$((linked + 1))

	# Register in settings.json if the package has extension entries,
	# but skip packages already loaded transitively via pix-core aggregator.
	if [ "$needs_registration" = true ]; then
		if is_aggregated_by_core "$name"; then
			# A prior run may have wrongly registered this member — purge it so
			# pix-core's in-process boot is the only loader (no tool conflict).
			if settings_remove "$name"; then
				echo "  ✖ unregistered ${name} (loaded by pix-core)"
				unregistered=$((unregistered + 1))
			else
				echo "  ↷ skipped ${name} (loaded by pix-core)"
			fi
		elif settings_add "$name"; then
			echo "  ✔ registered ${name} in settings.json"
			registered=$((registered + 1))
		fi
	fi
done

echo ""
if [ "$unlink" = true ]; then
	echo "Restored ${restored} package(s), removed ${unregistered} from settings.json."
	echo "Restart your Pi session to reload."
else
	echo "Linked ${linked} package(s), registered ${registered} new in settings.json."
	echo "Restart your Pi session to reload."
fi
