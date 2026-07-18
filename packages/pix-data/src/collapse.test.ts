import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { type CollapseState, tickCollapse } from "./collapse.ts";
import { reloadPixConfig } from "./pix-config.ts";

describe("tickCollapse", () => {
	const originalHome = process.env.HOME;

	beforeEach(() => {
		process.env.HOME = "";
		reloadPixConfig();
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		reloadPixConfig();
	});

	test("expanded mode overrides elapsed collapse state without clearing it", () => {
		const state: CollapseState = { collapsed: true };
		expect(tickCollapse("read", state, () => {}, false)).toBe(true);
		expect(tickCollapse("read", state, () => {}, true)).toBe(false);
		expect(state.collapsed).toBe(true);
	});

	test("installs only one timer", () => {
		const setTimeoutSpy = mock(() => 1 as unknown as ReturnType<typeof setTimeout>);
		const oldSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = setTimeoutSpy as unknown as typeof setTimeout;
		try {
			const state: CollapseState = {};
			tickCollapse("read", state, () => {}, false);
			tickCollapse("read", state, () => {}, false);
			expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.setTimeout = oldSetTimeout;
		}
	});
});
