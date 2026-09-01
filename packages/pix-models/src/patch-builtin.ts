/**
 * patch-builtin.ts — replace Pi's built-in /model command at load time.
 *
 * Built-in commands can't be removed via the extension API, so we edit Pi's
 * compiled host files directly. Done on every load: idempotent and self-healing
 * across Pi upgrades, so no manual repatch is ever needed.
 *
 * Three edits:
 *   1. Strip the `{ name: "model" }` entry from BUILTIN_SLASH_COMMANDS so our
 *      `/models` command is the one in autocomplete (no host conflict
 *      diagnostic, no duplicate).
 *   2. Redirect `app.model.select` (default ctrl+l) from the stock
 *      `showModelSelector()` to `session.prompt("/models")`.
 *   3. Redirect the hardcoded `/model` submit intercept
 *      (`handleModelCommand`) to the same `/models` command.
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

// Pretty (`export const BUILTIN_SLASH_COMMANDS = [`) and bundled
// (`var BUILTIN_SLASH_COMMANDS=[`).
const BUILTIN_COMMANDS_ARRAY =
	/(?:export\s+const|var|const|let)\s+BUILTIN_SLASH_COMMANDS[^=]*=\s*\[/;

// Flat command object, pretty or minified. `name: "model"` must not match
// `name: "models"` / `scoped-models` — the closing quote sits immediately
// after `model`. No start-of-line anchor so a single-line bundle still matches.
const BUILTIN_MODEL_COMMAND = /\{(?=[^{}]*\bname\s*:\s*["']model["'])[^{}]*\},?/g;

// Pretty: onAction("app.model.select", () => this.showModelSelector());
// Bundled: onAction("app.model.select",()=>this.showModelSelector()),
const MODEL_SELECT_ACTION =
	/(this\.defaultEditor\.onAction\("app\.model\.select",\s*\(\)\s*=>\s*)this\.showModelSelector\(\)/;

// Pretty and bundled intercept both call `this.handleModelCommand(searchTerm)`.
// The method definition is `async handleModelCommand(searchTerm){` — no `this.`
// — so this pattern only hits the call site.
const MODEL_COMMAND_CALL = /this\.handleModelCommand\(searchTerm\)/;
const MODEL_COMMAND_REPLACEMENT = 'this.session.prompt("/models")';

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
	return (
		source.includes("BUILTIN_SLASH_COMMANDS") ||
		source.includes("showModelSelector") ||
		source.includes("handleModelCommand")
	);
}

/** Apply an idempotent transform to one file. No-op if unchanged or unreadable. */
function patchFile(file: string, transform: (src: string) => string): void {
	let source: string;
	try {
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
 * Patch Pi's compiled host so the enhanced picker fully replaces the built-in:
 *   1. Remove the `/model` slash command from BUILTIN_SLASH_COMMANDS.
 *   2. Redirect `app.model.select` (default ctrl+l) to `/models`.
 *   3. Redirect the `/model` submit intercept to `/models`.
 * Idempotent and self-healing: safe to run on every load.
 */
export function patchOutBuiltinModelCommand(): void {
	const transform = (src: string) =>
		redirectModelCommandIntercept(redirectModelSelectAction(stripBuiltinModelCommand(src)));
	for (const file of collectHostFiles()) patchFile(file, transform);
}

/**
 * Rewrite the host's `app.model.select` editor action to run `/models` (our
 * enhanced picker) instead of `showModelSelector()` (the stock selector).
 * The key and any user remap keep working; no extension shortcut is registered,
 * so the host emits no conflict diagnostic. Idempotent: the replaced form no
 * longer contains `showModelSelector()`, so a second pass is a no-op.
 */
export function redirectModelSelectAction(source: string): string {
	return source.replace(MODEL_SELECT_ACTION, '$1this.session.prompt("/models")');
}

/**
 * Rewrite the host's hardcoded `/model` submit intercept to dispatch our
 * `/models` command. Idempotent: the replaced form no longer contains
 * `this.handleModelCommand(searchTerm)`.
 */
export function redirectModelCommandIntercept(source: string): string {
	return source.replace(MODEL_COMMAND_CALL, MODEL_COMMAND_REPLACEMENT);
}

/**
 * Remove Pi's built-in `/model` entry from compiled slash-command source.
 *
 * The command objects are static, flat literals. Matching the entry's `name`
 * tolerates added properties, line wrapping, and minified `{name:"model"}`,
 * without touching `/models`.
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
export { candidatePaths, collectHostFiles, distDirFromPiBin, findHostFile };
