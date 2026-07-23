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
import { registerPixCommand } from "./pix-command.ts";

export type {
	BenchmarkEntry,
	ModelGrepModel,
	ModelsDevApi,
	ModelsDevModel,
	RegisteredModelMeta,
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
	fromRegisteredModel,
	lookupBenchmark,
	lookupInIndex,
	lookupModelsDev,
	mergeModelsDev,
	modelgrep,
	resolveModelsDev,
} from "./data.ts";

export default function (pi: ExtensionAPI): void {
	void modelgrep.get();
	void benchlm.get();
	registerPixCommand(pi);
}
