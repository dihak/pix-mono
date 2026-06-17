import { describe, expect, it } from "bun:test";
import { registerReadTool } from "./read";

class MockTextComponent {
	private text = "";
	constructor(_t = "", _x = 0, _y = 0) {}
	setText(v: string) { this.text = v; }
	getText() { return this.text; }
}

describe("registerReadTool", () => {
	it("registers a tool named 'read'", () => {
		const tools: string[] = [];
		registerReadTool(
			{ registerTool: (t: any) => tools.push(t.name) } as any,
			() => ({ execute: async () => ({ content: [] }) }) as any,
			{
				cwd: process.cwd(),
				sp: (p: string) => p,
				TextComponent: MockTextComponent as any,
				fffState: {} as any,
				cursorStore: {} as any,
			},
		);
		expect(tools).toEqual(["read"]);
	});
});
