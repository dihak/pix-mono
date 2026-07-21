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

// Pi has added fields to this object over time (for example, `argumentHint` in
// v0.80). Match the command entry by its stable `name`, rather than an exact
// serialized line, while limiting the match to a single non-nested object.
const BUILTIN_COMMANDS_ARRAY = /export\s+const\s+BUILTIN_SLASH_COMMANDS[^=]*=\s*\[/;
const BUILTIN_MODEL_COMMAND =
	/^[ \t]*\{(?=[^{}]*\bname\s*:\s*["']model["'])[^{}]*\},?[ \t]*(?:\r?\n|$)/gm;

// The host binds `app.model.select` (default ctrl+l) to its own stock model
// selector via an editor action. We rewrite that action to run our `/models`
// command instead. This keeps the key (and any user remap) working, avoids
// registering an extension shortcut on a built-in key (which would trigger the
// host's conflict diagnostic), and leaves other actions on that key untouched.
// session.prompt("/models") dispatches our registered command handler.
const MODEL_SELECT_ACTION =
	/(this\.defaultEditor\.onAction\("app\.model\.select",\s*\(\)\s*=>\s*)this\.showModelSelector\(\)(\);)/;

/**
 * Candidate paths for a host dist file, most-specific first.
 * `rel` is relative to the host's `dist/` dir, e.g. "core/slash-commands.js".
 */
function candidatePaths(rel: string): string[] {
	const segs = rel.split("/");
	const paths: string[] = [];

	// 1. Resolve via the running `pi` binary → its realpath gives the dist dir.
	try {
		const piReal = execSync("realpath $(which pi)", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (piReal) {
			// piReal = /.../pi-coding-agent/dist/cli.js → dist/
			const dist = dirname(piReal);
			paths.push(join(dist, ...segs));
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
		paths.push(join(root, "@earendil-works", "pi-coding-agent", "dist", ...segs));
	}

	// 3. Fallback: createRequire from this file (works when extension is co-installed).
	try {
		const require = createRequire(import.meta.url);
		const entry = require.resolve("@earendil-works/pi-coding-agent");
		paths.push(resolve(dirname(entry), ...segs));
	} catch {
		// local resolution failed — skip
	}

	return paths;
}

/** Locate a host dist file by its dist-relative path, or null if not found. */
function findHostFile(rel: string): string | null {
	for (const p of candidatePaths(rel)) {
		if (existsSync(p)) return p;
	}
	return null;
}

/** Apply an idempotent transform to a host dist file. No-op if unchanged. */
function patchHostFile(rel: string, transform: (src: string) => string): void {
	const file = findHostFile(rel);
	if (!file) return;
	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return;
	}
	const patched = transform(source);
	if (patched === source) return; // already patched, or host format is unknown
	try {
		writeFileSync(file, patched, "utf8");
	} catch {
		// Read-only install — leave the host untouched rather than crash.
	}
}

/**
 * Patch Pi's compiled host so the enhanced picker fully replaces the built-in:
 *   1. Remove the `/model` slash command (slash-commands.js).
 *   2. Redirect the `app.model.select` action (default ctrl+l) to run our
 *      `/models` command instead of the stock selector (interactive-mode.js).
 * Idempotent and self-healing: safe to run on every load.
 */
export function patchOutBuiltinModelCommand(): void {
	patchHostFile("core/slash-commands.js", stripBuiltinModelCommand);
	patchHostFile("modes/interactive/interactive-mode.js", redirectModelSelectAction);
}

/**
 * Rewrite the host's `app.model.select` editor action to run `/models` (our
 * enhanced picker) instead of `showModelSelector()` (the stock selector).
 * The key and any user remap keep working; no extension shortcut is registered,
 * so the host emits no conflict diagnostic. Idempotent: the replaced form no
 * longer contains `showModelSelector()`, so a second pass is a no-op.
 */
export function redirectModelSelectAction(source: string): string {
	return source.replace(MODEL_SELECT_ACTION, '$1this.session.prompt("/models")$2');
}

/**
 * Remove Pi's built-in `/model` entry from compiled slash-command source.
 *
 * The command objects are static, flat literals. Matching the entry's `name`
 * tolerates added properties and line wrapping without touching `/models`.
 */
export function stripBuiltinModelCommand(source: string): string {
	const array = BUILTIN_COMMANDS_ARRAY.exec(source);
	if (!array || array.index === undefined) return source;

	const open = array.index + array[0].lastIndexOf("[");
	const close = source.indexOf("];", open);
	if (close < 0) return source;

	const entries = source.slice(open + 1, close);
	const patchedEntries = entries.replace(BUILTIN_MODEL_COMMAND, "");
	if (patchedEntries === entries) return source;

	return `${source.slice(0, open + 1)}${patchedEntries}${source.slice(close)}`;
}

// Export for tests
export { candidatePaths, findHostFile };
