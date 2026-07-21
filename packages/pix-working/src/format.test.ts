import { expect, test } from "bun:test";
import { formatElapsed } from "./format.ts";

test("formats seconds under a minute", () => {
	expect(formatElapsed(0)).toBe("0s");
	expect(formatElapsed(5_000)).toBe("5s");
	expect(formatElapsed(59_999)).toBe("59s");
});

test("formats minutes with zero-padded seconds", () => {
	expect(formatElapsed(60_000)).toBe("1m 00s");
	expect(formatElapsed(63_000)).toBe("1m 03s");
	expect(formatElapsed(3_599_000)).toBe("59m 59s");
});

test("formats hours", () => {
	expect(formatElapsed(3_600_000)).toBe("1h 00m 00s");
	expect(formatElapsed(3_723_000)).toBe("1h 02m 03s");
});

test("clamps negative input to zero", () => {
	expect(formatElapsed(-500)).toBe("0s");
});
