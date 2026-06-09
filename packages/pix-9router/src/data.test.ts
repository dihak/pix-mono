import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	buildModelsDevIndex,
	lookupInIndex,
	type ModelsDevApi,
	type ModelsDevModel,
	routerBaseUrl,
} from "./data.ts";

// ── routerBaseUrl ────────────────────────────────────────────────────────────

describe("routerBaseUrl", () => {
	const ORIGINAL = process.env.ROUTER_API_BASE;

	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.ROUTER_API_BASE;
		else process.env.ROUTER_API_BASE = ORIGINAL;
	});

	it("returns default when env unset", () => {
		delete process.env.ROUTER_API_BASE;
		expect(routerBaseUrl()).toBe("https://9router.example.com/v1");
	});

	it("uses ROUTER_API_BASE when set", () => {
		process.env.ROUTER_API_BASE = "https://my.router.dev/v1";
		expect(routerBaseUrl()).toBe("https://my.router.dev/v1");
	});

	it("strips trailing slash", () => {
		process.env.ROUTER_API_BASE = "https://my.router.dev/v1/";
		expect(routerBaseUrl()).toBe("https://my.router.dev/v1");
	});
});

// ── buildModelsDevIndex ──────────────────────────────────────────────────────

describe("buildModelsDevIndex", () => {
	const api: ModelsDevApi = {
		anthropic: {
			models: {
				"claude-sonnet-4-5": {
					id: "claude-sonnet-4-5",
					name: "Claude Sonnet 4.5",
					reasoning: false,
					limit: { context: 200_000, output: 8_192 },
					cost: { input: 3, output: 15 },
				},
				"claude-opus-4": {
					id: "claude-opus-4",
					name: "Claude Opus 4",
					reasoning: true,
					limit: { context: 200_000, output: 32_000 },
					cost: { input: 15, output: 75 },
				},
			},
		},
		openai: {
			models: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o",
					modalities: { input: ["text", "image"], output: ["text"] },
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

	it("indexes normalized ids (strip date suffix)", () => {
		const apiWithDate: ModelsDevApi = {
			anthropic: {
				models: {
					"claude-sonnet-4-5-20250514": {
						id: "claude-sonnet-4-5-20250514",
						name: "Claude Sonnet 4.5",
					},
				},
			},
		};
		const idx = buildModelsDevIndex(apiWithDate);
		// normalized: strip -20250514
		expect(idx.has("claude-sonnet-4-5")).toBe(true);
	});

	it("handles empty api gracefully", () => {
		const idx = buildModelsDevIndex({});
		expect(idx.size).toBe(0);
	});

	it("handles provider with no models key", () => {
		const idx = buildModelsDevIndex({ anthropic: {} });
		expect(idx.size).toBe(0);
	});

	it("preserves first-seen on id collision", () => {
		const collide: ModelsDevApi = {
			a: { models: { "gpt-4o": { id: "gpt-4o", name: "First" } } },
			b: { models: { "gpt-4o": { id: "gpt-4o", name: "Second" } } },
		};
		const idx = buildModelsDevIndex(collide);
		expect(idx.get("gpt-4o")?.name).toBe("First");
	});
});

// ── lookupInIndex ────────────────────────────────────────────────────────────

describe("lookupInIndex", () => {
	let index: Map<string, ModelsDevModel>;

	beforeEach(() => {
		const api: ModelsDevApi = {
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
		};
		index = buildModelsDevIndex(api);
	});

	it("finds exact match", () => {
		expect(lookupInIndex("claude-sonnet-4-5", index)?.name).toBe(
			"Claude Sonnet 4.5",
		);
	});

	it("finds by stripping provider prefix (router style: provider/model)", () => {
		expect(lookupInIndex("anthropic/claude-opus-4", index)?.name).toBe(
			"Claude Opus 4",
		);
	});

	it("finds with deep prefix e.g. cc/claude-opus-4", () => {
		expect(lookupInIndex("cc/claude-opus-4", index)?.name).toBe(
			"Claude Opus 4",
		);
	});

	it("finds with date suffix stripped", () => {
		expect(lookupInIndex("claude-sonnet-4-5-20250514", index)?.name).toBe(
			"Claude Sonnet 4.5",
		);
	});

	it("finds with provider prefix + date suffix", () => {
		expect(
			lookupInIndex("anthropic/claude-sonnet-4-5-20250514", index)?.name,
		).toBe("Claude Sonnet 4.5");
	});

	it("returns undefined for unknown model", () => {
		expect(lookupInIndex("nonexistent-model-xyz", index)).toBeUndefined();
	});

	it("finds gpt-4o exact", () => {
		expect(lookupInIndex("gpt-4o", index)?.name).toBe("GPT-4o");
	});

	it("finds o3-mini exact", () => {
		expect(lookupInIndex("o3-mini", index)?.name).toBe("o3 mini");
	});
});
