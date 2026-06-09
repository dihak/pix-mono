/**
 * data.ts — 9Router data layer
 *
 * Router-specific data only:
 *   - routerBaseUrl()  — resolved API base URL from env
 *   - routerModels     — DataSource<RouterModel[]>, cached 30m at ~/.cache/pi/9router.json
 *
 * models.dev + BenchLM data is provided by pix-data (github.com/xynogen/pix-data),
 * which shares the same ~/.cache/pi/ cache directory.
 *
 * Environment:
 *   ROUTER_API_BASE  — override base URL (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token (required)
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

// Re-export ModelsDevModel for provider.ts — sourced from pix-data at runtime
// via shared cache; typed here to avoid a hard import dependency.
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

interface RouterModelsResponse {
	data?: RouterModel[];
}

// ── DataSource (minimal, router-only) ────────────────────────────────────────

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

class DataSource<T> {
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
			// No cache file or parse error — return empty
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
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
			const response = await fetch(url, {
				signal: controller.signal,
				headers: this.opts.headers(),
			}).finally(() => clearTimeout(timer));
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
			// Write failure is non-fatal
		}
	}
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_DIR = join(
	process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
	"pi",
);

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

const modelsDevCache = new DataSource<ModelsDevApi>({
	label: "models.dev",
	url: "https://models.dev/api.json",
	cachePath: join(CACHE_DIR, "models.json"),
	parse: (raw) => raw as ModelsDevApi,
	parseCache: (data) => (data as ModelsDevApi) ?? {},
	empty: {},
});

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

export async function fetchModelsDevIndex(): Promise<
	Map<string, ModelsDevModel>
> {
	return buildModelsDevIndex(await modelsDevCache.get());
}
