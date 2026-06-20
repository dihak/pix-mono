import { expect, test } from "bun:test";
import { resolveModel } from "../src/model-resolver.ts";

const registry = {
	find: (p: string, id: string) => ({ provider: p, id, name: id }),
	getAll: () => [
		{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
		{ provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
	],
};

test("exact provider/id resolves", () => {
	const m = resolveModel("anthropic/claude-haiku-4-5", registry);
	expect(typeof m).not.toBe("string");
	expect((m as { id: string }).id).toBe("claude-haiku-4-5");
});

test("fuzzy 'haiku' resolves to the haiku model", () => {
	const m = resolveModel("haiku", registry);
	expect((m as { id: string }).id).toBe("claude-haiku-4-5");
});

test("no match returns an error string listing available models", () => {
	const r = resolveModel("gpt-9", registry);
	expect(typeof r).toBe("string");
	expect(r as string).toContain("anthropic/claude-haiku-4-5");
});
