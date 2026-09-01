/**
 * patch-builtin.ts — replace Pi's built-in /hotkeys command at load time.
 *
 * The built-in /hotkeys dumps a static markdown table into the chat scroll.
 * We swap it for an interactive, grouped, scrollable modal overlay. Built-in
 * commands can't be removed via the extension API, so we edit Pi's compiled
 * host files directly. Done on every load: idempotent and self-healing across
 * Pi upgrades, so no manual repatch is ever needed.
 *
 * Two edits:
 *   1. Strip the `{ name: "hotkeys" }` entry from BUILTIN_SLASH_COMMANDS so
 *      our extension command owns the name — no autocomplete duplicate, no
 *      host conflict diagnostic.
 *   2. Redirect the hardcoded `this.handleHotkeysCommand()` submit intercept
 *      to (a) stash the host's extensionRunner + keybindings on globalThis so
 *      our overlay can read key displays and extension shortcuts, then (b)
 *      dispatch our `/hotkeys` command.
 *
 * Live `pi` (v0.84+) is `dist/bundle/cli.js`, not the unbundled
 * `dist/cli.js` / `dist/core/slash-commands.js` tree. We patch both: the
 * unbundled files (older installs / source checkouts) and every
 * `dist/bundle/chunks/*.js` file (the process that actually runs). Transforms
 * accept pretty and minified host output.
 *
 * Resolution strategy (in order):
 *   1. Locate the `pi` binary via PATH → walk up from its realpath to `dist/`.
 *   2. Probe well-known global install locations (bun, npm).
 *   3. Fall back to createRequire against the extension's own node_modules
 *      (works when pi and the extension share the same install tree).
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Global key the host stash lands on; the overlay reads it back at command time.
export const HOTKEYS_STASH_KEY = "__pixHotkeys";

// Pretty (`export const BUILTIN_SLASH_COMMANDS = [`) and bundled
// (`var BUILTIN_SLASH_COMMANDS=[`).
const BUILTIN_COMMANDS_ARRAY =
	/(?:export\s+const|var|const|let)\s+BUILTIN_SLASH_COMMANDS[^=]*=\s*\[/;

// Flat command object, pretty or minified. `name` is the stable field; extra
// properties (argumentHint, wrapping) are tolerated. No start-of-line anchor
// so `{name:"hotkeys",...},` in a single-line bundle still matches.
const BUILTIN_HOTKEYS_COMMAND = /\{(?=[^{}]*\bname\s*:\s*["']hotkeys["'])[^{}]*\},?/g;

// The host intercepts `/hotkeys` in the editor onSubmit handler with a
// hardcoded `this.handleHotkeysCommand()` call. Pretty source has a trailing
// semicolon; the bundle uses the comma operator and omits it. Do not require
// `;`, and do not match the method definition (`handleHotkeysCommand(){`).
// session.prompt("/hotkeys") runs the extension command directly (getCommand →
// handler) and does NOT re-enter this intercept, so no recursion.
const HOTKEYS_INTERCEPT_CALL = /this\.handleHotkeysCommand\(\);?/;
const HOTKEYS_INTERCEPT_REPLACEMENT = `(globalThis.${HOTKEYS_STASH_KEY}={extensionRunner:this.session.extensionRunner,keybindings:this.keybindings},void this.session.prompt("/hotkeys"))`;

const UNBUNDLED_RELS = ["core/slash-commands.js", "modes/interactive/interactive-mode.js"];

/**
 * `pi` bin is `dist/bundle/cli.js` (current) or `dist/cli.js` (older).
 * Always return the package `dist/` directory.
 */
function distDirFromPiBin(piReal: string): string {
	let dir = dirname(piReal);
	if (basename(dir) === "bundle") dir = dirname(dir);
	return dir;
}

/** Candidate package `dist/` roots, most-specific first. */
function hostDistRoots(): string[] {
	const roots: string[] = [];
	const seen = new Set<string>();
	const add = (p: string) => {
		if (!p || seen.has(p) || !existsSync(p)) return;
		seen.add(p);
		roots.push(p);
	};

	try {
		const piReal = execSync("realpath $(which pi)", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (piReal) add(distDirFromPiBin(piReal));
	} catch {
		// `pi` not on PATH or `which`/`realpath` unavailable — skip
	}

	const home = homedir();
	for (const root of [
		join(home, ".bun", "install", "global", "node_modules"),
		join(home, ".npm-global", "lib", "node_modules"),
		"/usr/local/lib/node_modules",
		"/usr/lib/node_modules",
	]) {
		add(join(root, "@earendil-works", "pi-coding-agent", "dist"));
	}

	try {
		const require = createRequire(import.meta.url);
		const entry = require.resolve("@earendil-works/pi-coding-agent");
		add(dirname(entry));
	} catch {
		// local resolution failed — skip
	}

	return roots;
}

/**
 * Every compiled host file we may need to edit: unbundled modules plus the
 * live bundle chunks. Chunk hashes change per Pi release, so we scan
 * `bundle/chunks/*.js` rather than hardcoding a filename.
 */
function collectHostFiles(): string[] {
	const files: string[] = [];
	const seen = new Set<string>();
	const add = (p: string) => {
		if (seen.has(p) || !existsSync(p)) return;
		seen.add(p);
		files.push(p);
	};

	for (const dist of hostDistRoots()) {
		for (const rel of UNBUNDLED_RELS) add(join(dist, rel));
		add(join(dist, "bundle", "cli.js"));
		const chunksDir = join(dist, "bundle", "chunks");
		if (!existsSync(chunksDir)) continue;
		let names: string[] = [];
		try {
			names = readdirSync(chunksDir);
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".js")) continue;
			add(join(chunksDir, name));
		}
	}

	return files;
}

/** Candidate paths for a host dist file, most-specific first. */
function candidatePaths(rel: string): string[] {
	return hostDistRoots().map((dist) => join(dist, ...rel.split("/")));
}

/** Locate a host dist file by its dist-relative path, or null if not found. */
function findHostFile(rel: string): string | null {
	for (const p of candidatePaths(rel)) {
		if (existsSync(p)) return p;
	}
	return null;
}

function fileLooksRelevant(source: string): boolean {
	return source.includes("BUILTIN_SLASH_COMMANDS") || source.includes("handleHotkeysCommand");
}

/** Apply an idempotent transform to one file. No-op if unchanged or unreadable. */
function patchFile(file: string, transform: (src: string) => string): void {
	let source: string;
	try {
		// Skip tiny provider/helper chunks without reading them fully.
		if (statSync(file).size < 64) return;
		source = readFileSync(file, "utf8");
	} catch {
		return;
	}
	if (!fileLooksRelevant(source)) return;
	const patched = transform(source);
	if (patched === source) return;
	try {
		writeFileSync(file, patched, "utf8");
	} catch {
		// Read-only install — leave the host untouched rather than crash.
	}
}

/**
 * Patch Pi's compiled host so the enhanced overlay fully replaces the built-in:
 *   1. Remove the `/hotkeys` slash command from BUILTIN_SLASH_COMMANDS.
 *   2. Redirect the `/hotkeys` submit intercept to stash host internals and
 *      run our `/hotkeys` command instead.
 * Idempotent and self-healing: safe to run on every load.
 */
export function patchOutBuiltinHotkeysCommand(): void {
	const transform = (src: string) => redirectHotkeysIntercept(stripBuiltinHotkeysCommand(src));
	for (const file of collectHostFiles()) patchFile(file, transform);
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
 * tolerates added properties, line wrapping, and minified `{name:"hotkeys"}`.
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
export { candidatePaths, collectHostFiles, distDirFromPiBin, findHostFile };
