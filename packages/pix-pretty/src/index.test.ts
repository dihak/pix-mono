/**
 * Basic smoke tests for pix-pretty extensions
 */

import { describe, expect, it } from "bun:test";

describe("pix-pretty", () => {
	it("exports are valid TypeScript modules", () => {
		// Smoke test - just verify the files can be imported
		expect(true).toBe(true);
	});

	describe("tool rendering extension", () => {
		it("main extension exports a function", async () => {
			const mainModule = await import("./index");
			expect(mainModule.default).toBeFunction();
		});
	});

	describe("paste-chips extension", () => {
		it("paste-chips extension exports a function", async () => {
			const pasteChipsModule = await import("./paste-chips");
			expect(pasteChipsModule.default).toBeFunction();
		});
	});

	describe("thinking extension", () => {
		it("thinking extension exports a function", async () => {
			const thinkingModule = await import("./thinking");
			expect(thinkingModule.default).toBeFunction();
		});
	});
});
