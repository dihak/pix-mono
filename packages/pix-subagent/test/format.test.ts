import { expect, test } from "bun:test";
import { icon } from "@xynogen/pix-pretty/icon-catalog";
import {
	fmtTokenCount,
	formatAgentCall,
	formatContext,
	formatMs,
	formatTokens,
	formatToolUses,
	formatTurns,
} from "../src/tools.ts";
import { describeActivity, formatSpeed } from "../src/ui/widget.ts";

test("formatAgentCall includes the task prompt below its header", () => {
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const rendered = formatAgentCall(
		{
			type: "general-purpose",
			description: "Audit recording dead code",
			prompt: "here",
			background: false,
		},
		theme,
	);

	expect(rendered).toBe('▸ Agent  Audit recording dead code\n"here"');
});

test("formatTokens < 1k", () => {
	// nerd-mode default: nf-md-file-document-outline (U+F027F) + space
	expect(formatTokens(500)).toBe(`${icon("tokens")} 500 token`);
});

test("formatTokens 1k–1M", () => {
	expect(formatTokens(12_400)).toBe(`${icon("tokens")} 12.4k token`);
});

test("formatTokens >= 1M", () => {
	expect(formatTokens(2_500_000)).toBe(`${icon("tokens")} 2.5M token`);
});

test("formatMs rounds to 1dp", () => {
	expect(formatMs(1234)).toBe("1.2s");
});

test("formatTurns no max", () => {
	// nerd-mode default: nf-md-autorenew glyph (U+F006A) + space before count
	expect(formatTurns(3)).toBe(`${icon("turns")} 3`);
});

test("formatTurns with max", () => {
	expect(formatTurns(3, 10)).toBe(`${icon("turns")} 3≤10`);
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

test("formatToolUses drops label", () => {
	expect(formatToolUses(15)).toBe(`${icon("tools")} 15`);
});

test("formatToolUses singular count", () => {
	expect(formatToolUses(1)).toBe(`${icon("tools")} 1`);
});

test("fmtTokenCount under 1K", () => {
	expect(fmtTokenCount(500)).toBe("500");
});

test("fmtTokenCount 1K to 1M", () => {
	expect(fmtTokenCount(30_100)).toBe("30.1K");
});

test("fmtTokenCount >= 1M", () => {
	expect(fmtTokenCount(1_000_000)).toBe("1.00M");
});

test("formatContext full usage object", () => {
	expect(formatContext({ tokens: 30_100, contextWindow: 1_000_000, percent: 3 })).toBe(
		`${icon("tokens")} 30.1K/1.00M (3%)`,
	);
});

test("formatContext computes used from percent when tokens null", () => {
	// 42% of 200,000 = 84,000 → "84.0K"
	expect(formatContext({ tokens: null, contextWindow: 200_000, percent: 42 })).toBe(
		`${icon("tokens")} 84.0K/200.0K (42%)`,
	);
});

test("formatContext falls back to pct-only when window unknown", () => {
	expect(formatContext({ tokens: 5_000, contextWindow: 0, percent: 42 })).toBe(
		`${icon("tokens")} 42% ctx`,
	);
});

test("formatContext empty on null", () => {
	expect(formatContext(null)).toBe("");
});

test("formatContext empty on null percent", () => {
	expect(formatContext({ tokens: null, contextWindow: 1000, percent: null })).toBe("");
});

test("formatContext rounds percent", () => {
	// contextWindow 0 → fallback to pct-only, 73.6 rounds to 74
	expect(formatContext({ tokens: null, contextWindow: 0, percent: 73.6 })).toBe(
		`${icon("tokens")} 74% ctx`,
	);
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
