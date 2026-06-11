/**
 * pix-data — Pi extension
 *
 * Warms the shared model data cache on session start so other extensions
 * (pix-9router, models picker, footer) can read from ~/.cache/pi/* synchronously.
 *
 * Fetches in parallel, non-blocking — Pi session starts immediately.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { benchmark, modelsDev } from "./data.ts";

export type {
	BenchmarkEntry,
	ModelsDevApi,
	ModelsDevModel,
} from "./data.ts";
// Public data API — single source of truth for the shared model data layer.
// Consumers (pix-core, pix-9router, …) import these instead of duplicating
// the DataSource implementation and models.dev/BenchLM lookups.
export {
	benchmark,
	buildModelsDevIndex,
	CACHE_DIR,
	DataSource,
	fetchModelsDevIndex,
	lookupBenchmark,
	lookupInIndex,
	lookupModelsDev,
	modelsDev,
} from "./data.ts";

export default function (_pi: ExtensionAPI): void {
	void modelsDev.get();
	void benchmark.get();
}
