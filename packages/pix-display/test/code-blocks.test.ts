import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCodeFences } from "../src/code-blocks.js";

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

const theme = {
	fg: (color: string, text: string) => `\x1b[3${color === "accent" ? "2" : "8"}m${text}\x1b[39m`,
	bg: (_color: string, text: string) => `\x1b[48;2;20;20;20m${text}\x1b[49m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	getBgAnsi: (_color: string) => "\x1b[48;2;20;20;20m",
} as Parameters<typeof renderCodeFences>[2];

function plain(line: string): string {
	return line.replace(ANSI_RE, "");
}

describe("renderCodeFences", () => {
	it("renders a bash fence with a labeled header", () => {
		const lines = [
			" ```bash                                                                  ",
			"   curl -sfL https://get.k3s.io | \\                                      ",
			"     K3S_URL=https://192.168.1.20:6443 \\                                 ",
			'     K3S_TOKEN="PASTE_TOKEN_HERE" \\                                    ',
			"     sh -                                                                  ",
			" ```                                                                      ",
		];

		const rendered = renderCodeFences(lines, 72, theme);
		const text = rendered.map(plain);

		expect(text[0]).toContain("╭─ bash ");
		expect(text[1]).toBe("curl -sfL https://get.k3s.io | \\");
		expect(text[2]).toBe("  K3S_URL=https://192.168.1.20:6443 \\");
		expect(text[3]).toBe('  K3S_TOKEN="PASTE_TOKEN_HERE" \\');
		expect(text[4]).toBe("  sh -");
		expect(text.slice(1, 5).every((line) => !line.includes("│"))).toBe(true);
		expect(text[5]).toContain("╰─");
		expect(visibleWidth(rendered[0] ?? "")).toBe(72);
		expect(visibleWidth(rendered[5] ?? "")).toBe(72);
	});

	it.each([
		"python",
		"typescript",
		"javascript",
		"json",
		"yaml",
		"rust",
		"go",
		"sql",
		"html",
		"css",
		"c++",
		"custom-language",
	])("supports and labels the %s fence", (language) => {
		const rendered = renderCodeFences([`\`\`\`${language}`, "  example  ", "```"], 40, theme);
		expect(plain(rendered[0] ?? "")).toContain(`╭─ ${language} `);
		expect(plain(rendered[1] ?? "")).toBe("example");
	});

	it("uses a generic label for an untagged fence", () => {
		const rendered = renderCodeFences(["```", "  plain text", "```"], 40, theme);
		expect(plain(rendered[0] ?? "")).toContain("╭─ code ");
	});

	it("uses the language token from a fence with metadata", () => {
		const rendered = renderCodeFences(
			['```python title="example.py"', "  print('hello')", "```"],
			48,
			theme,
		);
		expect(plain(rendered[0] ?? "")).toContain("╭─ python ");
	});

	it("leaves an incomplete fence to the native Markdown renderer", () => {
		const incomplete = ["```python", "print('hello')"];
		expect(renderCodeFences(incomplete, 40, theme)).toEqual(incomplete);
	});

	it("renders multiple languages in one response", () => {
		const rendered = renderCodeFences(
			["```python", "  print('hello')", "```", "", "```json", '  {"ok": true}', "```"],
			48,
			theme,
		).map(plain);

		expect(rendered.some((line) => line.includes("╭─ python "))).toBe(true);
		expect(rendered.some((line) => line.includes("╭─ json "))).toBe(true);
	});

	it("keeps multiline shell commands copyable without border glyphs", () => {
		const rendered = renderCodeFences(
			["```bash", "git tag release-1", "git push origin main release-1", "```"],
			48,
			theme,
		).map(plain);

		expect(rendered[1]?.trim()).toBe("git tag release-1");
		expect(rendered[2]?.trim()).toBe("git push origin main release-1");
		expect(rendered[1]).not.toContain("│");
		expect(rendered[2]).not.toContain("│");
	});

	it("removes layout padding while preserving meaningful Python indentation", () => {
		const rendered = renderCodeFences(
			[
				"  ```python",
				"    def greet(name):                                      ",
				'        print(f"Hello, {name}")                          ',
				"  ```",
			],
			64,
			theme,
		).map(plain);

		expect(rendered[1]).toBe("def greet(name):");
		expect(rendered[2]).toBe('    print(f"Hello, {name}")');
	});

	it("preserves syntax-highlight ANSI while applying the frame background", () => {
		const highlighted = '\x1b[38;2;206;145;120m"TOKEN"\x1b[39m';
		const rendered = renderCodeFences(["```python", `  print(${highlighted})`, "```"], 40, theme);

		expect(rendered[1]).toContain(highlighted);
		expect(rendered[1]).toContain("\x1b[48;2;20;20;20m");
	});

	it("truncates oversized code lines without exceeding terminal width", () => {
		const rendered = renderCodeFences(
			["```python", `  value = "${"x".repeat(100)}"`, "```"],
			24,
			theme,
		);

		expect(plain(rendered[1] ?? "")).toContain("…");
		expect(rendered.every((line) => visibleWidth(line) <= 24)).toBe(true);
	});
});
