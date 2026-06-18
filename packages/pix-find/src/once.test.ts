import { afterEach, describe, expect, it } from "bun:test";
import { once } from "./once.ts";

afterEach(() => {
	delete (globalThis as { __pixLoaded?: Set<string> }).__pixLoaded;
});

describe("once (pix-find)", () => {
	it("runs the factory once", () => {
		let calls = 0;
		once("pix-find", () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	it("skips repeated activation of the same key", () => {
		let calls = 0;
		const reg = () => {
			calls++;
		};
		once("pix-find", reg);
		once("pix-find", reg);
		expect(calls).toBe(1);
	});

	it("records the key on the shared globalThis registry", () => {
		once("pix-find", () => {});
		expect(
			(globalThis as { __pixLoaded?: Set<string> }).__pixLoaded?.has(
				"pix-find",
			),
		).toBe(true);
	});
});
