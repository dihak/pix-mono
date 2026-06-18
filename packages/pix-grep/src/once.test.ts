import { afterEach, describe, expect, it } from "bun:test";
import { once } from "./once.ts";

afterEach(() => {
	delete (globalThis as { __pixLoaded?: Set<string> }).__pixLoaded;
});

describe("once (pix-grep)", () => {
	it("runs the factory once", () => {
		let calls = 0;
		once("pix-grep", () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	it("skips repeated activation of the same key", () => {
		let calls = 0;
		const reg = () => {
			calls++;
		};
		once("pix-grep", reg);
		once("pix-grep", reg);
		expect(calls).toBe(1);
	});

	it("records the key on the shared globalThis registry", () => {
		once("pix-grep", () => {});
		expect(
			(globalThis as { __pixLoaded?: Set<string> }).__pixLoaded?.has(
				"pix-grep",
			),
		).toBe(true);
	});
});
