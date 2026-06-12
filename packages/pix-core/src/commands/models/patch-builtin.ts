/**
 * patch-builtin.ts — strip Pi's built-in /model slash command at load time.
 *
 * Built-in commands can't be removed via the extension API, so we edit Pi's
 * compiled slash-commands.js directly. Done on every load: idempotent and
 * self-healing across Pi upgrades, so no manual repatch is ever needed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const HOST_PACKAGE = "@earendil-works/pi-coding-agent";
const MODEL_COMMAND_LINE =
	'{ name: "model", description: "Select model (opens selector UI)" },';

/** Locate the host's compiled slash-commands.js, or null if it can't be found. */
function findSlashCommandsFile(): string | null {
	try {
		const require = createRequire(import.meta.url);
		const entry = require.resolve(HOST_PACKAGE);
		return resolve(dirname(entry), "core", "slash-commands.js");
	} catch {
		return null;
	}
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
		return; // file not present (different Pi layout) — nothing to do
	}

	if (!source.includes(MODEL_COMMAND_LINE)) return; // already patched

	const patched = source.replace(
		new RegExp(`[ \\t]*${escapeRegExp(MODEL_COMMAND_LINE)}\\n?`),
		"",
	);
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
