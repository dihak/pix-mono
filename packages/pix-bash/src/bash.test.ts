import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@dihak/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@dihak/pix-pretty/types";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatBashDuration,
	formatExpandedBashCall,
	registerBashTool,
	summarizeBashCommand,
} from "./bash";

class MockTextComponent {
	private text: string;

	constructor(text = "") {
		this.text = text;
	}

	setText(value: string): void {
		this.text = value;
	}

	getText(): string {
		return this.text;
	}
}

describe("bash summaries", () => {
	it("summarizes command chains instead of repeating the full command", () => {
		expect(summarizeBashCommand("bun test && bun run lint && git diff --check")).toBe(
			"bun test · +2 steps",
		);
		expect(summarizeBashCommand("set -e\nTAG=release-1\ngit tag $TAG\ngit push origin $TAG")).toBe(
			"shell script · 3 lines",
		);
	});

	it("formats short durations compactly", () => {
		expect(formatBashDuration(420)).toBe("420ms");
		expect(formatBashDuration(2_450)).toBe("2.5s");
		expect(formatBashDuration(12_400)).toBe("12s");
	});
});

describe("registerBashTool", () => {
	it("clamps renderCall to small terminal widths", () => {
		const registered: {
			renderCall?: (...args: unknown[]) => MockTextComponent;
		} = {};
		const origColumns = process.env.COLUMNS;
		process.env.COLUMNS = "24";
		process.stdout.emit("resize");
		process.stdin.emit("resize");

		try {
			const mockPi: PiPrettyApi = {
				registerTool(tool: unknown) {
					Object.assign(registered, tool);
				},
				registerCommand() {},
				on() {},
			};

			registerBashTool(
				mockPi,
				() => ({
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: undefined,
					}),
				}),
				{
					cwd: process.cwd(),
					sp: (p: string) => p,
					TextComponent: MockTextComponent as unknown as TextComponentCtor,
					fffState: {
						module: null,
						finder: null,
						partialIndex: false,
						dbDir: null,
					} satisfies FffState,
					cursorStore: {
						store: () => "",
						get: () => undefined,
					} as unknown as CursorStore,
				},
			);

			const theme: ThemeLike = {
				fg: (_key: string, value: string) => value,
				bold: (value: string) => value,
			};
			const ctx: RenderContextLike = {
				expanded: false,
				isError: false,
				invalidate: () => {},
				state: {},
			};

			const text = registered.renderCall?.(
				{
					command: 'printf "very very very long line"\necho second\necho third',
					timeout: 30,
				},
				theme,
				ctx,
			);

			expect(text).toBeDefined();
			const rendered = text?.getText() ?? "";
			for (const line of rendered.split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(24);
			}
		} finally {
			if (origColumns === undefined) delete process.env.COLUMNS;
			else process.env.COLUMNS = origColumns;
			process.stdout.emit("resize");
			process.stdin.emit("resize");
		}
	});

	it("combines a collapsed command and result into one compact row", () => {
		const registered: {
			renderCall?: (...args: unknown[]) => MockTextComponent;
			renderResult?: (...args: unknown[]) => MockTextComponent;
		} = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};

		registerBashTool(
			mockPi,
			() => ({
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
			}),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
		);

		const theme: ThemeLike = {
			fg: (key: string, value: string) => (key === "muted" ? `<muted>${value}</muted>` : value),
			bold: (value: string) => value,
		};
		const collapsedCtx = {
			expanded: false,
			isError: false,
			invalidate: () => {},
			state: { collapsed: true },
		} as unknown as RenderContextLike;
		const call = registered.renderCall?.(
			{ command: "bun test && bun run lint && git diff --check", timeout: 30 },
			theme,
			collapsedCtx,
		);
		const result = registered.renderResult?.(
			{
				content: [{ type: "text", text: "one\ntwo" }],
				details: {
					_type: "bashResult",
					text: "one\ntwo",
					exitCode: 0,
					command: "bun test && bun run lint && git diff --check",
					durationMs: 2_450,
				},
			},
			undefined,
			theme,
			collapsedCtx,
		);

		expect(call?.getText()).toBe("");
		expect(result?.getText()).toContain("✓ bash <muted>bun test · +2 steps</muted>");
		expect(result?.getText()).toContain("2 lines · 2.5s");
		expect(result?.getText()).not.toContain("git diff --check");
	});

	it("wraps a long one-line command fully when expanded (no ellipsis)", () => {
		const registered: {
			renderCall?: (...args: unknown[]) => MockTextComponent;
		} = {};
		const origColumns = process.env.COLUMNS;
		process.env.COLUMNS = "40";
		process.stdout.emit("resize");
		process.stdin.emit("resize");

		try {
			const mockPi: PiPrettyApi = {
				registerTool(tool: unknown) {
					Object.assign(registered, tool);
				},
				registerCommand() {},
				on() {},
			};
			registerBashTool(
				mockPi,
				() => ({
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: undefined,
					}),
				}),
				{
					cwd: process.cwd(),
					sp: (p: string) => p,
					TextComponent: MockTextComponent as unknown as TextComponentCtor,
					fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
					cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
				},
			);
			const theme: ThemeLike = {
				fg: (_key: string, value: string) => value,
				bold: (value: string) => value,
			};
			// Long single-line script (same shape as the screenshot case).
			const command = 'set -e; printf "LINE_ONE\\n"; printf "LINE_TWO\\n"; printf "LINE_THREE\\n"';
			const compact = registered.renderCall?.({ command }, theme, {
				expanded: false,
				isError: false,
				invalidate: () => {},
				state: {},
			} as unknown as RenderContextLike);
			const expanded = registered.renderCall?.({ command }, theme, {
				expanded: true,
				isError: false,
				invalidate: () => {},
				state: { collapsed: true },
			} as unknown as RenderContextLike);

			const compactText = compact?.getText() ?? "";
			const expandedText = expanded?.getText() ?? "";
			// Compact still ellipsizes to one row.
			expect(compactText).toContain("…");
			expect(compactText.split("\n")).toHaveLength(1);
			// Expanded keeps the full command, wrapped across rows — no ellipsis cut-off.
			expect(expandedText).toContain("LINE_ONE");
			expect(expandedText).toContain("LINE_TWO");
			expect(expandedText).toContain("LINE_THREE");
			expect(expandedText).not.toContain("…");
			expect(expandedText.split("\n").length).toBeGreaterThan(1);
			for (const line of expandedText.split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(40);
			}
		} finally {
			if (origColumns === undefined) delete process.env.COLUMNS;
			else process.env.COLUMNS = origColumns;
			process.stdout.emit("resize");
			process.stdin.emit("resize");
		}
	});

	it("formatExpandedBashCall wraps under the label indent", () => {
		const theme = { fg: (_k: string, v: string) => v };
		const out = formatExpandedBashCall("bash", "aaaa bbbb cccc dddd eeee ffff", theme, {
			width: 16,
		});
		expect(out.startsWith("bash ")).toBe(true);
		expect(out).toContain("aaaa");
		expect(out).toContain("ffff");
		expect(out).not.toContain("…");
		expect(out.split("\n").length).toBeGreaterThan(1);
	});

	it("restores full multi-line command when an elapsed card is expanded", () => {
		const registered: {
			renderCall?: (...args: unknown[]) => MockTextComponent;
		} = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerBashTool(
			mockPi,
			() => ({
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
			}),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
		);
		const theme: ThemeLike = {
			fg: (_key: string, value: string) => value,
			bold: (value: string) => value,
		};
		const command = "set -e\nbun test\nbun run check";
		const state = { collapsed: true };
		const collapsed = registered.renderCall?.(command ? { command } : {}, theme, {
			expanded: false,
			isError: false,
			invalidate: () => {},
			state,
		} as unknown as RenderContextLike);
		const expanded = registered.renderCall?.({ command }, theme, {
			expanded: true,
			isError: false,
			invalidate: () => {},
			state,
		} as unknown as RenderContextLike);

		expect(collapsed?.getText()).toBe("");
		const expandedText = expanded?.getText() ?? "";
		expect(expandedText).toContain("set -e");
		expect(expandedText).toContain("bun test");
		expect(expandedText).toContain("bun run check");
		expect(expandedText).not.toContain("+2 lines");
		expect(expandedText.split("\n").length).toBeGreaterThanOrEqual(3);
	});

	it("restores full output when an elapsed card is expanded", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerBashTool(
			mockPi,
			() => ({
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
			}),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
		);
		const theme: ThemeLike = {
			fg: (_key: string, value: string) => value,
			bold: (value: string) => value,
		};
		const result = registered.renderResult?.(
			{
				content: [{ type: "text", text: "one\ntwo" }],
				details: {
					_type: "bashResult",
					text: "one\ntwo",
					exitCode: 0,
					command: "printf one",
					durationMs: 100,
				},
			},
			undefined,
			theme,
			{
				expanded: true,
				isError: false,
				invalidate: () => {},
				state: { collapsed: true },
			} as unknown as RenderContextLike,
		);

		expect(result?.getText()).toContain("one");
		expect(result?.getText()).toContain("two");
		expect(result?.getText()).not.toContain("✓ bash");
	});

	it("collapses structured errors and restores the exact diagnostic on expansion", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerBashTool(
			mockPi,
			() => ({ execute: async () => ({ content: [], details: undefined }) }),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
		);
		const theme: ThemeLike = {
			fg: (_key: string, value: string) => value,
			bold: (value: string) => value,
		};
		const diagnostic = "AssertionError: expected 1 to equal 2";
		const result = {
			content: [{ type: "text", text: diagnostic }],
			details: {
				_type: "bashResult",
				text: diagnostic,
				exitCode: 1,
				command: "bun test",
				durationMs: 100,
			},
		};
		const render = (state: Record<string, unknown>, expanded = false) =>
			registered
				.renderResult?.(result, { isPartial: false }, theme, {
					expanded,
					isError: true,
					invalidate: () => {},
					state,
				} as unknown as RenderContextLike)
				?.getText() ?? "";

		expect(render({ timer: 1 })).toContain(diagnostic);
		expect(render({ collapsed: true })).toContain("✗ bash bun test · exit 1");
		expect(render({ collapsed: true }, true)).toContain(diagnostic);
	});
});
