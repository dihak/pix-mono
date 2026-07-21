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

// Thinking levels use a dedicated 7-step blue brightness ramp (Ramp F),
// defined per-theme as thinkBlue1..7 vars. Border stays in the blue family
// at every level; brightness climbs with effort.
const THINKING_RAMP = [
	["thinkingOff", "thinkBlue1"],
	["thinkingMinimal", "thinkBlue2"],
	["thinkingLow", "thinkBlue3"],
	["thinkingMedium", "thinkBlue4"],
	["thinkingHigh", "thinkBlue5"],
	["thinkingXhigh", "thinkBlue6"],
	["thinkingMax", "thinkBlue7"],
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

		it(`${name} maps thinking levels to the blue ramp`, () => {
			const theme = readTheme(name);
			for (const [thinkingKey, rampVar] of THINKING_RAMP) {
				expect(theme.colors[thinkingKey]).toBe(rampVar);
				expect(theme.vars[rampVar]).toMatch(/^#[0-9a-f]{6}$/i);
			}
		});
	}
});
