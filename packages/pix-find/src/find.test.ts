import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@dihak/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@dihak/pix-pretty/types";
import { applyFindDefaults, DEFAULT_FIND_LIMIT, registerFindTool } from "./find";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("applyFindDefaults", () => {
	it("applies a conservative default without overriding an explicit limit", () => {
		expect(applyFindDefaults({ pattern: "**/*.ts" })).toEqual({
			pattern: "**/*.ts",
			limit: DEFAULT_FIND_LIMIT,
		});
		expect(applyFindDefaults({ pattern: "**/*.ts", limit: 8 })).toEqual({
			pattern: "**/*.ts",
			limit: 8,
		});
	});
});

describe("registerFindTool", () => {
	it("registers a tool named 'find'", () => {
		const tools: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(t: unknown) {
				tools.push((t as { name: string }).name);
			},
			registerCommand() {},
			on() {},
		};

		registerFindTool(
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
		expect(tools).toEqual(["find"]);
	});

	it("restores result paths when an elapsed card is expanded", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerFindTool(
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
		const result = registered.renderResult?.(
			{
				content: [{ type: "text", text: "src/one.ts\nsrc/two.ts" }],
				details: {
					_type: "findResult",
					text: "src/one.ts\nsrc/two.ts",
					pattern: "**/*.ts",
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

		expect(result?.getText()).toContain("src/one.ts");
		expect(result?.getText()).toContain("src/two.ts");
		expect(result?.getText()).not.toContain("2 files");
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
		registerFindTool(
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
		const diagnostic = "Invalid glob pattern: [";
		const result = {
			content: [{ type: "text", text: diagnostic }],
			details: {
				_type: "findResult",
				text: diagnostic,
				pattern: "[",
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
		expect(render({ collapsed: true })).toContain("✗ find [ in src · failed");
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
		registerFindTool(
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
						content: [{ type: "text", text: `${params.pattern}.ts` }],
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
		const result = await registered.execute?.("t", { patterns: ["**/*.test.ts", "**/SKILL.md"] });
		expect(seen).toEqual(["**/*.test.ts", "**/SKILL.md"]);
		const text = result?.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("**/*.test.ts 1 file");
		expect(text).toContain("**/SKILL.md 1 file");
		expect(result?.details?.matchCount).toBe(2);
	});
});
