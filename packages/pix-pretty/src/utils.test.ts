import { describe, expect, it } from "bun:test";

import { MAX_PREVIEW_LINES } from "./config.js";
import type { FgTheme } from "./types.js";
import { pluralize, renderDimPreview, setResultDetails } from "./utils.js";

// Strip ANSI escapes so assertions test content, not color codes.
const ANSI = /\x1b\[[0-9;]*m/g;
function plain(text: string): string {
	return text.replace(ANSI, "");
}

// Minimal theme: fg() passes text through untouched.
const theme: FgTheme = { fg: (_key, text) => text };

describe("pluralize", () => {
	it("uses singular for count of 1", () => {
		expect(pluralize(1, "match", "matches")).toBe("1 match");
	});

	it("uses plural for count != 1", () => {
		expect(pluralize(0, "match", "matches")).toBe("0 matches");
		expect(pluralize(2, "match", "matches")).toBe("2 matches");
	});

	it("defaults plural to noun + s", () => {
		expect(pluralize(1, "line")).toBe("1 line");
		expect(pluralize(3, "line")).toBe("3 lines");
	});
});

describe("setResultDetails", () => {
	it("preserves upstream metadata while adding renderer details", () => {
		const result = {
			content: [{ type: "text" as const, text: "output" }],
			details: {
				truncation: { truncated: true, totalLines: 500 },
				fullOutputPath: "/tmp/full.log",
			},
		};

		setResultDetails(result, { _type: "bashResult", exitCode: 0 });

		expect(result.details as Record<string, unknown>).toEqual({
			truncation: { truncated: true, totalLines: 500 },
			fullOutputPath: "/tmp/full.log",
			_type: "bashResult",
			exitCode: 0,
		});
	});
});

describe("renderDimPreview", () => {
	it("renders 'done' for empty input", () => {
		expect(plain(renderDimPreview("", theme))).toContain("done");
	});

	it("shows every line when under the cap", () => {
		const out = plain(renderDimPreview("a\nb\nc", theme));
		expect(out).toContain("a");
		expect(out).toContain("b");
		expect(out).toContain("c");
		expect(out).not.toContain("more line");
	});

	it("does not add overflow marker at exactly the cap", () => {
		const body = Array.from({ length: MAX_PREVIEW_LINES }, (_, i) => `L${i}`);
		const out = plain(renderDimPreview(body.join("\n"), theme));
		expect(out).not.toContain("more line");
	});

	it("adds singular overflow marker for 1 extra line", () => {
		const body = Array.from({ length: MAX_PREVIEW_LINES + 1 }, (_, i) => `L${i}`);
		const out = plain(renderDimPreview(body.join("\n"), theme));
		expect(out).toContain("… 1 more line");
		expect(out).not.toContain("more lines");
	});

	it("adds plural overflow marker for many extra lines", () => {
		const body = Array.from({ length: MAX_PREVIEW_LINES + 3 }, (_, i) => `L${i}`);
		const out = plain(renderDimPreview(body.join("\n"), theme));
		expect(out).toContain("… 3 more lines");
	});

	it("respects a custom maxLines", () => {
		const out = plain(renderDimPreview("a\nb\nc\nd", theme, { maxLines: 2 }));
		expect(out).toContain("… 2 more lines");
	});

	it("prepends a header line when given", () => {
		const out = plain(renderDimPreview("body", theme, { header: "5 matches" }));
		expect(out).toContain("5 matches");
		expect(out).toContain("body");
	});

	it("highlights matched keyword with non-dim styling", () => {
		const raw = renderDimPreview("foo bar foo", theme, { highlight: "foo" });
		// matched 'foo' wrapped in yellow/bold ANSI (not produced by stub fg)
		expect(raw).toContain("\x1b[");
		expect(plain(raw)).toContain("foo bar foo");
	});

	it("treats regex metacharacters as literal highlight text", () => {
		const raw = renderDimPreview("call(foo)", theme, { highlight: "(" });
		expect(plain(raw)).toContain("call(foo)");
		expect(raw).toContain("\x1b[");
	});
});
