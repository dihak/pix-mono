import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CursorStore, FffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	RenderContextLike,
	TextComponentCtor,
	ThemeLike,
} from "@xynogen/pix-pretty/types";
import { registerBashTool } from "./bash";

class MockTextComponent {
	private text: string;

	constructor(text = "") {
		this.text = text;
	}

	setText(value: string): void {
		this.text = value;
	}

	getText(): string {
		return this.text;
	}
}

describe("registerBashTool", () => {
	it("clamps renderCall to small terminal widths", () => {
		const registered: {
			renderCall?: (...args: unknown[]) => MockTextComponent;
		} = {};
		const origColumns = process.env.COLUMNS;
		process.env.COLUMNS = "24";
		process.stdout.emit("resize");
		process.stdin.emit("resize");

		try {
			const mockPi: PiPrettyApi = {
				registerTool(tool: unknown) {
					Object.assign(registered, tool);
				},
				registerCommand() {},
				on() {},
			};

			registerBashTool(
				mockPi,
				() => ({
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: undefined,
					}),
				}),
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

			const theme: ThemeLike = {
				fg: (_key: string, value: string) => value,
				bold: (value: string) => value,
			};
			const ctx: RenderContextLike = {
				expanded: false,
				isError: false,
				invalidate: () => {},
				state: {},
			};

			const text = registered.renderCall?.(
				{
					command: 'printf "very very very long line"\necho second\necho third',
					timeout: 30,
				},
				theme,
				ctx,
			);

			expect(text).toBeDefined();
			const rendered = text?.getText() ?? "";
			for (const line of rendered.split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(24);
			}
		} finally {
			if (origColumns === undefined) delete process.env.COLUMNS;
			else process.env.COLUMNS = origColumns;
			process.stdout.emit("resize");
			process.stdin.emit("resize");
		}
	});
});
