/**
 * patch-builtin.ts — strip Pi's built-in /model slash command at load time.
 *
 * Built-in commands can't be removed via the extension API, so we edit Pi's
 * compiled slash-commands.js directly. Done on every load: idempotent and
 * self-healing across Pi upgrades, so no manual repatch is ever needed.
 *
 * Resolution strategy (in order):
 *   1. Locate the `pi` binary via PATH → infer package root from its realpath.
 *      The binary is always at <pkg>/dist/cli.js so ../../ is the package root.
 *   2. Probe well-known global install locations (bun, npm).
 *   3. Fall back to createRequire against the extension's own node_modules
 *      (works when pi and the extension share the same install tree).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MODEL_COMMAND_LINE = '{ name: "model", description: "Select model (opens selector UI)" },';

/** Candidate slash-commands.js paths, most-specific first. */
function candidatePaths(): string[] {
	const paths: string[] = [];

	// 1. Resolve via the running `pi` binary → its realpath gives the dist dir.
	try {
		const piReal = execSync("realpath $(which pi)", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (piReal) {
			// piReal = /.../pi-coding-agent/dist/cli.js → dist/ → ../dist/core/
			const distCore = resolve(dirname(piReal), "core");
			paths.push(join(distCore, "slash-commands.js"));
		}
	} catch {
		// `pi` not on PATH or `which`/`realpath` unavailable — skip
	}

	// 2. Well-known global install locations.
	const home = homedir();
	const globalRoots = [
		join(home, ".bun", "install", "global", "node_modules"),
		join(home, ".npm-global", "lib", "node_modules"),
		"/usr/local/lib/node_modules",
		"/usr/lib/node_modules",
	];
	for (const root of globalRoots) {
		paths.push(
			join(root, "@earendil-works", "pi-coding-agent", "dist", "core", "slash-commands.js"),
		);
	}

	// 3. Fallback: createRequire from this file (works when extension is co-installed).
	try {
		const require = createRequire(import.meta.url);
		const entry = require.resolve("@earendil-works/pi-coding-agent");
		paths.push(resolve(dirname(entry), "core", "slash-commands.js"));
	} catch {
		// local resolution failed — skip
	}

	return paths;
}

/** Locate the host's compiled slash-commands.js, or null if not found. */
function findSlashCommandsFile(): string | null {
	for (const p of candidatePaths()) {
		if (existsSync(p)) return p;
	}
	return null;
}

/**
 * Remove the built-in /model command line from Pi's slash-commands.js.
 * Idempotent: returns silently if the file is missing or already patched.
 */
export function patchOutBuiltinModelCommand(): void {
	const file = findSlashCommandsFile();
	if (!file) return;

	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return;
	}

	if (!source.includes(MODEL_COMMAND_LINE)) return; // already patched

	const patched = source.replace(new RegExp(`[ \\t]*${escapeRegExp(MODEL_COMMAND_LINE)}\\n?`), "");
	if (patched === source) return;

	try {
		writeFileSync(file, patched, "utf8");
	} catch {
		// Read-only install — leave /model in place rather than crash.
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Export for tests
export { candidatePaths, findSlashCommandsFile };
