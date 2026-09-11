import { describe, expect, it } from "bun:test";
import {
	BATCH_MAX_TARGETS,
	capSections,
	formatBatchIndex,
	formatCallTargets,
	resolveBatchStrings,
	sliceBatchTargets,
	withOptionalStringArray,
} from "./batch";

describe("resolveBatchStrings", () => {
	it("merges singular + array, trims, and dedupes", () => {
		expect(resolveBatchStrings(" a.ts ", ["a.ts", "b.ts", "  ", "b.ts"])).toEqual(["a.ts", "b.ts"]);
	});

	it("ignores non-strings in the array", () => {
		expect(resolveBatchStrings(undefined, ["x", 1, null, "y"] as unknown[])).toEqual(["x", "y"]);
	});
});

describe("sliceBatchTargets", () => {
	it("keeps small lists intact", () => {
		expect(sliceBatchTargets(["a", "b"])).toEqual({ targets: ["a", "b"], omitted: 0 });
	});

	it("caps at BATCH_MAX_TARGETS", () => {
		const many = Array.from({ length: BATCH_MAX_TARGETS + 3 }, (_, i) => `f${i}`);
		const sliced = sliceBatchTargets(many);
		expect(sliced.targets).toHaveLength(BATCH_MAX_TARGETS);
		expect(sliced.omitted).toBe(3);
	});
});

describe("withOptionalStringArray", () => {
	it("adds the array field and drops required keys without mutating", () => {
		const schema = {
			type: "object",
			required: ["path"],
			properties: { path: { type: "string" }, limit: { type: "number" } },
		};
		const next = withOptionalStringArray(schema, "paths", "Known files in one call.", ["path"]) as {
			required?: string[];
			properties: Record<string, unknown>;
		};
		expect(schema.required).toEqual(["path"]);
		expect(next.required).toBeUndefined();
		expect(next.properties.paths).toEqual({
			type: "array",
			items: { type: "string" },
			description: "Known files in one call.",
		});
		expect(next.properties.path).toEqual({ type: "string" });
	});
});

describe("capSections", () => {
	it("builds an index plus capped bodies", () => {
		const { index, text, sections } = capSections(
			[
				{ id: "a.ts", body: "one\ntwo", units: 2, nouns: ["line", "lines"] },
				{ id: "b.ts", body: "three", units: 1, nouns: ["line", "lines"] },
			],
			50_000,
			400,
		);
		expect(index).toBe("a.ts 2 lines · b.ts 1 line");
		expect(text).toContain("===== a.ts =====");
		expect(text).toContain("one\ntwo");
		expect(text).toContain("three");
		expect(sections.every((s) => !s.truncated)).toBe(true);
	});

	it("applies a shared unit cap across the batch", () => {
		const { index, sections } = capSections(
			[
				{ id: "a.ts", body: "1\n2\n3", units: 3, nouns: ["line", "lines"] },
				{ id: "b.ts", body: "4\n5", units: 2, nouns: ["line", "lines"] },
			],
			50_000,
			3,
		);
		expect(sections[0]?.body).toBe("1\n2\n3");
		expect(sections[1]?.body).toBe("");
		expect(sections[1]?.truncated).toBe(true);
		expect(index).toContain("b.ts truncated");
	});

	it("keeps errors in the index without a body block", () => {
		const { index, text } = capSections(
			[
				{ id: "a.ts", body: "ok", units: 1, nouns: ["line", "lines"] },
				{ id: "missing.ts", body: "", units: 0, nouns: ["line", "lines"], error: "ENOENT" },
			],
			50_000,
		);
		expect(index).toBe("a.ts 1 line · missing.ts error");
		expect(text).toContain("===== missing.ts =====\nENOENT");
	});
});

describe("formatBatchIndex / formatCallTargets", () => {
	it("summarizes call targets", () => {
		expect(formatCallTargets(["a.ts", "b.ts"])).toBe("a.ts, b.ts");
		expect(formatCallTargets(["a", "b", "c", "d"])).toBe("4 files");
		expect(formatCallTargets(["src", "lib"], 3, "dirs")).toBe("src, lib");
	});

	it("notes omitted targets", () => {
		expect(
			formatBatchIndex([{ id: "a.ts", body: "", units: 1, nouns: ["line", "lines"] }], 2),
		).toBe("a.ts 1 line · +2 omitted");
	});
});
