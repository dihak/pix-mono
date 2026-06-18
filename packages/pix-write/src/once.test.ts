import { afterEach, describe, expect, it } from "bun:test";
import { once } from "./once.ts";

afterEach(() => {
	delete (globalThis as { __pixLoaded?: Set<string> }).__pixLoaded;
});

describe("once (pix-write)", () => {
	it("runs the factory once", () => {
		let calls = 0;
		once("pix-write", () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	it("skips repeated activation of the same key", () => {
		let calls = 0;
		const reg = () => {
			calls++;
		};
		once("pix-write", reg);
		once("pix-write", reg);
		expect(calls).toBe(1);
	});

	it("records the key on the shared globalThis registry", () => {
		once("pix-write", () => {});
		expect(
			(globalThis as { __pixLoaded?: Set<string> }).__pixLoaded?.has(
				"pix-write",
			),
		).toBe(true);
	});
});
