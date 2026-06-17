import { describe, expect, it } from "bun:test";
import {
	getEditOperations,
	registerEditTool,
	summarizeEditOperations,
} from "./edit";

class MockTextComponent {
	private text = "";
	constructor(_t = "", _x = 0, _y = 0) {}
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
		registerEditTool(
			{ registerTool: (t: any) => tools.push(t.name) } as any,
			() => ({ execute: async () => ({ content: [] }) }) as any,
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as any,
				fffState: {} as any,
				cursorStore: {} as any,
			},
			(_id: string, _inv: () => void) => {},
		);
		expect(tools).toEqual(["edit"]);
	});
});

describe("getEditOperations", () => {
	it("extracts array edits", () => {
		const ops = getEditOperations({
			path: "f.ts",
			edits: [{ oldText: "a", newText: "b" }],
		} as any);
		expect(ops).toEqual([{ oldText: "a", newText: "b" }]);
	});

	it("filters ops where old === new", () => {
		const ops = getEditOperations({
			path: "f.ts",
			edits: [{ oldText: "x", newText: "x" }],
		} as any);
		expect(ops).toHaveLength(0);
	});
});

describe("summarizeEditOperations", () => {
	it("returns a summary string", () => {
		const { summary } = summarizeEditOperations([
			{ oldText: "a\nb", newText: "c\nd\ne" },
		]);
		expect(typeof summary).toBe("string");
		expect(summary.length).toBeGreaterThan(0);
	});
});
