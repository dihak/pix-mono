import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@xynogen/pix-pretty/types";
import { applyReadDefaults, DEFAULT_READ_LIMIT, registerReadTool } from "./read";

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
});
