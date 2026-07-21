import { describe, expect, test } from "bun:test";
import { animDuration, easeOutCubic, Tween } from "./tween.ts";

describe("easeOutCubic", () => {
	test("decelerates: fast start, slow finish", () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(1)).toBe(1);
		// past the midpoint of progress by t=0.5
		expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
	});
});

describe("animDuration", () => {
	test("0→1000 lands at ~5s", () => {
		expect(animDuration(1000)).toBe(5000);
	});
	test("clamps tiny and huge jumps", () => {
		expect(animDuration(1)).toBe(400); // MIN
		expect(animDuration(100_000)).toBe(5000); // MAX
	});
});

describe("Tween", () => {
	test("eases 0→1000 over ~5s and settles exactly", () => {
		const tw = new Tween();
		tw.retarget(1000, 0);
		expect(tw.sample(0)).toBe(false);
		tw.sample(2500);
		expect(tw.value).toBeGreaterThan(500); // ahead of linear at midpoint
		expect(tw.value).toBeLessThan(1000);
		expect(tw.sample(5000)).toBe(true);
		expect(tw.value).toBe(1000);
	});

	test("re-targeting mid-flight re-anchors from current value", () => {
		const tw = new Tween();
		tw.retarget(1000, 0);
		tw.sample(1000);
		const mid = tw.value;
		tw.retarget(2000, 1000);
		expect(tw.sample(1000)).toBe(false);
		expect(tw.value).toBe(mid); // starts where it was
		expect(tw.sample(1000 + animDuration(2000 - mid))).toBe(true);
		expect(tw.value).toBe(2000);
	});

	test("no-op retarget to the same target", () => {
		const tw = new Tween();
		tw.retarget(500, 0);
		tw.sample(5000);
		tw.retarget(500, 9999);
		expect(tw.sample(9999)).toBe(true);
		expect(tw.value).toBe(500);
	});
});
