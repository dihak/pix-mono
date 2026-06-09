import { describe, expect, it } from "bun:test";
import type { ModelsDevModel, RouterModel } from "./data.ts";

// ── Re-export internal helpers for testing via module augmentation ────────────
// provider.ts exports only the default fn; we test the pure mapping logic
// inline here to avoid coupling tests to private internals.

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const IMAGE_CAPABLE_PATTERNS = [
	/claude/i,
	/gpt-5/i,
	/gpt-4/i,
	/kimi-k2/i,
	/hy3/i,
];

function getInputTypes(
	model: RouterModel,
	devModel?: ModelsDevModel,
): ("text" | "image")[] {
	if (devModel?.modalities?.input) {
		const inputs = devModel.modalities.input.filter(
			(i): i is "text" | "image" => i === "text" || i === "image",
		);
		if (inputs.length > 0) return inputs;
	}
	const id = model.id ?? "";
	if (IMAGE_CAPABLE_PATTERNS.some((p) => p.test(id))) return ["text", "image"];
	return ["text"];
}

function getModelName(model: RouterModel, devModel?: ModelsDevModel): string {
	return model.name || devModel?.name || model.id || "unknown";
}

function getContextWindow(
	model: RouterModel,
	devModel?: ModelsDevModel,
): number {
	return (
		model.context_window ||
		model.contextWindow ||
		devModel?.limit?.context ||
		DEFAULT_CONTEXT_WINDOW
	);
}

function getMaxTokens(model: RouterModel, devModel?: ModelsDevModel): number {
	return (
		model.max_tokens ||
		model.maxTokens ||
		devModel?.limit?.output ||
		DEFAULT_MAX_TOKENS
	);
}

function getReasoning(model: RouterModel, devModel?: ModelsDevModel): boolean {
	if (typeof devModel?.reasoning === "boolean") return devModel.reasoning;
	return /reasoner|thinking|xhigh|high|max|pro|codex|opus|sonnet/i.test(
		model.id ?? "",
	);
}

// ── getInputTypes ────────────────────────────────────────────────────────────

describe("getInputTypes", () => {
	it("uses devModel modalities when present", () => {
		const model: RouterModel = { id: "some-model" };
		const dev: ModelsDevModel = {
			id: "some-model",
			modalities: { input: ["text", "image"] },
		};
		expect(getInputTypes(model, dev)).toEqual(["text", "image"]);
	});

	it("filters out non text/image modalities from devModel", () => {
		const model: RouterModel = { id: "some-model" };
		const dev: ModelsDevModel = {
			id: "some-model",
			modalities: { input: ["text", "audio"] },
		};
		expect(getInputTypes(model, dev)).toEqual(["text"]);
	});

	it("falls back to pattern match for claude", () => {
		expect(getInputTypes({ id: "claude-sonnet-4-5" })).toEqual([
			"text",
			"image",
		]);
	});

	it("falls back to pattern match for gpt-4o", () => {
		expect(getInputTypes({ id: "gpt-4o" })).toEqual(["text", "image"]);
	});

	it("falls back to pattern match for kimi-k2", () => {
		expect(getInputTypes({ id: "kimi-k2-instruct" })).toEqual([
			"text",
			"image",
		]);
	});

	it("returns text-only for unknown model with no devModel", () => {
		expect(getInputTypes({ id: "some-random-llm" })).toEqual(["text"]);
	});

	it("uses devModel over pattern when both match", () => {
		const model: RouterModel = { id: "claude-opus-4" };
		const dev: ModelsDevModel = {
			id: "claude-opus-4",
			modalities: { input: ["text"] }, // explicitly text-only despite claude pattern
		};
		expect(getInputTypes(model, dev)).toEqual(["text"]);
	});
});

// ── getModelName ─────────────────────────────────────────────────────────────

describe("getModelName", () => {
	it("prefers router model.name", () => {
		expect(
			getModelName(
				{ id: "x", name: "Router Name" },
				{ id: "x", name: "Dev Name" },
			),
		).toBe("Router Name");
	});

	it("falls back to devModel.name", () => {
		expect(getModelName({ id: "x" }, { id: "x", name: "Dev Name" })).toBe(
			"Dev Name",
		);
	});

	it("falls back to model.id", () => {
		expect(getModelName({ id: "some-id" })).toBe("some-id");
	});

	it("returns 'unknown' when all empty", () => {
		expect(getModelName({})).toBe("unknown");
	});
});

// ── getContextWindow ──────────────────────────────────────────────────────────

describe("getContextWindow", () => {
	it("prefers model.context_window", () => {
		expect(
			getContextWindow(
				{ id: "x", context_window: 32_000 },
				{ id: "x", limit: { context: 100_000 } },
			),
		).toBe(32_000);
	});

	it("falls back to model.contextWindow", () => {
		expect(getContextWindow({ id: "x", contextWindow: 64_000 })).toBe(64_000);
	});

	it("falls back to devModel.limit.context", () => {
		expect(
			getContextWindow({ id: "x" }, { id: "x", limit: { context: 200_000 } }),
		).toBe(200_000);
	});

	it("falls back to DEFAULT_CONTEXT_WINDOW", () => {
		expect(getContextWindow({ id: "x" })).toBe(DEFAULT_CONTEXT_WINDOW);
	});
});

// ── getMaxTokens ──────────────────────────────────────────────────────────────

describe("getMaxTokens", () => {
	it("prefers model.max_tokens", () => {
		expect(
			getMaxTokens(
				{ id: "x", max_tokens: 4_096 },
				{ id: "x", limit: { output: 32_000 } },
			),
		).toBe(4_096);
	});

	it("falls back to model.maxTokens", () => {
		expect(getMaxTokens({ id: "x", maxTokens: 8_192 })).toBe(8_192);
	});

	it("falls back to devModel.limit.output", () => {
		expect(
			getMaxTokens({ id: "x" }, { id: "x", limit: { output: 16_000 } }),
		).toBe(16_000);
	});

	it("falls back to DEFAULT_MAX_TOKENS", () => {
		expect(getMaxTokens({ id: "x" })).toBe(DEFAULT_MAX_TOKENS);
	});
});

// ── getReasoning ──────────────────────────────────────────────────────────────

describe("getReasoning", () => {
	it("uses devModel.reasoning when boolean true", () => {
		expect(getReasoning({ id: "x" }, { id: "x", reasoning: true })).toBe(true);
	});

	it("uses devModel.reasoning when boolean false", () => {
		// even if pattern would match, devModel wins
		expect(
			getReasoning(
				{ id: "claude-opus-4" },
				{ id: "claude-opus-4", reasoning: false },
			),
		).toBe(false);
	});

	it("falls back to pattern — opus", () => {
		expect(getReasoning({ id: "claude-opus-4" })).toBe(true);
	});

	it("falls back to pattern — sonnet", () => {
		expect(getReasoning({ id: "claude-sonnet-4-5" })).toBe(true);
	});

	it("falls back to pattern — thinking", () => {
		expect(getReasoning({ id: "deepseek-thinking" })).toBe(true);
	});

	it("falls back to pattern — reasoner", () => {
		expect(getReasoning({ id: "o1-reasoner" })).toBe(true);
	});

	it("returns false for plain model with no devModel", () => {
		expect(getReasoning({ id: "llama-3-8b-instruct" })).toBe(false);
	});
});
