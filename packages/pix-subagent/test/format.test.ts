import { expect, test } from "bun:test";
import { formatMs, formatTokens, formatTurns } from "../src/tools.ts";
import { describeActivity, formatSpeed } from "../src/ui/widget.ts";

test("formatTokens < 1k", () => {
	// nerd-mode default: nf-md-file-document-outline (U+F027F) + space
	expect(formatTokens(500)).toBe("\u{F027F} 500 token");
});

test("formatTokens 1k–1M", () => {
	expect(formatTokens(12_400)).toBe("\u{F027F} 12.4k token");
});

test("formatTokens >= 1M", () => {
	expect(formatTokens(2_500_000)).toBe("\u{F027F} 2.5M token");
});

test("formatMs rounds to 1dp", () => {
	expect(formatMs(1234)).toBe("1.2s");
});

test("formatTurns no max", () => {
	// nerd-mode default: nf-md-autorenew glyph (U+F006A) + space before count
	expect(formatTurns(3)).toBe("\u{F006A} 3");
});

test("formatTurns with max", () => {
	expect(formatTurns(3, 10)).toBe("\u{F006A} 3≤10");
});

test("formatSpeed computes output t/s", () => {
	expect(formatSpeed(1500, 3000)).toBe("500 t/s");
});

test("formatSpeed empty on zero output", () => {
	expect(formatSpeed(0, 3000)).toBe("");
});

test("formatSpeed empty on zero duration", () => {
	expect(formatSpeed(1500, 0)).toBe("");
});

test("describeActivity: active tool wins over output", () => {
	expect(describeActivity(new Map([["t1", "read"]]), "some text")).toBe("reading…");
});

test("describeActivity: groups parallel tools with count", () => {
	const tools = new Map([
		["a", "read"],
		["b", "read"],
		["c", "read"],
	]);
	expect(describeActivity(tools)).toBe("reading 3×…");
});

test("describeActivity: tails last output line to 16 chars", () => {
	const out = "first line\nwriting the batch result now";
	expect(describeActivity(new Map(), out)).toBe("…batch result now");
});

test("describeActivity: short output untruncated", () => {
	expect(describeActivity(new Map(), "done")).toBe("done");
});

test("describeActivity: idle is thinking", () => {
	expect(describeActivity(new Map(), "")).toBe("thinking…");
});
