import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pure replacement tested in isolation (the exported fn resolves the host
// package, which isn't present in the test sandbox).
const MODEL_COMMAND_LINE =
	'{ name: "model", description: "Select model (opens selector UI)" },';

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchSource(source: string): string {
	if (!source.includes(MODEL_COMMAND_LINE)) return source;
	return source.replace(
		new RegExp(`[ \\t]*${escapeRegExp(MODEL_COMMAND_LINE)}\\n?`),
		"",
	);
}

const UNPATCHED = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model (opens selector UI)" },
    { name: "login", description: "Configure provider authentication" },
];
`;

describe("patch-builtin /model removal", () => {
	it("removes the built-in /model line and keeps neighbors", () => {
		const out = patchSource(UNPATCHED);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("is idempotent — second pass is a no-op", () => {
		const once = patchSource(UNPATCHED);
		const twice = patchSource(once);
		expect(twice).toBe(once);
	});

	it("leaves an already-clean file untouched", () => {
		const clean = `export const X = [\n    { name: "login" },\n];\n`;
		expect(patchSource(clean)).toBe(clean);
	});

	it("does not strip the plural /models entry", () => {
		const withPlural = `[
    { name: "models", description: "Enhanced picker" },
    { name: "model", description: "Select model (opens selector UI)" },
]`;
		const out = patchSource(withPlural);
		expect(out).toContain('name: "models"');
		expect(out).not.toContain('{ name: "model", description');
	});

	it("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "pix-patch-"));
		const file = join(dir, "slash-commands.js");
		writeFileSync(file, UNPATCHED, "utf8");
		writeFileSync(file, patchSource(readFileSync(file, "utf8")), "utf8");
		expect(readFileSync(file, "utf8")).not.toContain('name: "model"');
	});
});
