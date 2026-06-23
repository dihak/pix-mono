import { describe, expect, it } from "bun:test";

import { parseDiff } from "./diff.js";

const OLD = "line1\nline2\nline3";
const NEW = "line1\nCHANGED\nline3";

describe("parseDiff baseLine", () => {
	it("is snippet-relative when baseLine omitted (default 0)", () => {
		const { lines } = parseDiff(OLD, NEW);
		const del = lines.find((l) => l.type === "del");
		expect(del?.oldNum).toBe(2); // line2 is the 2nd line of the snippet
	});

	it("shifts gutter numbers to absolute when baseLine given", () => {
		// Snippet begins at file line 84 → snippet line 2 becomes file line 85.
		const { lines } = parseDiff(OLD, NEW, 3, 84);
		const del = lines.find((l) => l.type === "del");
		const add = lines.find((l) => l.type === "add");
		expect(del?.oldNum).toBe(85);
		expect(add?.newNum).toBe(85);
	});
});
