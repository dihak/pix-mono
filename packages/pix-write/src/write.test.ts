import { describe, expect, it } from "bun:test";
import { registerWriteTool } from "./write";

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

describe("registerWriteTool", () => {
	it("registers a tool named 'write'", () => {
		const tools: string[] = [];
		registerWriteTool(
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
		expect(tools).toEqual(["write"]);
	});
});
