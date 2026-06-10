#!/usr/bin/env bash
#
# Symlink local workspace packages into Pi's extension node_modules so edits
# in this repo are picked up instantly — no npm publish / reinstall round-trip.
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

for dir in "$packages_dir"/*/; do
	pkg_json="${dir}package.json"
	[ -f "$pkg_json" ] || continue

	name=$(node -p "require('${pkg_json}').name")
	# Strip the @xynogen/ scope to get the dir name under @xynogen.
	short="${name#@xynogen/}"
	dest="${TARGET_DIR}/${short}"

	if [ "$unlink" = true ]; then
		# Only restore entries we previously symlinked.
		if [ -L "$dest" ]; then
			rm "$dest"
			echo "↩ unlinked ${name} (run 'pi install npm:${name}' to restore the npm copy)"
			restored=$((restored + 1))
		fi
		continue
	fi

	# Remove the existing npm copy (or stale link) and point at the repo.
	rm -rf "$dest"
	ln -s "${dir%/}" "$dest"
	echo "→ linked ${name} → ${dir%/}"
	linked=$((linked + 1))
done

echo ""
if [ "$unlink" = true ]; then
	echo "Restored ${restored} package(s). Restart your Pi session to reload."
else
	echo "Linked ${linked} package(s). Restart your Pi session to reload."
fi
