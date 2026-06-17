import { describe, expect, it } from "bun:test";
import { registerFindTool } from "./find";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("registerFindTool", () => {
	it("registers a tool named 'find'", () => {
		const tools: string[] = [];
		registerFindTool(
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
		expect(tools).toEqual(["find"]);
	});
});
