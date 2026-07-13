import { describe, expect, it } from "bun:test";
import type { CursorStore, FffState } from "@xynogen/pix-pretty/fff";
import type { PiPrettyApi, TextComponentCtor } from "@xynogen/pix-pretty/types";
import { applyLsDefaults, DEFAULT_LS_LIMIT, registerLsTool } from "./ls";

class MockTextComponent {
	private text = "";
	setText(v: string) {
		this.text = v;
	}
	getText() {
		return this.text;
	}
}

describe("applyLsDefaults", () => {
	it("applies a conservative default without overriding an explicit limit", () => {
		expect(applyLsDefaults({})).toEqual({ limit: DEFAULT_LS_LIMIT });
		expect(applyLsDefaults({ path: "src", limit: 12 })).toEqual({ path: "src", limit: 12 });
	});
});

describe("registerLsTool", () => {
	it("registers a tool named 'ls'", () => {
		const tools: string[] = [];
		const mockPi: PiPrettyApi = {
			registerTool(t: unknown) {
				tools.push((t as { name: string }).name);
			},
			registerCommand() {},
			on() {},
		};

		registerLsTool(mockPi, () => ({ execute: async () => ({ content: [], details: undefined }) }), {
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
		});
		expect(tools).toEqual(["ls"]);
	});
});
