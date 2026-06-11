/**
 * data.ts — model data layer (shim)
 *
 * Thin re-export of the shared data layer from @xynogen/pix-data
 * (github.com/xynogen/pix-mono/tree/main/packages/pix-data). Cache lives at
 * ~/.cache/pi/ and is shared across all Pi extensions — pix-data warms it on
 * session start; this extension reads from it.
 *
 * Consumers in this extension dir:
 *   footer.ts  — lookupModelsDev, lookupBenchmark, ModelsDevModel
 *   models.ts  — lookupModelsDev, lookupBenchmark
 */

export type {
	BenchmarkEntry,
	ModelsDevApi,
	ModelsDevModel,
} from "@xynogen/pix-data";
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
} from "@xynogen/pix-data";

export default function (_pi: unknown): void {
	// pix-data warms this cache on startup — nothing to do here.
}
