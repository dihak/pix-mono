/**
 * Smoke tests for pix-themes — verifies both bundled themes are present and valid.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const THEMES = ["pix-tokyo-night", "pix-one-dark"] as const;

describe("pix-themes", () => {
	it("theme directory exists", () => {
		const themesDir = resolve(__dirname, "../themes");
		expect(existsSync(themesDir)).toBe(true);
	});

	for (const name of THEMES) {
		it(`contains ${name} theme file`, () => {
			const themeFile = resolve(__dirname, `../themes/${name}.json`);
			expect(existsSync(themeFile)).toBe(true);
		});

		it(`${name} is valid JSON with the expected name`, () => {
			const themeFile = resolve(__dirname, `../themes/${name}.json`);
			const theme = JSON.parse(readFileSync(themeFile, "utf8"));
			expect(theme.name).toBe(name);
		});
	}
});
