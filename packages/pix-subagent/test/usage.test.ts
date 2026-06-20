import { expect, test } from "bun:test";
import {
	addUsage,
	getLifetimeTotal,
	getSessionContextPercent,
	getSessionTokens,
} from "../src/usage.ts";

test("getLifetimeTotal sums all three fields", () => {
	expect(getLifetimeTotal({ input: 100, output: 200, cacheWrite: 50 })).toBe(
		350,
	);
});

test("getLifetimeTotal returns 0 for undefined", () => {
	expect(getLifetimeTotal(undefined)).toBe(0);
});

test("addUsage mutates target correctly", () => {
	const acc = { input: 10, output: 20, cacheWrite: 5 };
	addUsage(acc, { input: 5, output: 10, cacheWrite: 2 });
	expect(acc).toEqual({ input: 15, output: 30, cacheWrite: 7 });
});

test("getSessionTokens returns 0 when session undefined", () => {
	expect(getSessionTokens(undefined)).toBe(0);
});

test("getSessionTokens reads stats correctly", () => {
	const session = {
		getSessionStats: () => ({
			tokens: { input: 100, output: 200, cacheWrite: 50 },
		}),
	};
	expect(getSessionTokens(session)).toBe(350);
});

test("getSessionTokens returns 0 on throw", () => {
	const session = {
		getSessionStats: () => {
			throw new Error("boom");
		},
	};
	expect(getSessionTokens(session)).toBe(0);
});

test("getSessionContextPercent returns null for undefined", () => {
	expect(getSessionContextPercent(undefined)).toBeNull();
});

test("getSessionContextPercent reads percent", () => {
	const session = {
		getSessionStats: () => ({
			tokens: { input: 0, output: 0, cacheWrite: 0 },
			contextUsage: { percent: 42 },
		}),
	};
	expect(getSessionContextPercent(session)).toBe(42);
});
