import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripBuiltinModelCommand, unreserveModelSelect } from "./patch-builtin.ts";

const RESERVED = `const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
    "app.thinking.cycle",
    "app.model.select",
    "app.tools.expand",
];
`;

const UNPATCHED = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model (opens selector UI)" },
    { name: "login", description: "Configure provider authentication" },
];
`;

const CURRENT_PI = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
    { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
];
`;

describe("patch-builtin /model removal", () => {
	it("removes the built-in /model line and keeps neighbors", () => {
		const out = stripBuiltinModelCommand(UNPATCHED);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("is idempotent — second pass is a no-op", () => {
		const once = stripBuiltinModelCommand(UNPATCHED);
		const twice = stripBuiltinModelCommand(once);
		expect(twice).toBe(once);
	});

	it("leaves an already-clean file untouched", () => {
		const clean = `export const X = [\n    { name: "login" },\n];\n`;
		expect(stripBuiltinModelCommand(clean)).toBe(clean);
	});

	it("does not strip the plural /models entry", () => {
		const withPlural = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "models", description: "Enhanced picker" },
    { name: "model", description: "Select model (opens selector UI)" },
];`;
		const out = stripBuiltinModelCommand(withPlural);
		expect(out).toContain('name: "models"');
		expect(out).not.toContain('{ name: "model", description');
	});

	it("removes Pi's current /model form with an argument hint", () => {
		const out = stripBuiltinModelCommand(CURRENT_PI);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "scoped-models"');
	});

	it("does not alter /model text outside the built-in command array", () => {
		const source = `const source = '{ name: "model" }';
export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
];
`;
		expect(stripBuiltinModelCommand(source)).toBe(source);
	});

	it("removes a multi-line /model command without touching adjacent entries", () => {
		const multiline = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    {
        name: "model",
        description: "Select model (opens selector UI)",
        argumentHint: "<provider/model>",
    },
    { name: "login", description: "Configure provider authentication" },
];
`;
		const out = stripBuiltinModelCommand(multiline);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "pix-patch-"));
		const file = join(dir, "slash-commands.js");
		writeFileSync(file, CURRENT_PI, "utf8");
		writeFileSync(file, stripBuiltinModelCommand(readFileSync(file, "utf8")), "utf8");
		expect(readFileSync(file, "utf8")).not.toContain('name: "model"');
	});
});

describe("patch-builtin app.model.select unreserve", () => {
	it("removes the reserved entry, keeps neighbors", () => {
		const out = unreserveModelSelect(RESERVED);
		expect(out).not.toContain("app.model.select");
		expect(out).toContain("app.thinking.cycle");
		expect(out).toContain("app.tools.expand");
	});

	it("is idempotent", () => {
		const once = unreserveModelSelect(RESERVED);
		expect(unreserveModelSelect(once)).toBe(once);
	});

	it("is a no-op when already absent", () => {
		const clean = `const X = [\n    "app.tools.expand",\n];\n`;
		expect(unreserveModelSelect(clean)).toBe(clean);
	});
});
