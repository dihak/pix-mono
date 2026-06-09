import { describe, expect, it } from "bun:test";
import { benchStars, fmtCost, fmtCtx, sortModels } from "./models.ts";

describe("fmtCtx", () => {
	it("formats 0 as 0", () => expect(fmtCtx(0)).toBe("0"));
	it("formats small numbers as-is", () => expect(fmtCtx(512)).toBe("512"));
	it("formats thousands as Nk", () => {
		expect(fmtCtx(128_000)).toBe("128k");
		expect(fmtCtx(8_192)).toBe("8k");
	});
	it("formats millions as NM", () => {
		expect(fmtCtx(1_000_000)).toBe("1M");
		expect(fmtCtx(2_000_000)).toBe("2M");
		expect(fmtCtx(1_500_000)).toBe("1.5M");
	});
});

describe("fmtCost", () => {
	it("returns — for undefined entry", () =>
		expect(fmtCost(undefined)).toBe("—"));
	it("returns — when no cost field", () => expect(fmtCost({})).toBe("—"));
	it("returns free when both 0", () => {
		expect(fmtCost({ cost: { input: 0, output: 0 } })).toBe("free");
	});
	it("formats input/output costs", () => {
		expect(fmtCost({ cost: { input: 3, output: 15 } })).toBe("3.00/15.00");
	});
	it("handles missing input/output as 0", () => {
		expect(fmtCost({ cost: {} })).toBe("free");
	});
});

describe("benchStars", () => {
	it("gives 5 stars for score >= 90", () => {
		expect(benchStars(95).filled).toBe(5);
		expect(benchStars(90).filled).toBe(5);
	});
	it("gives 4 stars for 80-89", () => {
		expect(benchStars(85).filled).toBe(4);
		expect(benchStars(80).filled).toBe(4);
	});
	it("gives 3 stars for 70-79", () => {
		expect(benchStars(75).filled).toBe(3);
	});
	it("gives 2 stars for 50-69", () => {
		expect(benchStars(60).filled).toBe(2);
		expect(benchStars(50).filled).toBe(2);
	});
	it("gives 1 star for score < 50", () => {
		expect(benchStars(30).filled).toBe(1);
		expect(benchStars(0).filled).toBe(1);
	});
	it("gives 1 star for null/undefined", () => {
		expect(benchStars(null).filled).toBe(1);
		expect(benchStars(undefined).filled).toBe(1);
	});
	it("filled + empty always = 5", () => {
		for (const s of [0, 50, 70, 80, 90, 100]) {
			const { filled, empty } = benchStars(s);
			expect(filled + empty).toBe(5);
		}
	});
});

describe("sortModels", () => {
	const models = [
		{ provider: "a", id: "m1", name: "Zebra", score: 80 },
		{ provider: "a", id: "m2", name: "Alpha", score: 95 },
		{ provider: "a", id: "m3", name: "Middle", score: null },
		{ provider: "a", id: "m4", name: "Beta", score: 80 },
	];

	it("sorts by score descending", () => {
		const sorted = sortModels(models);
		expect(sorted[0].name).toBe("Alpha"); // score 95
	});

	it("breaks score ties alphabetically by name", () => {
		const sorted = sortModels(models);
		const tiedIdx = sorted.findIndex((m) => m.name === "Beta");
		const zebraIdx = sorted.findIndex((m) => m.name === "Zebra");
		expect(tiedIdx).toBeLessThan(zebraIdx); // Beta before Zebra, both score 80
	});

	it("puts null score models last", () => {
		const sorted = sortModels(models);
		expect(sorted[sorted.length - 1].name).toBe("Middle");
	});

	it("does not mutate the original array", () => {
		const original = [...models];
		sortModels(models);
		expect(models).toEqual(original);
	});
});
