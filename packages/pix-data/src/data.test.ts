import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	type BenchmarkEntry,
	benchmark,
	buildModelsDevIndex,
	lookupBenchmark,
	lookupInIndex,
	lookupModelsDev,
	type ModelsDevApi,
	type ModelsDevModel,
	modelsDev,
} from "./data.ts";

// ── buildModelsDevIndex ──────────────────────────────────────────────────────

describe("buildModelsDevIndex", () => {
	const api: ModelsDevApi = {
		anthropic: {
			models: {
				"claude-sonnet-4-5": {
					id: "claude-sonnet-4-5",
					name: "Claude Sonnet 4.5",
				},
				"claude-opus-4": {
					id: "claude-opus-4",
					name: "Claude Opus 4",
					reasoning: true,
				},
			},
		},
		openai: {
			models: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o",
					modalities: { input: ["text", "image"] },
				},
			},
		},
	};

	it("indexes all models by exact id", () => {
		const idx = buildModelsDevIndex(api);
		expect(idx.has("claude-sonnet-4-5")).toBe(true);
		expect(idx.has("claude-opus-4")).toBe(true);
		expect(idx.has("gpt-4o")).toBe(true);
	});

	it("indexes normalized id (strip date suffix)", () => {
		const a: ModelsDevApi = {
			anthropic: {
				models: {
					"claude-sonnet-4-5-20250514": {
						id: "claude-sonnet-4-5-20250514",
						name: "Claude Sonnet 4.5",
					},
				},
			},
		};
		const idx = buildModelsDevIndex(a);
		expect(idx.has("claude-sonnet-4-5")).toBe(true);
	});

	it("handles empty api", () => {
		expect(buildModelsDevIndex({}).size).toBe(0);
	});

	it("handles provider with no models key", () => {
		expect(buildModelsDevIndex({ anthropic: {} }).size).toBe(0);
	});

	it("preserves first-seen on id collision", () => {
		const a: ModelsDevApi = {
			a: { models: { "gpt-4o": { id: "gpt-4o", name: "First" } } },
			b: { models: { "gpt-4o": { id: "gpt-4o", name: "Second" } } },
		};
		expect(buildModelsDevIndex(a).get("gpt-4o")?.name).toBe("First");
	});
});

// ── lookupInIndex ────────────────────────────────────────────────────────────

describe("lookupInIndex", () => {
	let index: Map<string, ModelsDevModel>;

	beforeEach(() => {
		index = buildModelsDevIndex({
			anthropic: {
				models: {
					"claude-sonnet-4-5": {
						id: "claude-sonnet-4-5",
						name: "Claude Sonnet 4.5",
					},
					"claude-opus-4": { id: "claude-opus-4", name: "Claude Opus 4" },
				},
			},
			openai: {
				models: {
					"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
					"o3-mini": { id: "o3-mini", name: "o3 mini" },
				},
			},
		});
	});

	it("finds exact match", () => {
		expect(lookupInIndex("claude-sonnet-4-5", index)?.name).toBe(
			"Claude Sonnet 4.5",
		);
	});

	it("strips provider prefix (provider/model)", () => {
		expect(lookupInIndex("anthropic/claude-opus-4", index)?.name).toBe(
			"Claude Opus 4",
		);
	});

	it("strips deep prefix (cc/model)", () => {
		expect(lookupInIndex("cc/claude-opus-4", index)?.name).toBe(
			"Claude Opus 4",
		);
	});

	it("strips date suffix", () => {
		expect(lookupInIndex("claude-sonnet-4-5-20250514", index)?.name).toBe(
			"Claude Sonnet 4.5",
		);
	});

	it("strips provider prefix + date suffix", () => {
		expect(
			lookupInIndex("anthropic/claude-sonnet-4-5-20250514", index)?.name,
		).toBe("Claude Sonnet 4.5");
	});

	it("returns undefined for unknown model", () => {
		expect(lookupInIndex("nonexistent-xyz", index)).toBeUndefined();
	});

	it("finds o3-mini", () => {
		expect(lookupInIndex("o3-mini", index)?.name).toBe("o3 mini");
	});
});

// ── lookupModelsDev ───────────────────────────────────────────────────────────

describe("lookupModelsDev", () => {
	beforeEach(() => {
		// Seed in-memory cache directly
		(modelsDev as any)._mem = {
			anthropic: {
				models: {
					"claude-sonnet-4-5": {
						id: "claude-sonnet-4-5",
						name: "Claude Sonnet 4.5",
					},
				},
			},
			openai: {
				models: {
					"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
				},
			},
		};
	});

	afterEach(() => {
		(modelsDev as any)._mem = null;
	});

	it("finds by exact provider + id", () => {
		expect(lookupModelsDev("anthropic", "claude-sonnet-4-5")?.name).toBe(
			"Claude Sonnet 4.5",
		);
	});

	it("falls back across providers when provider miss", () => {
		expect(lookupModelsDev("unknown-provider", "gpt-4o")?.name).toBe("GPT-4o");
	});

	it("strips path prefix from id", () => {
		expect(
			lookupModelsDev("anthropic", "anthropic/claude-sonnet-4-5")?.name,
		).toBe("Claude Sonnet 4.5");
	});

	it("returns undefined for unknown model", () => {
		expect(lookupModelsDev("anthropic", "nonexistent-xyz")).toBeUndefined();
	});
});

// ── lookupBenchmark ───────────────────────────────────────────────────────────

describe("lookupBenchmark", () => {
	const entries: BenchmarkEntry[] = [
		{
			rank: 1,
			model: "Claude Sonnet 4.5",
			creator: "Anthropic",
			overallScore: 95,
			inputPrice: 3,
			outputPrice: 15,
		},
		{
			rank: 2,
			model: "GPT-4o",
			creator: "OpenAI",
			overallScore: 90,
			inputPrice: 5,
			outputPrice: 15,
		},
		{
			rank: 3,
			model: "Gemini 1.5 Pro",
			creator: "Google",
			overallScore: 88,
			inputPrice: 3.5,
			outputPrice: 10.5,
		},
	];

	beforeEach(() => {
		(benchmark as any)._mem = entries;
	});

	afterEach(() => {
		(benchmark as any)._mem = null;
	});

	it("finds exact match (case-insensitive, normalized)", () => {
		expect(lookupBenchmark("claude sonnet 4.5")?.rank).toBe(1);
	});

	it("finds with dashes normalized", () => {
		expect(lookupBenchmark("claude-sonnet-4-5")?.rank).toBe(1);
	});

	it("finds partial match (needle in model)", () => {
		expect(lookupBenchmark("gpt-4o")?.rank).toBe(2);
	});

	it("finds partial match (model in needle)", () => {
		expect(lookupBenchmark("gemini 1.5 pro latest")?.rank).toBe(3);
	});

	it("returns undefined for unknown model", () => {
		expect(lookupBenchmark("nonexistent-model-xyz")).toBeUndefined();
	});
});
