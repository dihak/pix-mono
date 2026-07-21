#!/usr/bin/env bun
/**
 * check-versions.ts — pre-publish guard: verifies at least one package
 * has a version not yet on npm. `publish-all.ts` skips versions already
 * published, so unchanged packages must not block a release.
 *
 * Exit 0 = at least one package is ready to publish.
 * Exit 1 = every package version is already published.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packagesDir = join(import.meta.dir, "..", "packages");

interface PkgJson {
	name: string;
	version: string;
	private?: boolean;
}

// ── Collect publishable packages ──────────────────────────────────────────────

const pkgs: { name: string; dir: string; version: string }[] = [];
for (const entry of readdirSync(packagesDir)) {
	const pkgPath = join(packagesDir, entry, "package.json");
	if (!existsSync(pkgPath)) continue;
	const pkg: PkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
	if (pkg.private || !pkg.name || !pkg.version) continue;
	pkgs.push({ name: pkg.name, dir: entry, version: pkg.version });
}

// ponytail: Registry state is publish source of truth; publish-all applies same rule.
console.log(`Checking ${pkgs.length} package version(s) against npm...`);

// ── Check npm registry in parallel ────────────────────────────────────────────

const results = await Promise.all(
	pkgs.map(async ({ name, version }) => {
		try {
			const res = await fetch(
				`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
				{ signal: AbortSignal.timeout(10_000) },
			);
			return { name, version, exists: res.ok };
		} catch {
			// Network error — can't verify, let publish-all handle it.
			return { name, version, exists: false };
		}
	}),
);

const published = results.filter((r) => r.exists);
const fresh = results.filter((r) => !r.exists);

for (const r of fresh) {
	console.log(`  ✔ ${r.name}@${r.version} — ready to publish`);
}

if (fresh.length === 0) {
	console.error("\nNo unpublished package versions found. Bump changed package versions first.");
	process.exit(1);
}

console.log(`\n${fresh.length} package(s) ready; ${published.length} already published.`);
