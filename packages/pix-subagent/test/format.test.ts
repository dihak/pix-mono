import { expect, test } from "bun:test";
import { formatMs, formatTokens, formatTurns } from "../src/tools.ts";

test("formatTokens < 1k", () => {
	expect(formatTokens(500)).toBe("500 token");
});

test("formatTokens 1k–1M", () => {
	expect(formatTokens(12_400)).toBe("12.4k token");
});

test("formatTokens >= 1M", () => {
	expect(formatTokens(2_500_000)).toBe("2.5M token");
});

test("formatMs rounds to 1dp", () => {
	expect(formatMs(1234)).toBe("1.2s");
});

test("formatTurns no max", () => {
	expect(formatTurns(3)).toBe("↻3");
});

test("formatTurns with max", () => {
	expect(formatTurns(3, 10)).toBe("↻3≤10");
});
