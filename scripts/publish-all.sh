#!/usr/bin/env bash
#
# Publish every workspace package whose local version is not yet on npm.
#
# `npm publish` hard-fails (EPUBLISHCONFLICT / 403) when the version already
# exists, so we check the registry first and skip packages that are already
# published at their current version. This makes a "publish all" run safe and
# idempotent: only packages bumped since the last release actually publish.
#
# Authentication: in CI this relies on npm trusted publishing (OIDC) — no
# token needed. The npm CLI auto-detects the OIDC environment. When OIDC is
# present we also attach a provenance statement.
set -euo pipefail

# Provenance is controlled by the NPM_CONFIG_PROVENANCE env var, set by the
# publish workflow when running under OIDC. Locally it is unset, so token-based
# publishes still work.
publish_flags="--access public"

published=0
skipped=0
failed=0

for dir in packages/*/; do
	pkg_json="${dir}package.json"
	[ -f "$pkg_json" ] || continue

	# Skip packages explicitly marked private.
	is_private=$(node -p "require('./${pkg_json}').private === true" 2>/dev/null || echo "false")
	if [ "$is_private" = "true" ]; then
		echo "↷ skip (private): ${dir}"
		skipped=$((skipped + 1))
		continue
	fi

	name=$(node -p "require('./${pkg_json}').name")
	version=$(node -p "require('./${pkg_json}').version")

	# Does this exact version already exist on the registry?
	if npm view "${name}@${version}" version >/dev/null 2>&1; then
		echo "↷ skip (already published): ${name}@${version}"
		skipped=$((skipped + 1))
		continue
	fi

	echo "→ publishing ${name}@${version}"
	if (cd "$dir" && npm publish $publish_flags); then
		published=$((published + 1))
	else
		echo "✖ failed to publish ${name}@${version}"
		failed=$((failed + 1))
	fi
done

echo ""
echo "Publish summary: ${published} published, ${skipped} skipped, ${failed} failed."

# Fail the job if any publish attempt errored.
[ "$failed" -eq 0 ]
