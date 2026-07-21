/**
 * deps.test.ts — repo-wide dependency hygiene checks.
 *
 * Guards against workspace:* protocol and bare "*" ranges leaking
 * into published package.json files (see #2, #4).
 * Also verifies pix-core dependency pins stay in sync with each
 * package's actual version.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const packagesDir = join(import.meta.dir, "..", "packages");

interface PkgJson {
	name: string;
	version: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

const DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
] as const;

// Collect all publishable packages
const pkgs: { name: string; dir: string; pkg: PkgJson }[] = [];
for (const entry of readdirSync(packagesDir)) {
	const pkgPath = join(packagesDir, entry, "package.json");
	if (!existsSync(pkgPath)) continue;
	const pkg: PkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
	if (pkg.private) continue;
	pkgs.push({ name: pkg.name, dir: entry, pkg });
}

describe("dependency hygiene", () => {
	test("no workspace: protocol in any published package", () => {
		const violations: string[] = [];
		for (const { name, pkg } of pkgs) {
			for (const field of DEP_FIELDS) {
				const deps = pkg[field];
				if (!deps) continue;
				for (const [dep, range] of Object.entries(deps)) {
					if (range.startsWith("workspace:")) {
						violations.push(`${name} → ${field}.${dep}: "${range}"`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("no bare * ranges for @dihak/ deps in any published package", () => {
		const violations: string[] = [];
		for (const { name, pkg } of pkgs) {
			for (const field of DEP_FIELDS) {
				const deps = pkg[field];
				if (!deps) continue;
				for (const [dep, range] of Object.entries(deps)) {
					if (dep.startsWith("@dihak/") && range === "*") {
						violations.push(`${name} → ${field}.${dep}: "*"`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("all @dihak/ deps use caret ranges", () => {
		const violations: string[] = [];
		for (const { name, pkg } of pkgs) {
			for (const field of DEP_FIELDS) {
				const deps = pkg[field];
				if (!deps) continue;
				for (const [dep, range] of Object.entries(deps)) {
					if (dep.startsWith("@dihak/") && !range.startsWith("^")) {
						violations.push(`${name} → ${field}.${dep}: "${range}" (expected ^x.y.z)`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("pix-core dependency pins match each package's actual version", () => {
		const corePkg = pkgs.find((p) => p.name === "@dihak/pix-core");
		if (!corePkg) throw new Error("pix-core not found in packages/");
		const coreDeps = corePkg.pkg.dependencies ?? {};
		const violations: string[] = [];

		for (const [dep, range] of Object.entries(coreDeps)) {
			if (!dep.startsWith("@dihak/")) continue;
			const pkgName = dep.replace("@dihak/", "");
			const target = pkgs.find((p) => p.dir === pkgName);
			if (!target) {
				violations.push(`${dep}: package not found in packages/`);
				continue;
			}
			const pinBase = range.replace(/^[\^~>=<]*/, "");
			if (pinBase !== target.pkg.version) {
				violations.push(
					`${dep}: pix-core pins ${range} (base ${pinBase}) but actual is ${target.pkg.version}`,
				);
			}
		}

		expect(violations).toEqual([]);
	});
});
