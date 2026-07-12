import { describe, expect, it } from "bun:test";
import {
	adviseToon,
	isUniformObjectArray,
	JSON_SYSTEM_PROMPT,
	mentionsJson,
	objectDepth,
} from "./json.ts";

describe("JSON_SYSTEM_PROMPT", () => {
	it("mentions the jq + toon pipeline", () => {
		expect(JSON_SYSTEM_PROMPT).toContain("jq");
		expect(JSON_SYSTEM_PROMPT).toContain("toon");
	});

	it("teaches both encode and decode directions", () => {
		expect(JSON_SYSTEM_PROMPT).toContain("toon -d");
	});

	it("warns to keep JSON for API contracts", () => {
		expect(JSON_SYSTEM_PROMPT.toLowerCase()).toContain("contract");
	});

	it("references the toon-json skill", () => {
		expect(JSON_SYSTEM_PROMPT).toContain("toon-json");
	});
});

describe("mentionsJson (injection gate)", () => {
	it("matches json in any case", () => {
		expect(mentionsJson("parse this JSON")).toBe(true);
		expect(mentionsJson("a Json file")).toBe(true);
		expect(mentionsJson("json blob")).toBe(true);
	});

	it("matches related tokens", () => {
		expect(mentionsJson("pipe through jq")).toBe(true);
		expect(mentionsJson("convert to toon")).toBe(true);
		expect(mentionsJson("a .jsonl dataset")).toBe(true);
		expect(mentionsJson("the openapi spec")).toBe(true);
		expect(mentionsJson("swagger doc")).toBe(true);
		expect(mentionsJson("some js object")).toBe(true);
	});

	it("does not match unrelated prompts", () => {
		expect(mentionsJson("refactor the auth module")).toBe(false);
		expect(mentionsJson("fix the bug")).toBe(false);
	});

	it("is word-bounded (no false positives inside words)", () => {
		expect(mentionsJson("adjust the layout")).toBe(false); // contains 'js'
		expect(mentionsJson("a jsx component")).toBe(false); // jsx != js
		expect(mentionsJson("jsonify is a typo")).toBe(false); // jsonify != json
	});

	it("handles empty / nullish input", () => {
		expect(mentionsJson("")).toBe(false);
		expect(mentionsJson(undefined)).toBe(false);
		expect(mentionsJson(null)).toBe(false);
	});
});

describe("isUniformObjectArray", () => {
	it("true for same-keyed flat objects", () => {
		expect(
			isUniformObjectArray([
				{ id: 1, name: "a" },
				{ id: 2, name: "b" },
			]),
		).toBe(true);
	});

	it("false for differing keys", () => {
		expect(isUniformObjectArray([{ id: 1 }, { id: 2, extra: true }])).toBe(false);
	});

	it("false when a value is itself an object", () => {
		expect(
			isUniformObjectArray([
				{ id: 1, meta: { x: 1 } },
				{ id: 2, meta: { x: 2 } },
			]),
		).toBe(false);
	});

	it("false for empty array", () => {
		expect(isUniformObjectArray([])).toBe(false);
	});

	it("false for array of primitives", () => {
		expect(isUniformObjectArray([1, 2, 3])).toBe(false);
	});
});

describe("objectDepth", () => {
	it("primitive is depth 0", () => {
		expect(objectDepth(42)).toBe(0);
		expect(objectDepth("x")).toBe(0);
	});

	it("flat object is depth 1", () => {
		expect(objectDepth({ a: 1, b: 2 })).toBe(1);
	});

	it("nested object counts each level", () => {
		expect(objectDepth({ a: { b: { c: 1 } } })).toBe(3);
	});

	it("array nesting counts too", () => {
		expect(objectDepth([{ a: [1, 2] }])).toBe(3);
	});
});

describe("adviseToon", () => {
	it("recommends TOON for uniform object arrays (sweet spot)", () => {
		const advice = adviseToon([
			{ id: 1, role: "admin" },
			{ id: 2, role: "user" },
		]);
		expect(advice.useToon).toBe(true);
		expect(advice.reason).toContain("tabular");
	});

	it("recommends TOON for primitive arrays", () => {
		expect(adviseToon([1, 2, 3]).useToon).toBe(true);
	});

	it("recommends TOON for shallow objects", () => {
		expect(adviseToon({ a: 1, b: 2 }).useToon).toBe(true);
	});

	it("rejects array of arrays (TOON's worse case)", () => {
		const advice = adviseToon([
			[1, 2],
			[3, 4],
		]);
		expect(advice.useToon).toBe(false);
		expect(advice.reason).toContain("array of arrays");
	});

	it("rejects empty array", () => {
		expect(adviseToon([]).useToon).toBe(false);
	});

	it("rejects deeply nested objects beyond maxDepth", () => {
		const deep = { a: { b: { c: { d: { e: 1 } } } } }; // depth 5
		const advice = adviseToon(deep, 4);
		expect(advice.useToon).toBe(false);
		expect(advice.reason).toContain("depth");
	});

	it("rejects non-uniform object arrays", () => {
		const advice = adviseToon([{ id: 1 }, { id: 2, extra: true }]);
		expect(advice.useToon).toBe(false);
	});

	it("rejects primitive scalars", () => {
		expect(adviseToon(42).useToon).toBe(false);
		expect(adviseToon("hi").useToon).toBe(false);
	});

	it("honours a custom maxDepth", () => {
		const d2 = { a: { b: 1 } }; // depth 2
		expect(adviseToon(d2, 1).useToon).toBe(false);
		expect(adviseToon(d2, 2).useToon).toBe(true);
	});
});
