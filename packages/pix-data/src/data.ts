/**
 * data.ts — shared Pi model data layer
 *
 * Single source of truth for:
 *   - models.dev metadata  (context, cost, modalities) → ~/.cache/pi/models.json   TTL 24h
 *   - BenchLM leaderboard  (rank, score, pricing)      → ~/.cache/pi/benchlm.json  TTL 24h
 *
 * Cache files are shared across all Pi extensions — whichever extension loads
 * first populates the cache; subsequent extensions read from disk.
 *
 * Usage:
 *   import { modelsDev, benchmark } from "./data.ts";
 *
 *   const models  = await modelsDev.get();   // async, fetches if stale
 *   const entries = await benchmark.get();
 *
 *   const models  = modelsDev.getCached();   // sync, disk-only, no fetch
 *   const entries = benchmark.getCached();
 *
 *   import { lookupModelsDev, lookupBenchmark } from "./data.ts";
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelsDevModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	modalities?: { input?: string[]; output?: string[] };
	limit?: { context?: number; output?: number };
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
}

export type ModelsDevApi = Record<
	string,
	{ models?: Record<string, ModelsDevModel> }
>;

export interface BenchmarkEntry {
	rank: number;
	model: string;
	creator: string;
	sourceType?: string;
	overallScore: number | null;
	categoryScores?: Record<string, number | null>;
	inputPrice: number | null;
	outputPrice: number | null;
}

interface BenchmarkResponse {
	lastUpdated?: string;
	mode?: string;
	models: BenchmarkEntry[];
}

// ── DataSource ───────────────────────────────────────────────────────────────

interface DataSourceOptions<T> {
	url: string | (() => string);
	headers?: () => Record<string, string> | undefined;
	cachePath: string;
	ttlMs?: number;
	timeoutMs?: number;
	parse: (raw: unknown) => T;
	parseCache: (data: unknown) => T;
	empty: T;
	label: string;
	skip?: () => boolean;
}

export class DataSource<T> {
	private _mem: T | null = null;
	private _inflight: Promise<T> | null = null;
	private readonly opts: Required<DataSourceOptions<T>>;

	constructor(opts: DataSourceOptions<T>) {
		this.opts = {
			ttlMs: 24 * 60 * 60 * 1000,
			timeoutMs: 10_000,
			headers: () => undefined,
			skip: () => false,
			...opts,
		};
	}

	async get(): Promise<T> {
		if (this._inflight) return this._inflight;
		this._inflight = this._load().finally(() => {
			this._inflight = null;
		});
		return this._inflight;
	}

	getCached(): T {
		if (this._mem) return this._mem;
		try {
			if (existsSync(this.opts.cachePath)) {
				const raw = JSON.parse(readFileSync(this.opts.cachePath, "utf-8")) as {
					data: unknown;
				};
				this._mem = this.opts.parseCache(raw.data);
				return this._mem;
			}
		} catch {
			// No cache file or parse error — return empty, not fatal
		}
		return this.opts.empty;
	}

	private async _load(): Promise<T> {
		if (this.opts.skip()) {
			this._mem = this.opts.empty;
			return this.opts.empty;
		}
		const cached = await this._readCache();
		if (cached !== undefined && Date.now() - cached.ts < this.opts.ttlMs) {
			const val = this.opts.parseCache(cached.data);
			this._mem = val;
			return val;
		}
		try {
			const url =
				typeof this.opts.url === "function" ? this.opts.url() : this.opts.url;
			const response = await fetchWithTimeout(
				url,
				this.opts.timeoutMs,
				this.opts.headers(),
			);
			if (!response.ok)
				throw new Error(`${this.opts.label} fetch failed: ${response.status}`);
			const raw = await response.json();
			const val = this.opts.parse(raw);
			this._mem = val;
			void this._writeCache(raw);
			return val;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (cached !== undefined) {
				console.warn(
					`${this.opts.label} fetch failed, using stale cache: ${msg}`,
				);
				const val = this.opts.parseCache(cached.data);
				this._mem = val;
				return val;
			}
			console.warn(`${this.opts.label} unavailable: ${msg}`);
			return this.opts.empty;
		}
	}

	private async _readCache(): Promise<
		{ ts: number; data: unknown } | undefined
	> {
		try {
			const raw = await readFile(this.opts.cachePath, "utf8");
			const parsed = JSON.parse(raw) as { ts: number; data: unknown };
			if (typeof parsed.ts !== "number") return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}

	private async _writeCache(data: unknown): Promise<void> {
		try {
			await mkdir(dirname(this.opts.cachePath), { recursive: true });
			await writeFile(
				this.opts.cachePath,
				JSON.stringify({ ts: Date.now(), data }),
			);
		} catch {
			// Write failure is non-fatal — stale cache used on next run
		}
	}
}

function fetchWithTimeout(
	url: string,
	timeoutMs: number,
	headers?: Record<string, string>,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(url, { signal: controller.signal, headers }).finally(() =>
		clearTimeout(timer),
	);
}

// ── Cache dir ─────────────────────────────────────────────────────────────────

export const CACHE_DIR = join(
	process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
	"pi",
);

// ── Data sources ──────────────────────────────────────────────────────────────

export const modelsDev = new DataSource<ModelsDevApi>({
	label: "models.dev",
	url: "https://models.dev/api.json",
	cachePath: join(CACHE_DIR, "models.json"),
	parse: (raw) => raw as ModelsDevApi,
	parseCache: (data) => (data as ModelsDevApi) ?? {},
	empty: {},
});

export const benchmark = new DataSource<BenchmarkEntry[]>({
	label: "benchlm",
	url: "https://benchlm.ai/api/data/leaderboard",
	cachePath: join(CACHE_DIR, "benchlm.json"),
	parse: (raw) => (raw as BenchmarkResponse).models ?? [],
	parseCache: (data) => (data as BenchmarkResponse)?.models ?? [],
	empty: [],
});

// ── Lookup helpers ─────────────────────────────────────────────────────────────

function normalize(id: string): string {
	return id
		.toLowerCase()
		.replace(/[:@].*$/, "")
		.replace(/-\d{8}$/, "");
}

function stripPrefix(id: string): string {
	const i = id.lastIndexOf("/");
	return i >= 0 ? id.slice(i + 1) : id;
}

export function buildModelsDevIndex(
	api: ModelsDevApi,
): Map<string, ModelsDevModel> {
	const index = new Map<string, ModelsDevModel>();
	for (const provider of Object.values(api)) {
		if (!provider?.models) continue;
		for (const [modelId, model] of Object.entries(provider.models)) {
			const m: ModelsDevModel = { ...model, id: modelId };
			if (!index.has(modelId)) index.set(modelId, m);
			const norm = normalize(modelId);
			if (!index.has(norm)) index.set(norm, m);
		}
	}
	return index;
}

export function lookupInIndex(
	id: string,
	index: Map<string, ModelsDevModel>,
): ModelsDevModel | undefined {
	const stripped = stripPrefix(id);
	const direct = index.get(stripped) ?? index.get(normalize(stripped));
	if (direct) return direct;
	const norm = normalize(stripped);
	for (const [key, model] of index) {
		if (key.startsWith(norm) || norm.startsWith(key)) return model;
	}
	return undefined;
}

export function lookupModelsDev(
	provider: string,
	id: string,
): ModelsDevModel | undefined {
	const data = modelsDev.getCached();
	const canonical = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
	const exact = data[provider]?.models?.[canonical];
	if (exact) return exact;
	for (const p of Object.keys(data)) {
		const hit = data[p]?.models?.[canonical];
		if (hit) return hit;
	}
	return undefined;
}

export async function fetchModelsDevIndex(): Promise<
	Map<string, ModelsDevModel>
> {
	return buildModelsDevIndex(await modelsDev.get());
}

function normBench(s: string): string {
	return s
		.toLowerCase()
		.replace(/[-_.]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function lookupBenchmark(modelName: string): BenchmarkEntry | undefined {
	const entries = benchmark.getCached();
	const needle = normBench(modelName);
	return (
		entries.find((e) => normBench(e.model) === needle) ??
		entries.find((e) => normBench(e.model).includes(needle)) ??
		entries.find((e) => needle.includes(normBench(e.model)))
	);
}
