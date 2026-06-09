/**
 * Basic smoke tests for pix-tokyo-night theme
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("pix-tokyo-night", () => {
	it("theme directory exists", () => {
		const themesDir = resolve(__dirname, "../themes");
		expect(existsSync(themesDir)).toBe(true);
	});

	it("contains pix-tokyo-night theme file", () => {
		const themeFile = resolve(__dirname, "../themes/pix-tokyo-night.json");
		expect(existsSync(themeFile)).toBe(true);
	});
});
