/**
 * data.ts — 9Router data layer
 *
 * Router-specific data only:
 *   - routerBaseUrl()  — resolved API base URL from env
 *   - routerModels     — DataSource<RouterModel[]>, cached 30m at ~/.cache/pi/9router.json
 *
 * models.dev + BenchLM data is provided by @xynogen/pix-data
 * (github.com/xynogen/pix-mono/tree/main/packages/pix-data), which shares the
 * same ~/.cache/pi/ cache directory. The DataSource implementation and the
 * models.dev index helpers live there — imported here, not duplicated.
 *
 * Environment:
 *   ROUTER_API_BASE  — override base URL (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token (required)
 */

import { join } from "node:path";
import { CACHE_DIR, DataSource } from "../../pix-data/src/index.ts";

export type { ModelsDevApi, ModelsDevModel } from "../../pix-data/src/index.ts";
// Re-export the shared models.dev API so existing consumers (provider.ts)
// can keep importing these names from "./data".
export {
	buildModelsDevIndex,
	fetchModelsDevIndex,
	lookupInIndex,
} from "../../pix-data/src/index.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouterModel {
	id?: string;
	name?: string;
	context_window?: number;
	contextWindow?: number;
	max_tokens?: number;
	maxTokens?: number;
	owned_by?: string;
}

interface RouterModelsResponse {
	data?: RouterModel[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROUTER_DEFAULT_BASE = "https://9router.example.com/v1";

export function routerBaseUrl(): string {
	return (process.env.ROUTER_API_BASE || ROUTER_DEFAULT_BASE).replace(
		/\/$/,
		"",
	);
}

// ── Router models ──────────────────────────────────────────────────────────────

export const routerModels = new DataSource<RouterModel[]>({
	label: "9router",
	url: () => `${routerBaseUrl()}/models`,
	headers: () => {
		const key = process.env.ROUTER_API_KEY;
		return key ? { Authorization: `Bearer ${key}` } : undefined;
	},
	skip: () => !process.env.ROUTER_API_KEY,
	cachePath: join(CACHE_DIR, "9router.json"),
	ttlMs: 30 * 60 * 1000, // 30 minutes
	parse: (raw) =>
		((raw as RouterModelsResponse).data ?? []).filter((m) => Boolean(m.id)),
	parseCache: (data) =>
		((data as RouterModelsResponse | undefined)?.data ?? []).filter((m) =>
			Boolean(m.id),
		),
	empty: [],
});

// ── models.dev index (read from pix-data shared cache) ────────────────────────
// fetchModelsDevIndex / buildModelsDevIndex / lookupInIndex are re-exported
// above directly from @xynogen/pix-data — they read the same shared
// ~/.cache/pi/models.json cache that pix-data warms.
