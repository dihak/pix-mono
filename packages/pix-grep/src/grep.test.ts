import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@dihak/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@dihak/pix-pretty/types";
import { applyGrepDefaults, DEFAULT_GREP_LIMIT, registerGrepTool } from "./grep";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("applyGrepDefaults", () => {
	it("applies a conservative default without overriding an explicit limit", () => {
		expect(applyGrepDefaults({ pattern: "TODO" })).toEqual({
			pattern: "TODO",
			limit: DEFAULT_GREP_LIMIT,
		});
		expect(applyGrepDefaults({ pattern: "TODO", limit: 5 })).toEqual({
			pattern: "TODO",
			limit: 5,
		});
	});
});

describe("registerGrepTool", () => {
	it("registers a tool named 'grep'", () => {
		const tools: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(t: unknown) {
				tools.push((t as { name: string }).name);
			},
			registerCommand() {},
			on() {},
		};

		registerGrepTool(
			mockPi,
			() => ({ execute: async () => ({ content: [], details: undefined }) }),
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
		expect(tools).toEqual(["grep"]);
	});

	it("restores matching lines when an elapsed card is expanded", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerGrepTool(
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
		const output = "src/a.ts:1:TODO one\nsrc/b.ts:2:TODO two";
		const result = registered.renderResult?.(
			{
				content: [{ type: "text", text: output }],
				details: {
					_type: "grepResult",
					text: output,
					pattern: "TODO",
					matchCount: 2,
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

		const rendered = result?.getText() ?? "";
		expect(rendered).toContain("src/a.ts:1:");
		expect(rendered).toContain("TODO");
		expect(rendered).toContain("one");
		expect(rendered).toContain("src/b.ts:2:");
		expect(rendered).not.toContain("✓ grep");
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
		registerGrepTool(
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
		const diagnostic = "regex parse error: unclosed group";
		const result = {
			content: [{ type: "text", text: diagnostic }],
			details: {
				_type: "grepResult",
				text: diagnostic,
				pattern: "(",
				path: "src",
				matchCount: 0,
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
		expect(render({ collapsed: true })).toContain("✗ grep “(” in src · failed");
		expect(render({ collapsed: true }, true)).toContain(diagnostic);
	});

	it("batches patterns into one execute and one result", async () => {
		const registered: {
			parameters?: { properties?: Record<string, unknown> };
			execute?: (...args: unknown[]) => Promise<{
				content: Array<{ type: string; text?: string }>;
				details?: { matchCount?: number; patterns?: string[] };
			}>;
		} = {};
		const seen: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerGrepTool(
			mockPi,
			() => ({
				parameters: {
					type: "object",
					required: ["pattern"],
					properties: { pattern: { type: "string" } },
				},
				execute: async (_id, params: { pattern: string }) => {
					seen.push(params.pattern);
					return {
						content: [{ type: "text", text: `src/a.ts:1:${params.pattern}` }],
						details: undefined,
					};
				},
			}),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
		);

		expect(registered.parameters?.properties?.patterns).toBeDefined();
		const result = await registered.execute?.("t", { patterns: ["TODO", "FIXME"] });
		expect(seen).toEqual(["TODO", "FIXME"]);
		const text = result?.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("TODO 1 match · FIXME 1 match");
		expect(result?.details?.patterns).toEqual(["TODO", "FIXME"]);
		expect(result?.details?.matchCount).toBe(2);
	});
});
