/**
 * Smoke tests for pix-themes — verifies both bundled themes are present and valid.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const THEMES = [
	"pix-tokyo-night",
	"pix-one-dark",
	"pix-catppuccin-mocha",
	"pix-gruvbox-dark",
	"pix-dracula",
	"pix-nord",
	"pix-rose-pine",
] as const;

const THINKING_COLOR_KEYS = [
	["thinkingOff", "dim"],
	["thinkingMinimal", "muted"],
	["thinkingLow", "muted"],
	["thinkingMedium", "accent"],
	["thinkingHigh", "warning"],
	["thinkingXhigh", "error"],
] as const;

function readTheme(name: (typeof THEMES)[number]) {
	const themeFile = resolve(__dirname, `../themes/${name}.json`);
	try {
		return JSON.parse(readFileSync(themeFile, "utf8"));
	} catch (error) {
		throw new Error(`Invalid theme JSON: ${name}`, { cause: error });
	}
}

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
			const theme = readTheme(name);
			expect(theme.name).toBe(name);
		});

		it(`${name} maps thinking levels to the shared semantic ramp`, () => {
			const theme = readTheme(name);
			for (const [thinkingKey, semanticKey] of THINKING_COLOR_KEYS) {
				expect(theme.colors[thinkingKey]).toBe(theme.colors[semanticKey]);
			}
		});
	}
});
