/**
 * provider.ts — 9Router model provider
 *
 * Registers the "9router" provider in Pi, pulling live model list from the
 * router API. Falls back to an empty model list if ROUTER_API_KEY is unset.
 *
 * Environment:
 *   ROUTER_API_BASE  — override API base URL (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token (required for live model list)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModelsDevModel, RouterModel } from "./data.js";
import {
	fetchModelsDevIndex,
	lookupInIndex,
	routerBaseUrl,
	routerModels,
} from "./data.js";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const ZERO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

// Fallback pattern-based detection if models.dev lookup fails
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

export default async function registerProvider(
	pi: ExtensionAPI,
): Promise<void> {
	const apiKey = process.env.ROUTER_API_KEY;

	if (!apiKey) {
		// Register shell provider so the name is known; no models available yet.
		pi.registerProvider("9router", {
			name: "9Router",
			baseUrl: routerBaseUrl(),
			apiKey: "$ROUTER_API_KEY",
			api: "openai-completions",
			models: [],
		});
		return;
	}

	const [models, devIndex] = await Promise.all([
		routerModels.get(),
		fetchModelsDevIndex().catch(() => new Map<string, ModelsDevModel>()),
	]);

	// Upstream moved OpenAI `compat` settings from the provider level to the
	// per-model level (ProviderModelConfig.compat). Apply the same shim to every
	// registered model.
	const COMPAT = {
		supportsDeveloperRole: false,
		supportsUsageInStreaming: false,
		maxTokensField: "max_tokens",
	} as const;

	pi.registerProvider("9router", {
		name: "9Router",
		baseUrl: routerBaseUrl(),
		apiKey: "$ROUTER_API_KEY",
		api: "openai-completions",
		headers: { "User-Agent": "pi-coding-agent" },
		models: models.map((model) => {
			const devModel = lookupInIndex(model.id!, devIndex);
			return {
				id: model.id!,
				name: getModelName(model, devModel),
				reasoning: getReasoning(model, devModel),
				input: getInputTypes(model, devModel),
				cost: ZERO_COST,
				contextWindow: getContextWindow(model, devModel),
				maxTokens: getMaxTokens(model, devModel),
				compat: COMPAT,
			};
		}),
	});
}
