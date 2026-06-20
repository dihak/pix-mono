import { describe, expect, it } from "bun:test";
import {
	OptimizerStatus,
	renderStatus,
	STATUS_KEY,
	TOOL_ICONS,
} from "./status.ts";

/** Tagging colorizer: <accent>X</accent> / <dim>X</dim> for assertions. */
const tag = (c: string, t: string) => `<${c}>${t}</${c}>`;

describe("renderStatus", () => {
	it("shows ALL icons in order, accent when enabled", () => {
		expect(
			renderStatus(
				{ caveman: true, rtk: true, toon: true, ponytail: true },
				tag,
			),
		).toBe(
			`<accent>${TOOL_ICONS.caveman}</accent>  <accent>${TOOL_ICONS.rtk}</accent>  <accent>${TOOL_ICONS.toon}</accent>  <accent>${TOOL_ICONS.ponytail}</accent> `,
		);
	});

	it("dims disabled tools but still shows them", () => {
		expect(
			renderStatus(
				{ caveman: false, rtk: true, toon: true, ponytail: true },
				tag,
			),
		).toBe(
			`<dim>${TOOL_ICONS.caveman}</dim>  <accent>${TOOL_ICONS.rtk}</accent>  <accent>${TOOL_ICONS.toon}</accent>  <accent>${TOOL_ICONS.ponytail}</accent> `,
		);
	});

	it("all dim when nothing enabled (cell never empty)", () => {
		expect(renderStatus({}, tag)).toBe(
			`<dim>${TOOL_ICONS.caveman}</dim>  <dim>${TOOL_ICONS.rtk}</dim>  <dim>${TOOL_ICONS.toon}</dim>  <dim>${TOOL_ICONS.ponytail}</dim> `,
		);
	});

	it("preserves fixed order regardless of insertion order", () => {
		expect(renderStatus({ toon: true, caveman: true }, tag)).toBe(
			`<accent>${TOOL_ICONS.caveman}</accent>  <dim>${TOOL_ICONS.rtk}</dim>  <accent>${TOOL_ICONS.toon}</accent>  <dim>${TOOL_ICONS.ponytail}</dim> `,
		);
	});
});

describe("OptimizerStatus", () => {
	/** Minimal ui stub capturing setStatus calls. */
	function fakeCtx() {
		const calls: { key: string; text: string }[] = [];
		return {
			calls,
			ui: {
				setStatus: (key: string, text: string | undefined) =>
					calls.push({ key, text: text ?? "" }),
				theme: { fg: (c: string, t: string) => `<${c}>${t}</${c}>` },
			},
		} as const;
	}

	it("paints the shared key with per-icon accent/dim", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("rtk", true, ctx as never);
		const last = ctx.calls.at(-1)!;
		expect(last.key).toBe(STATUS_KEY);
		// caveman + toon + ponytail still unset (dim), rtk accent.
		expect(last.text).toBe(
			`<dim>${TOOL_ICONS.caveman}</dim>  <accent>${TOOL_ICONS.rtk}</accent>  <dim>${TOOL_ICONS.toon}</dim>  <dim>${TOOL_ICONS.ponytail}</dim> `,
		);
	});

	it("accumulates state across tools", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("caveman", true, ctx as never);
		status.set("toon", true, ctx as never);
		const last = ctx.calls.at(-1)!;
		expect(last.text).toBe(
			`<accent>${TOOL_ICONS.caveman}</accent>  <dim>${TOOL_ICONS.rtk}</dim>  <accent>${TOOL_ICONS.toon}</accent>  <dim>${TOOL_ICONS.ponytail}</dim> `,
		);
	});

	it("dims an icon when its tool toggles off (cell stays populated)", () => {
		const status = new OptimizerStatus();
		const ctx = fakeCtx();
		status.set("rtk", true, ctx as never);
		status.set("rtk", false, ctx as never);
		const last = ctx.calls.at(-1)!;
		expect(last.text).toBe(
			`<dim>${TOOL_ICONS.caveman}</dim>  <dim>${TOOL_ICONS.rtk}</dim>  <dim>${TOOL_ICONS.toon}</dim>  <dim>${TOOL_ICONS.ponytail}</dim> `,
		);
	});
});
