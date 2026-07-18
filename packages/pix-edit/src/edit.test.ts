import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@xynogen/pix-pretty/types";
import { getEditOperations, registerEditTool, summarizeEditOperations } from "./edit";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("registerEditTool", () => {
	it("registers a tool named 'edit'", () => {
		const tools: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(t: unknown) {
				tools.push((t as { name: string }).name);
			},
			registerCommand() {},
			on() {},
		};

		registerEditTool(
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
			(_id: string, _inv: () => void) => {},
		);
		expect(tools).toEqual(["edit"]);
	});

	it("restores the bounded diff when an elapsed card is expanded", () => {
		const registered: { renderResult?: (...args: unknown[]) => MockTextComponent } = {};
		const mockPi: PiPrettyApi = {
			registerTool(tool: unknown) {
				Object.assign(registered, tool);
			},
			registerCommand() {},
			on() {},
		};
		registerEditTool(
			mockPi,
			() => ({ execute: async () => ({ content: [], details: undefined }) }),
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as unknown as TextComponentCtor,
				fffState: { module: null, finder: null, partialIndex: false, dbDir: null },
				cursorStore: { store: () => "", get: () => undefined } as unknown as CursorStore,
			},
			() => {},
		);
		const theme: ThemeLike = {
			fg: (_key: string, value: string) => value,
			bold: (value: string) => value,
		};
		const result = registered.renderResult?.(
			{
				content: [{ type: "text", text: "edited" }],
				details: {
					_type: "editInfo",
					filePath: "sample.ts",
					summary: "+1 -1",
					oldContent: "old",
					newContent: "new",
					language: "typescript",
					editLine: 1,
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

		expect(result?.getText()).toContain("rendering diff");
		expect(result?.getText()).not.toContain("✓ edit");
	});
});

describe("getEditOperations", () => {
	it("extracts array edits", () => {
		const ops = getEditOperations({
			path: "f.ts",
			edits: [{ oldText: "a", newText: "b" }],
		});
		expect(ops).toEqual([{ oldText: "a", newText: "b" }]);
	});

	it("filters ops where old === new", () => {
		const ops = getEditOperations({
			path: "f.ts",
			edits: [{ oldText: "x", newText: "x" }],
		});
		expect(ops).toHaveLength(0);
	});
});

describe("summarizeEditOperations", () => {
	it("returns a summary string", () => {
		const { summary } = summarizeEditOperations([{ oldText: "a\nb", newText: "c\nd\ne" }]);
		expect(typeof summary).toBe("string");
		expect(summary.length).toBeGreaterThan(0);
	});
});
