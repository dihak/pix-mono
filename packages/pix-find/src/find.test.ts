import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@xynogen/pix-pretty/fff";
import type { PiPrettyApi, TextComponentCtor } from "@xynogen/pix-pretty/types";
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
});
