import { describe, expect, it } from "bun:test";
import { formatFetchResult } from "./fetch.ts";
import { formatSearchResults } from "./search.ts";

describe("formatSearchResults", () => {
	it("formats results as a numbered markdown list", () => {
		const raw = JSON.stringify({
			provider: "exa",
			query: "test",
			results: [
				{
					title: "First Result",
					url: "https://example.com/a",
					snippet: "Some   snippet\n  text here",
					published_at: "2026-03-04T22:36:57.000Z",
					metadata: { author: "alice" },
				},
				{
					title: "",
					url: "https://example.com/b",
					snippet: null,
				},
			],
		});

		const out = formatSearchResults(raw);
		expect(out).toContain("1. First Result");
		expect(out).toContain("   https://example.com/a");
		expect(out).toContain("(alice — 2026-03-04)");
		expect(out).toContain("Some snippet text here");
		// untitled result falls back to url as title
		expect(out).toContain("2. https://example.com/b");
		// no raw JSON noise
		expect(out).not.toContain("{");
		expect(out).not.toContain('"provider"');
	});

	it("handles empty results", () => {
		expect(formatSearchResults(JSON.stringify({ results: [] }))).toBe("No results.");
	});

	it("falls back to pretty JSON for unexpected shapes", () => {
		const raw = JSON.stringify({ answer: "42" });
		expect(formatSearchResults(raw)).toContain('"answer"');
	});

	it("returns raw string when not JSON", () => {
		expect(formatSearchResults("plain text error")).toBe("plain text error");
	});

	it("truncates long snippets to 300 chars", () => {
		const raw = JSON.stringify({
			results: [{ title: "T", url: "https://x.dev", snippet: "y".repeat(1000) }],
		});
		const out = formatSearchResults(raw);
		const snippetLine = out.split("\n").find((l) => l.trimStart().startsWith("yyy"));
		expect(snippetLine?.trim().length).toBe(300);
	});
});

describe("formatFetchResult", () => {
	it("extracts content.text with title/url header", () => {
		const raw = JSON.stringify({
			provider: "exa",
			url: "https://example.com",
			title: "Example Page",
			content: { format: "markdown", text: "# Hello\n\nBody text." },
		});

		const out = formatFetchResult(raw);
		expect(out).toBe("# Example Page\nURL: https://example.com\n\n# Hello\n\nBody text.");
	});

	it("supports content as a plain string", () => {
		const raw = JSON.stringify({ content: "just text" });
		expect(formatFetchResult(raw)).toBe("just text");
	});

	it("returns raw when content.text is missing", () => {
		const raw = JSON.stringify({ status: "error" });
		expect(formatFetchResult(raw)).toBe(raw);
	});

	it("returns raw when not JSON", () => {
		expect(formatFetchResult("<html>raw</html>")).toBe("<html>raw</html>");
	});
});
