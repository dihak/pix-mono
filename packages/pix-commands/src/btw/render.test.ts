import { describe, expect, test } from "bun:test";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import { type BtwMessageDetails, formatDuration, registerBtwRenderer } from "./render.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

function captureRenderer() {
	let renderer: ((message: unknown, options: unknown, theme: unknown) => unknown) | undefined;
	const pi = {
		registerMessageRenderer(_name: string, fn: typeof renderer) {
			renderer = fn;
		},
	} as unknown as ExtensionAPI;
	registerBtwRenderer(pi);
	if (!renderer) throw new Error("renderer was not registered");
	return renderer;
}

const backgrounds: string[] = [];
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (color: string, text: string) => {
		backgrounds.push(color);
		return text;
	},
	bold: (text: string) => text,
};

function render(details: BtwMessageDetails): string {
	const renderer = captureRenderer();
	const component = renderer({ details, content: details.answer }, { expanded: false }, theme) as {
		render(width: number): string[];
	};
	return stripAnsi(component.render(80).join("\n"));
}

describe("BTW renderer", () => {
	test("formats durations compactly", () => {
		expect(formatDuration(450)).toBe("450ms");
		expect(formatDuration(2_100)).toBe("2.1s");
		expect(formatDuration(65_000)).toBe("1m 5s");
	});

	test("renders metadata and question as distinct side-thread card chrome", () => {
		backgrounds.length = 0;
		const output = render({
			question: "hello",
			answer: "Hi!",
			model: "GPT-5.6",
			thinkingLevel: "high",
			durationMs: 2_100,
			toolUses: 0,
		});
		expect(output).toContain("✓ BTW · GPT-5.6 · high · 2.1s");
		expect(output).toContain("▐ hello");
		expect(output).not.toContain("SIDE THREAD");
		expect(backgrounds).toContain("selectedBg");
		expect(backgrounds).not.toContain("customMessageBg");
	});

	test("renders the answer as Markdown", () => {
		initTheme();
		const output = render({
			question: "show markdown",
			answer: "## Heading\n\n- alpha\n- beta\n\n`code`",
			model: "Model",
			thinkingLevel: "medium",
			durationMs: 1_000,
			toolUses: 1,
		});
		expect(output).toContain("Heading");
		expect(output).toContain("alpha");
		expect(output).toContain("beta");
		expect(output).toContain("code");
	});
});
