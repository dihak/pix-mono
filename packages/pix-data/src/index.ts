/**
 * pix-data — Pi extension
 *
 * Warms the shared model data cache on session start so other extensions
 * (pix-9router, models picker, footer) can read from ~/.cache/pi/* synchronously.
 *
 * Two non-blocking fetches (modelgrep catalog + BenchLM scores) — Pi session
 * starts immediately; consumers read whichever cache file they need.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { benchlm, modelgrep } from "./data.ts";

export type {
	BenchmarkEntry,
	ModelGrepModel,
	ModelsDevApi,
	ModelsDevModel,
} from "./data.ts";
// Public data API — single source of truth for the shared model data layer.
// Consumers (pix-core, pix-9router, …) import these instead of duplicating
// the DataSource implementation and models.dev/BenchLM lookups.
export {
	benchlm,
	benchScoreColor,
	buildModelsDevIndex,
	CACHE_DIR,
	DataSource,
	fetchModelsDevIndex,
	lookupBenchmark,
	lookupInIndex,
	lookupModelsDev,
	modelgrep,
} from "./data.ts";

export default function (_pi: ExtensionAPI): void {
	void modelgrep.get();
	void benchlm.get();
}
