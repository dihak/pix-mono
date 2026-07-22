import { describe, expect, test } from "bun:test";
import { icon } from "@dihak/pix-pretty/icon-catalog";
import {
	compactStatus,
	newTpsState,
	rebaseTps,
	renderThinkingLevel,
	stepTps,
	type TpsState,
} from "./footer.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	getThinkingBorderColor: (level: string) => (text: string) => `<${level}>${text}</${level}>`,
};

describe("renderThinkingLevel", () => {
	test("uses the host theme's canonical thinking-level renderer", () => {
		expect(renderThinkingLevel(theme, "high", "high")).toBe("<high>high</high>");
		expect(renderThinkingLevel(theme, "xhigh", "xhigh")).toBe("<xhigh>xhigh</xhigh>");
	});

	test("renders unknown levels with the neutral muted color", () => {
		const calls: string[] = [];
		const recordingTheme = {
			fg: (color: string, text: string) => {
				calls.push(color);
				return text;
			},
			getThinkingBorderColor: theme.getThinkingBorderColor,
		};
		expect(renderThinkingLevel(recordingTheme, "future", "future")).toBe("future");
		expect(calls).toEqual(["muted"]);
	});
});

describe("compactStatus", () => {
	test("compacts current pi-lens active server lists to a count", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active: json, yaml, typescript", theme)).toBe(
			`${icon("lsp")}  3`,
		);
	});

	test("preserves active and failed counts without listing server names", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active: json, yaml · LSP Failed: eslint", theme)).toBe(
			`${icon("lsp")}  2 !1`,
		);
	});

	test("keeps compatibility with the older parenthesized count", () => {
		expect(compactStatus("pi-lens-lsp", "LSP Active (4)", theme)).toBe(`${icon("lsp")}  4`);
	});
});

describe("stepTps", () => {
	test("returns null on the priming tick (no prior sample)", () => {
		const first = stepTps(newTpsState(), 0, 0);
		expect(first.tps).toBeNull();
		// Second tick now has a baseline to diff against.
		const second = stepTps(first.state, 100, 10);
		expect(second.tps).not.toBeNull();
	});

	test("converges toward a steady positive rate while tokens climb", () => {
		let state: TpsState = newTpsState();
		let tps: number | null = null;
		// 100 t/s sustained: +10 tokens every 100ms tick.
		for (let i = 0; i <= 40; i++) {
			const step = stepTps(state, i * 100, i * 10);
			state = step.state;
			tps = step.tps;
		}
		expect(tps).toBe(100);
	});

	test("first inst tick equals the raw delta rate (alpha seeds the EMA)", () => {
		const primed = stepTps(newTpsState(), 0, 0);
		// 50 tokens over 500ms → 100 t/s, EMA seeds directly to inst on first sample.
		const step = stepTps(primed.state, 500, 50);
		expect(step.tps).toBe(100);
	});

	test("decays toward 0 when token cursor is flat (tool wait / stall)", () => {
		let state: TpsState = newTpsState();
		// Prime + climb to a real rate.
		for (let i = 0; i <= 10; i++) {
			state = stepTps(state, i * 100, i * 10).state;
		}
		// Flat cursor: inst=0 each tick, EMA glides down.
		let tps: number | null = null;
		for (let i = 11; i <= 80; i++) {
			const step = stepTps(state, i * 100, 100);
			state = step.state;
			tps = step.tps;
		}
		expect(tps).toBe(0);
	});

	test("rebase absorbs the est\u2192exact cursor snap without a spike", () => {
		let state: TpsState = newTpsState();
		// Stream ~100 t/s off the char estimate.
		for (let i = 0; i <= 10; i++) {
			state = stepTps(state, i * 100, i * 10).state;
		}
		const steady = stepTps(state, 1100, 110).tps;
		expect(steady).toBe(100);
		// message_end: cursor jumps est(110)→exact(336) ~5ms later. Rebase, then the
		// next tick must NOT read a multi-thousand spike from the correction.
		state = rebaseTps(state, 1105, 336);
		const afterSnap = stepTps(state, 1205, 336).tps;
		expect(afterSnap).toBeLessThan(steady as number); // flat cursor → decaying, not spiking
	});

	test("respects a custom alpha (higher = snappier)", () => {
		const primed = stepTps(newTpsState(), 0, 0);
		// alpha=1 → pure instantaneous, no smoothing.
		const step = stepTps(primed.state, 1000, 200, 1);
		expect(step.tps).toBe(200);
	});
});
