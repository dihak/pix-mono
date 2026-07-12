import { describe, expect, test } from "bun:test";
import { icon } from "@xynogen/pix-pretty/icon-catalog";
import { compactStatus } from "./footer.ts";

const theme = {
	fg: (_color: string, text: string) => text,
};

describe("compactStatus", () => {
	test("compacts current pi-lens active server lists to a count", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active: json, yaml, typescript", theme)).toBe(
			`${icon("lsp")}  3`,
		);
	});

	test("preserves active and failed counts without listing server names", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active: json, yaml · LSP Failed: eslint", theme)).toBe(
			`${icon("lsp")}  2 !1`,
		);
	});

	test("keeps compatibility with the older parenthesized count", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active (4)", theme)).toBe(`${icon("lsp")}  4`);
	});
});
