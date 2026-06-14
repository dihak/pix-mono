import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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
		const registered: { renderCall?: (...args: any[]) => MockTextComponent } =
			{};
		const origColumns = process.env.COLUMNS;
		process.env.COLUMNS = "24";
		process.stdout.emit("resize");
		process.stdin.emit("resize");

		try {
			registerBashTool(
				{
					registerTool(tool: unknown) {
						Object.assign(registered, tool);
					},
				} as any,
				() => ({
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: undefined,
					}),
				}),
				{
					cwd: process.cwd(),
					sp: (p: string) => p,
					TextComponent: MockTextComponent as any,
					fffState: {} as any,
					cursorStore: {} as any,
				},
			);

			const text = registered.renderCall?.(
				{
					command: 'printf "very very very long line"\necho second\necho third',
					timeout: 30,
				},
				{
					fg: (_key: string, value: string) => value,
					bold: (value: string) => value,
				} as any,
				{
					expanded: false,
					isError: false,
					invalidate: () => {},
					state: {},
				} as any,
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
