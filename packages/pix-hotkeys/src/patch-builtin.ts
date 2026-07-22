/**
 * patch-builtin.ts — replace Pi's built-in /hotkeys command at load time.
 *
 * The built-in /hotkeys dumps a static markdown table into the chat scroll.
 * We swap it for an interactive, grouped, scrollable modal overlay. Built-in
 * commands can't be removed via the extension API, so we edit Pi's compiled
 * host files directly. Done on every load: idempotent and self-healing across
 * Pi upgrades, so no manual repatch is ever needed.
 *
 * Two edits (mirrors pix-models):
 *   1. Strip the `{ name: "hotkeys" }` entry from BUILTIN_SLASH_COMMANDS
 *      (slash-commands.js) so our extension command owns the name — no
 *      autocomplete duplicate, no host conflict diagnostic.
 *   2. Redirect the hardcoded `if (text === "/hotkeys")` submit intercept
 *      (interactive-mode.js) to (a) stash the host's extensionRunner +
 *      keybindings on globalThis so our overlay can read key displays and
 *      extension shortcuts, then (b) dispatch our `/hotkeys` command.
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

// Global key the host stash lands on; the overlay reads it back at command time.
export const HOTKEYS_STASH_KEY = "__pixHotkeys";

// Pi has added fields to this object over time. Match the command entry by its
// stable `name`, rather than an exact serialized line, while limiting the match
// to a single non-nested object.
const BUILTIN_COMMANDS_ARRAY = /export\s+const\s+BUILTIN_SLASH_COMMANDS[^=]*=\s*\[/;
const BUILTIN_HOTKEYS_COMMAND =
	/^[ \t]*\{(?=[^{}]*\bname\s*:\s*["']hotkeys["'])[^{}]*\},?[ \t]*(?:\r?\n|$)/gm;

// The host intercepts `/hotkeys` in the editor onSubmit handler with a hardcoded
// `this.handleHotkeysCommand()` call. We rewrite just that call to stash the
// host internals our overlay needs and dispatch our registered `/hotkeys`
// command. session.prompt("/hotkeys") runs the extension command directly
// (getCommand → handler), it does NOT re-enter this intercept, so no recursion.
const HOTKEYS_INTERCEPT_CALL = /this\.handleHotkeysCommand\(\);/;
const HOTKEYS_INTERCEPT_REPLACEMENT = `(globalThis.${HOTKEYS_STASH_KEY}={extensionRunner:this.session.extensionRunner,keybindings:this.keybindings},void this.session.prompt("/hotkeys"));`;

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
 * Patch Pi's compiled host so the enhanced overlay fully replaces the built-in:
 *   1. Remove the `/hotkeys` slash command (slash-commands.js).
 *   2. Redirect the `/hotkeys` submit intercept (interactive-mode.js) to stash
 *      host internals and run our `/hotkeys` command instead.
 * Idempotent and self-healing: safe to run on every load.
 */
export function patchOutBuiltinHotkeysCommand(): void {
	patchHostFile("core/slash-commands.js", stripBuiltinHotkeysCommand);
	patchHostFile("modes/interactive/interactive-mode.js", redirectHotkeysIntercept);
}

/**
 * Rewrite the host's hardcoded `/hotkeys` submit intercept to stash the host's
 * extensionRunner + keybindings on globalThis and dispatch our `/hotkeys`
 * command. Idempotent: the replaced form no longer contains
 * `this.handleHotkeysCommand()`, so a second pass is a no-op.
 */
export function redirectHotkeysIntercept(source: string): string {
	return source.replace(HOTKEYS_INTERCEPT_CALL, HOTKEYS_INTERCEPT_REPLACEMENT);
}

/**
 * Remove Pi's built-in `/hotkeys` entry from compiled slash-command source.
 *
 * The command objects are static, flat literals. Matching the entry's `name`
 * tolerates added properties and line wrapping without touching neighbors.
 */
export function stripBuiltinHotkeysCommand(source: string): string {
	const array = BUILTIN_COMMANDS_ARRAY.exec(source);
	if (!array || array.index === undefined) return source;

	const open = array.index + array[0].lastIndexOf("[");
	const close = source.indexOf("];", open);
	if (close < 0) return source;

	const entries = source.slice(open + 1, close);
	const patchedEntries = entries.replace(BUILTIN_HOTKEYS_COMMAND, "");
	if (patchedEntries === entries) return source;

	return `${source.slice(0, open + 1)}${patchedEntries}${source.slice(close)}`;
}

// Export for tests
export { candidatePaths, findHostFile };
