import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@dihak/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@dihak/pix-pretty/types";
import { applyReadDefaults, DEFAULT_READ_LIMIT, registerReadTool } from "./read";

type Registered = {
	parameters?: { properties?: Record<string, unknown>; required?: string[] };
	execute?: (...args: unknown[]) => Promise<{
		content: Array<{ type: string; text?: string }>;
		details?: unknown;
	}>;
	renderResult?: (...args: unknown[]) => MockTextComponent;
};

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("applyReadDefaults", () => {
	it("applies a conservative default without overriding an explicit limit", () => {
		expect(applyReadDefaults({ path: "large.ts" })).toEqual({
			path: "large.ts",
			limit: DEFAULT_READ_LIMIT,
		});
		expect(applyReadDefaults({ path: "large.ts", limit: 25 })).toEqual({
			path: "large.ts",
			limit: 25,
		});
	});
});

describe("registerReadTool", () => {
	it("registers a tool named 'read'", () => {
		const tools: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(t: unknown) {
				tools.push((t as { name: string }).name);
			},
			registerCommand() {},
			on() {},
		};

		registerReadTool(
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
		expect(tools).toEqual(["read"]);
	});

	it("recomputes an async file preview when expanded mode changes", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerReadTool(
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
		const state: Record<string, unknown> = { timer: 1 };
		const result = {
			content: [{ type: "text", text: "one\ntwo" }],
			details: {
				_type: "readFile",
				filePath: "sample.ts",
				content: "one\ntwo",
				offset: 1,
				lineCount: 2,
			},
		};
		const baseCtx = {
			isError: false,
			invalidate: () => {},
			state,
		} as unknown as RenderContextLike;

		registered.renderResult?.(result, undefined, theme, { ...baseCtx, expanded: false });
		const collapsedKey = state._rk;
		registered.renderResult?.(result, undefined, theme, { ...baseCtx, expanded: true });

		expect(collapsedKey).toBeDefined();
		expect(state._rk).not.toBe(collapsedKey);
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
		registerReadTool(
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
		const diagnostic = "ENOENT: no such file or directory";
		const result = {
			content: [{ type: "text", text: diagnostic }],
			details: {
				_type: "readFile",
				filePath: "missing.ts",
				content: diagnostic,
				offset: 1,
				lineCount: 1,
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
		expect(render({ collapsed: true })).toContain("✗ read missing.ts · failed");
		expect(render({ collapsed: true }, true)).toContain(diagnostic);
	});

	it("batches paths into one execute and one result", async () => {
		const registered: Registered = {};
		const seen: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerReadTool(
			mockPi,
			() => ({
				parameters: {
					type: "object",
					required: ["path"],
					properties: { path: { type: "string" } },
				},
				execute: async (_id, params: { path: string }) => {
					seen.push(params.path);
					return { content: [{ type: "text", text: `${params.path}-body` }], details: undefined };
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

		expect(registered.parameters?.required).toBeUndefined();
		expect(registered.parameters?.properties?.paths).toBeDefined();

		const result = await registered.execute?.("t", { paths: ["a.ts", "b.ts"] });
		expect(seen).toEqual(["a.ts", "b.ts"]);
		const text = result?.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("a.ts 1 line · b.ts 1 line");
		expect(text).toContain("===== a.ts =====");
		expect(text).toContain("a.ts-body");
		expect((result?.details as { _type?: string })._type).toBe("readBatch");
	});

	it("keeps a single path on the original result shape", async () => {
		const registered: Registered = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerReadTool(
			mockPi,
			() => ({
				execute: async () => ({
					content: [{ type: "text", text: "hello" }],
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
		const result = await registered.execute?.("t", { path: "solo.ts" });
		expect((result?.details as { _type?: string; filePath?: string })._type).toBe("readFile");
		expect((result?.details as { filePath?: string }).filePath).toBe("solo.ts");
		expect(result?.content.find((c) => c.type === "text")?.text).toBe("hello");
	});
});
