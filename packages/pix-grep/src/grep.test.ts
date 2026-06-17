import { describe, expect, it } from "bun:test";
import { registerGrepTool } from "./grep";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("registerGrepTool", () => {
	it("registers a tool named 'grep'", () => {
		const tools: string[] = [];
		registerGrepTool(
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
		expect(tools).toEqual(["grep"]);
	});
});
