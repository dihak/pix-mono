import { describe, expect, it } from "bun:test";
import {
	HOTKEYS_STASH_KEY,
	redirectHotkeysIntercept,
	stripBuiltinHotkeysCommand,
} from "./patch-builtin.ts";

const UNPATCHED = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "hotkeys", description: "Show all keyboard shortcuts" },
    { name: "login", description: "Configure provider authentication" },
];
`;

const CURRENT_PI = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "changelog", description: "Show changelog" },
    { name: "hotkeys", description: "Show all keyboard shortcuts", argumentHint: "<x>" },
    { name: "reload", description: "Reload keybindings" },
];
`;

const INTERCEPT = `            if (text === "/hotkeys") {
                this.handleHotkeysCommand();
                this.editor.setText("");
                return;
            }
`;

describe("patch-builtin /hotkeys removal", () => {
	it("removes the built-in /hotkeys line and keeps neighbors", () => {
		const out = stripBuiltinHotkeysCommand(UNPATCHED);
		expect(out).not.toContain('name: "hotkeys"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("tolerates added properties (argumentHint) and other neighbors", () => {
		const out = stripBuiltinHotkeysCommand(CURRENT_PI);
		expect(out).not.toContain('name: "hotkeys"');
		expect(out).toContain('name: "changelog"');
		expect(out).toContain('name: "reload"');
	});

	it("is idempotent — second pass is a no-op", () => {
		const once = stripBuiltinHotkeysCommand(UNPATCHED);
		const twice = stripBuiltinHotkeysCommand(once);
		expect(twice).toBe(once);
	});

	it("leaves an already-clean file untouched", () => {
		const clean = `export const X = [\n    { name: "login" },\n];\n`;
		expect(stripBuiltinHotkeysCommand(clean)).toBe(clean);
	});
});

describe("patch-builtin /hotkeys intercept redirect", () => {
	it("replaces the hardcoded call with a stash + prompt dispatch", () => {
		const out = redirectHotkeysIntercept(INTERCEPT);
		expect(out).not.toContain("this.handleHotkeysCommand();");
		expect(out).toContain(`globalThis.${HOTKEYS_STASH_KEY}`);
		expect(out).toContain("this.session.extensionRunner");
		expect(out).toContain("this.keybindings");
		expect(out).toContain('this.session.prompt("/hotkeys")');
		// Surrounding lines survive.
		expect(out).toContain('this.editor.setText("");');
	});

	it("is idempotent — second pass is a no-op", () => {
		const once = redirectHotkeysIntercept(INTERCEPT);
		const twice = redirectHotkeysIntercept(once);
		expect(twice).toBe(once);
	});

	it("leaves source without the intercept untouched", () => {
		const src = `if (text === "/other") { this.foo(); }`;
		expect(redirectHotkeysIntercept(src)).toBe(src);
	});
});
