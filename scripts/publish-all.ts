#!/usr/bin/env bun
/**
 * publish-all.ts — parallel publish for all workspace packages.
 *
 * 1. Reads every packages/*\/package.json
 * 2. Checks the npm registry for all packages in parallel
 * 3. Publishes unpublished ones with configurable concurrency
 *
 * Usage:
 *   bun scripts/publish-all.ts          # publish
 *   bun scripts/publish-all.ts --dry-run # dry run (no actual publish)
 *   PUBLISH_CONCURRENCY=4 bun scripts/publish-all.ts
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const CONCURRENCY = Number(process.env.PUBLISH_CONCURRENCY ?? "6");
const DRY_RUN = process.argv.includes("--dry-run");
const PUBLISH_FLAGS = ["--access", "public"];
if (DRY_RUN) PUBLISH_FLAGS.push("--dry-run");
if (process.env.NPM_CONFIG_PROVENANCE === "true") {
	PUBLISH_FLAGS.push("--provenance");
}

// ── Collect packages ──────────────────────────────────────────────────────────

interface PkgInfo {
	dir: string;
	name: string;
	version: string;
}

const packagesDir = join(import.meta.dir, "..", "packages");
const pkgs: PkgInfo[] = [];

for (const entry of readdirSync(packagesDir)) {
	const pkgJson = join(packagesDir, entry, "package.json");
	if (!existsSync(pkgJson)) continue;
	const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
	if (pkg.private) continue;
	if (!pkg.name || !pkg.version) continue;
	pkgs.push({ dir: join(packagesDir, entry), name: pkg.name, version: pkg.version });
}

// ── Pre-flight: reject workspace: protocol in any dependency ──────────────────

let hasWorkspaceProtocol = false;
for (const { dir, name } of pkgs) {
	const raw = readFileSync(join(dir, "package.json"), "utf8");
	if (raw.includes('"workspace:')) {
		console.error(`✖ ${name}: package.json contains workspace: protocol — replace with a semver range before publishing.`);
		hasWorkspaceProtocol = true;
	}
}
if (hasWorkspaceProtocol) {
	console.error("\nAborted. Fix workspace: references and retry.");
	process.exit(1);
}

if (DRY_RUN) console.log("[dry-run mode]");
console.log(`Found ${pkgs.length} publishable packages. Checking registry...`);

// ── Parallel registry check ───────────────────────────────────────────────────

const published = await Promise.all(
	pkgs.map(async ({ name, version }) => {
		try {
			const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
			return res.ok;
		} catch {
			return false;
		}
	}),
);

const toPublish = pkgs.filter((_, i) => !published[i]);
const toSkip = pkgs.filter((_, i) => published[i]);

for (const { name, version } of toSkip) {
	console.log(`↷ skip (already published): ${name}@${version}`);
}

if (toPublish.length === 0) {
	console.log("\nAll packages up-to-date. Nothing to publish.");
	process.exit(0);
}

console.log(`\nPublishing ${toPublish.length} package(s) with concurrency=${CONCURRENCY}...`);

// ── Concurrent publish ────────────────────────────────────────────────────────

let publishedCount = 0;
let failedCount = 0;

async function publishOne(pkg: PkgInfo): Promise<void> {
	const { dir, name, version } = pkg;
	try {
		const result = await $`npm publish ${PUBLISH_FLAGS}`.cwd(dir).quiet();
		if (DRY_RUN) console.log(result.stdout.toString());
		console.log(`${DRY_RUN ? "✔ (dry-run) would publish" : "✔ published"} ${name}@${version}`);
		publishedCount++;
	} catch (e) {
		const err = e as { stderr?: Buffer | string; stdout?: Buffer | string };
		const out = (err.stderr?.toString() ?? "") + (err.stdout?.toString() ?? "");
		if (out.includes("cannot publish over") || out.includes("EPUBLISHCONFLICT")) {
			console.log(`↷ skip (race): ${name}@${version}`);
			return;
		}
		if (out.includes("EOTP") || out.includes("one-time password") || out.includes("E401") || out.includes("Unauthorized")) {
			console.error(`\n✖ Auth error: npm requires an automation token to publish with 2FA enabled.`);
			console.error(`\nCreate one at: https://www.npmjs.com/settings/dihak/tokens`);
			console.error(`  1. Generate New Token → Granular Access Token (or Classic → Automation)`);
			console.error(`  2. Set it:  npm set //registry.npmjs.org/:_authToken YOUR_TOKEN`);
			console.error(`  3. Re-run:  bun run publish:all\n`);
			process.exit(1);
		}
		console.error(`✖ failed ${name}@${version}`);
		console.error(out);
		failedCount++;
	}
}

// Run in batches of CONCURRENCY
for (let i = 0; i < toPublish.length; i += CONCURRENCY) {
	const batch = toPublish.slice(i, i + CONCURRENCY);
	await Promise.all(batch.map(publishOne));
}

console.log(`\n${DRY_RUN ? "[dry-run] " : ""}Publish summary: ${publishedCount} ${DRY_RUN ? "would publish" : "published"}, ${toSkip.length} skipped, ${failedCount} failed.`);
if (failedCount > 0) process.exit(1);
