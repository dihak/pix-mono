import { afterEach, describe, expect, it } from "bun:test";
import {
	envIconMode,
	getIcons,
	ICON_MODES,
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

describe("icon modes", () => {
	it("nerd is the default mode used by renderStatus", () => {
		expect(renderStatus({ rtk: true }, tag)).toContain(TOOL_ICONS.rtk);
	});

	it("renders the unicode (outline-suit) set when mode=unicode", () => {
		const icons = getIcons("unicode");
		const out = renderStatus({ caveman: true }, tag, "unicode");
		expect(out).toContain(icons.caveman);
		// outline white spade + text variation selector
		expect(icons.caveman).toBe("\u2664\uFE0E");
	});

	it("renders the ascii set when mode=ascii", () => {
		const out = renderStatus(
			{ caveman: true, rtk: false, toon: true, ponytail: false },
			tag,
			"ascii",
		);
		expect(out).toBe(
			`<accent>Cv</accent>  <dim>Rk</dim>  <accent>Tn</accent>  <dim>Pt</dim> `,
		);
	});

	it("falls back to nerd for an unknown mode", () => {
		// @ts-expect-error exercising the runtime guard in getIcons
		expect(getIcons("bogus")).toBe(getIcons("nerd"));
	});

	it("exposes exactly nerd/unicode/ascii in cycle order", () => {
		expect([...ICON_MODES]).toEqual(["nerd", "unicode", "ascii"]);
	});
});

describe("envIconMode", () => {
	const saved = { ...process.env };
	afterEach(() => {
		process.env.OPTIMIZER_ICONS = saved.OPTIMIZER_ICONS;
		process.env.PRETTY_ICONS = saved.PRETTY_ICONS;
	});

	it("defaults to nerd when nothing set", () => {
		process.env.OPTIMIZER_ICONS = undefined;
		process.env.PRETTY_ICONS = undefined;
		expect(envIconMode()).toBe("nerd");
	});

	it("OPTIMIZER_ICONS wins over PRETTY_ICONS", () => {
		process.env.OPTIMIZER_ICONS = "unicode";
		process.env.PRETTY_ICONS = "none";
		expect(envIconMode()).toBe("unicode");
	});

	it("PRETTY_ICONS=none maps to ascii", () => {
		process.env.OPTIMIZER_ICONS = undefined;
		process.env.PRETTY_ICONS = "none";
		expect(envIconMode()).toBe("ascii");
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

	it("seeds icon mode from the constructor", () => {
		const status = new OptimizerStatus("ascii");
		expect(status.mode).toBe("ascii");
		const ctx = fakeCtx();
		status.set("caveman", true, ctx as never);
		expect(ctx.calls.at(-1)!.text).toContain("Cv");
	});

	it("setMode switches the rendered glyph set and repaints", () => {
		const status = new OptimizerStatus("nerd");
		const ctx = fakeCtx();
		status.set("rtk", true, ctx as never);
		expect(ctx.calls.at(-1)!.text).toContain(TOOL_ICONS.rtk);
		status.setMode("ascii", ctx as never);
		const last = ctx.calls.at(-1)!;
		expect(last.key).toBe(STATUS_KEY);
		expect(last.text).toContain("Rk");
		expect(last.text).not.toContain(TOOL_ICONS.rtk);
	});
});
