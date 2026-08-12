/**
 * fuzzy-file-autocomplete — project-wide fuzzy file finder for the Pi editor.
 *
 *   - Fuzzy match on paths relative to the session cwd
 *   - Respects .gitignore (fd / FFF defaults)
 *   - Prefer FFF when pix-grep has indexed the tree (frecency-ranked)
 *   - Fall back to `fd` (same family as Pi built-in @ complete)
 *
 * Triggers:
 *   - `@query` / `@"query` attachments
 *   - Tab force-complete when not in a bare slash-command token
 *   - Path-like tokens (`./`, `../`, `~/`, contains `/`, empty after space)
 *   - Bare word tokens on Tab (e.g. `handler` + Tab → project-wide matches)
 *
 * Slash-command names stay on the base provider; commands with custom
 * argument completers still win when they return items.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { fffState } from "@dihak/pix-pretty/fff";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

export const MAX_FUZZY_FILE_RESULTS = 20;
/** Cap on paths collected from fd before local / fzf ranking */
export const FD_LIST_MAX = 8_000;

/** Always skip these even when cwd is not a git repo (no .gitignore). */
export const DEFAULT_FD_EXCLUDES = [
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"coverage",
	"target",
	"vendor",
	"__pycache__",
	".venv",
	"venv",
	".bun",
	".npm",
];

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
/** Path punctuation skippable between query chars (myappconfig → my-app-config) */
const SKIPPABLE_IN_CANDIDATE = /[-_./\\]/;

export type FileHit = {
	/** Path relative to cwd (display form, `/` separators) */
	relativePath: string;
	fileName: string;
};

export type FuzzyFileSearchDeps = {
	getCwd: () => string;
	/** Resolve fd binary; may be async on first call */
	getFdPath: () => string | null | Promise<string | null>;
	/** Resolve fzf binary for `--filter` ranking; optional */
	getFzfPath?: () => string | null | Promise<string | null>;
	/** Optional override for tests; default reads shared fffState */
	searchFff?: (query: string, limit: number) => FileHit[] | null;
	/** Optional override for tests — full candidate search path */
	searchFd?: (
		query: string,
		cwd: string,
		fdPath: string,
		limit: number,
		signal: AbortSignal,
		fzfPath?: string | null,
	) => Promise<FileHit[]>;
};

/** cwd → listed paths (fd), short-lived so new files show up */
const listCache = new Map<string, { at: number; hits: FileHit[] }>();
const LIST_CACHE_TTL_MS = 15_000;

export function clearFuzzyFileListCache(): void {
	listCache.clear();
}

// ── token extraction ──────────────────────────────────────────────────

function toDisplayPath(value: string): string {
	return value.replace(/\\/g, "/");
}

function findLastDelimiter(text: string): number {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) return i;
	}
	return -1;
}

function isTokenStart(text: string, index: number): boolean {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

function findUnclosedQuoteStart(text: string): number | null {
	let inQuotes = false;
	let quoteStart = -1;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '"') {
			inQuotes = !inQuotes;
			if (inQuotes) quoteStart = i;
		}
	}
	return inQuotes ? quoteStart : null;
}

function extractQuotedPrefix(text: string): string | null {
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart === null) return null;
	if (quoteStart > 0 && text[quoteStart - 1] === "@") {
		if (!isTokenStart(text, quoteStart - 1)) return null;
		return text.slice(quoteStart - 1);
	}
	if (!isTokenStart(text, quoteStart)) return null;
	return text.slice(quoteStart);
}

export type PathToken = {
	/** Full token text to replace on accept (includes @ / quotes) */
	prefix: string;
	/** Bare path/query without @ or opening quote */
	rawQuery: string;
	isAt: boolean;
	isQuoted: boolean;
};

/** Parse @ / " / plain path token at end of text before cursor. */
export function extractPathToken(textBeforeCursor: string): PathToken | null {
	const quoted = extractQuotedPrefix(textBeforeCursor);
	if (quoted?.startsWith('@"')) {
		return {
			prefix: quoted,
			rawQuery: quoted.slice(2),
			isAt: true,
			isQuoted: true,
		};
	}
	if (quoted?.startsWith('"')) {
		return {
			prefix: quoted,
			rawQuery: quoted.slice(1),
			isAt: false,
			isQuoted: true,
		};
	}

	const lastDelim = findLastDelimiter(textBeforeCursor);
	const tokenStart = lastDelim === -1 ? 0 : lastDelim + 1;
	const token = textBeforeCursor.slice(tokenStart);
	if (!token && textBeforeCursor.endsWith(" ")) {
		return { prefix: "", rawQuery: "", isAt: false, isQuoted: false };
	}
	if (!token) return null;

	if (token.startsWith("@")) {
		return {
			prefix: token,
			rawQuery: token.slice(1),
			isAt: true,
			isQuoted: false,
		};
	}

	return {
		prefix: token,
		rawQuery: token,
		isAt: false,
		isQuoted: false,
	};
}

/** True when the cursor is on a bare `/command` name (not file path, not args). */
export function isBareSlashCommand(textBeforeCursor: string): boolean {
	const trimmed = textBeforeCursor.trimStart();
	if (!trimmed.startsWith("/")) return false;
	const after = trimmed.slice(1);
	// Absolute paths (extra "/") are not slash commands
	if (after.includes("/")) return false;
	// No space → still typing command name
	return !trimmed.includes(" ");
}

/**
 * Whether this token should use project-wide fuzzy find.
 * Slash-command names are excluded.
 */
export function shouldFuzzyFileComplete(
	textBeforeCursor: string,
	options: { force?: boolean },
): PathToken | null {
	if (isBareSlashCommand(textBeforeCursor)) return null;

	const token = extractPathToken(textBeforeCursor);
	if (!token) return null;

	if (token.isAt) return token;
	if (token.isQuoted) return token;

	const q = token.rawQuery;
	const pathLike =
		q.includes("/") || q.startsWith(".") || q.startsWith("~/") || q === "~" || q === "";

	// Tab/force: any token (including bare filename fragment)
	if (options.force) return token;

	// Natural typing: only path-like / @ (keeps random prose from opening the menu)
	if (pathLike) return token;

	return null;
}

// ── query normalization ───────────────────────────────────────────────

/** Strip ./ ~/ and cwd-absolute prefix into a cwd-relative search query. */
export function normalizeSearchQuery(rawQuery: string, cwd: string): string {
	let q = toDisplayPath(rawQuery);
	if (q === "~") return "";
	if (q.startsWith("~/")) q = q.slice(2);
	else if (q.startsWith("/") && cwd !== "/") {
		const prefix = `${toDisplayPath(cwd).replace(/\/+$/, "")}/`;
		if (q.startsWith(prefix)) q = q.slice(prefix.length);
	} else if (q.startsWith("./")) q = q.slice(2);
	return q;
}

// ── result formatting ─────────────────────────────────────────────────

export function buildFileCompletionValue(
	relativePath: string,
	opts: { isAt: boolean; isQuoted: boolean },
): string {
	const path = toDisplayPath(relativePath);
	const needsQuotes = opts.isQuoted || path.includes(" ");
	const at = opts.isAt ? "@" : "";
	if (!needsQuotes) return `${at}${path}`;
	return `${at}"${path}"`;
}

export function hitsToAutocompleteItems(hits: FileHit[], token: PathToken): AutocompleteItem[] {
	return hits.map((hit) => {
		const value = buildFileCompletionValue(hit.relativePath, {
			isAt: token.isAt,
			isQuoted: token.isQuoted,
		});
		return {
			value,
			label: hit.fileName,
			description: toDisplayPath(hit.relativePath),
		};
	});
}

// ── search backends ───────────────────────────────────────────────────

export function searchWithFff(query: string, limit: number): FileHit[] | null {
	const finder = fffState.finder;
	if (!finder || finder.isDestroyed) return null;
	try {
		const result = finder.fileSearch(query, { pageSize: Math.max(limit, 50) });
		if (!result.ok) return null;
		const items = result.value.items.map((item) => ({
			relativePath: item.relativePath,
			fileName: item.fileName || basename(item.relativePath),
		}));
		// FFF already ranks; still drop non-matches if query is non-empty
		if (!query) return items.slice(0, limit);
		const scored = items
			.map((hit) => ({ hit, score: scoreHit(hit, query) }))
			.filter((x) => x.score > 0)
			.sort((a, b) => b.score - a.score);
		// If FFF returned rows but none pass local fuzzy (rare), trust FFF order
		if (scored.length === 0) return items.slice(0, limit);
		return scored.slice(0, limit).map((x) => x.hit);
	} catch {
		return null;
	}
}

function lineToHit(line: string): FileHit | null {
	const display = toDisplayPath(line.trim());
	if (!display) return null;
	const hasTrailing = display.endsWith("/");
	const path = hasTrailing ? display.slice(0, -1) : display;
	if (path === ".git" || path.startsWith(".git/") || path.includes("/.git/")) return null;
	return {
		relativePath: path,
		fileName: basename(path) + (hasTrailing ? "/" : ""),
	};
}

function parseFdStdout(stdout: string): FileHit[] {
	const hits: FileHit[] = [];
	for (const line of stdout.split("\n")) {
		const hit = lineToHit(line);
		if (hit) hits.push(hit);
	}
	return hits;
}

/** Build fd args for a full project listing (gitignore when present + hard excludes). */
export function buildFdListArgs(cwd: string, maxResults = FD_LIST_MAX): string[] {
	const args = [
		"--base-directory",
		cwd,
		"--max-results",
		String(maxResults),
		"--type",
		"f",
		"--type",
		"d",
		// Do not --follow: symlinks into huge trees stall the list under @ autocomplete debounce.
		"--hidden",
	];
	for (const name of DEFAULT_FD_EXCLUDES) {
		args.push("--exclude", name);
	}
	return args;
}

/** List files+dirs under cwd via fd (no query filter). Cached briefly per cwd. */
export async function listProjectPaths(
	cwd: string,
	fdPath: string,
	signal: AbortSignal,
	maxResults = FD_LIST_MAX,
): Promise<FileHit[]> {
	const cached = listCache.get(cwd);
	if (cached && Date.now() - cached.at < LIST_CACHE_TTL_MS) {
		return cached.hits;
	}

	const args = buildFdListArgs(cwd, maxResults);

	const hits = await new Promise<FileHit[]>((resolve) => {
		if (signal.aborted) {
			resolve([]);
			return;
		}
		const child = spawn(fdPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let stdout = "";
		let resolved = false;
		const finish = (results: FileHit[]) => {
			if (resolved) return;
			resolved = true;
			signal.removeEventListener("abort", onAbort);
			resolve(results);
		};
		const onAbort = () => {
			if (child.exitCode === null) child.kill("SIGKILL");
		};
		signal.addEventListener("abort", onAbort, { once: true });
		// Hard timeout so a huge tree cannot freeze autocomplete forever.
		const timer = setTimeout(() => onAbort(), 2_500);
		child.stdout.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => {
			clearTimeout(timer);
			finish([]);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (signal.aborted) {
				// Return partial stdout if we got any — better than empty after kill.
				finish(parseFdStdout(stdout));
				return;
			}
			if (code !== 0 && code !== 1 && !stdout) {
				finish([]);
				return;
			}
			finish(parseFdStdout(stdout));
		});
	});

	if (hits.length > 0 && !signal.aborted) {
		listCache.set(cwd, { at: Date.now(), hits });
	}
	return hits;
}

/** Rank a prelisted candidate set with fzf --filter (order = fzf rank). */
export async function filterWithFzf(
	query: string,
	candidates: FileHit[],
	fzfPath: string,
	limit: number,
	signal: AbortSignal,
): Promise<FileHit[] | null> {
	if (!query || candidates.length === 0) return candidates.slice(0, limit);

	return await new Promise((resolve) => {
		if (signal.aborted) {
			resolve(null);
			return;
		}
		const child = spawn(fzfPath, ["--filter", query, "-i"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let resolved = false;
		const finish = (results: FileHit[] | null) => {
			if (resolved) return;
			resolved = true;
			signal.removeEventListener("abort", onAbort);
			resolve(results);
		};
		const onAbort = () => {
			if (child.exitCode === null) child.kill("SIGKILL");
		};
		signal.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			if (signal.aborted) {
				finish(null);
				return;
			}
			// fzf --filter exits 0 always when it runs; 2 = error
			if (code !== 0 && code !== 1) {
				finish(null);
				return;
			}
			const byPath = new Map(candidates.map((h) => [h.relativePath, h]));
			const out: FileHit[] = [];
			for (const line of stdout.split("\n")) {
				const path = toDisplayPath(line.trim());
				if (!path) continue;
				const hit = byPath.get(path) ?? lineToHit(path);
				if (hit) out.push(hit);
				if (out.length >= limit) break;
			}
			finish(out);
		});
		try {
			child.stdin.write(candidates.map((h) => h.relativePath).join("\n"));
			child.stdin.end();
		} catch {
			finish(null);
		}
	});
}

/**
 * True if every query char appears in order in candidate.
 * Separators (- _ . /) in the candidate may be skipped for free so
 * `myappconfig` matches `my-app-config.json`.
 */
export function fuzzySubsequenceMatch(query: string, candidate: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	const c = candidate.toLowerCase();
	let qi = 0;
	for (let ci = 0; ci < c.length && qi < q.length; ci += 1) {
		if (c[ci] === q[qi]) {
			qi += 1;
			continue;
		}
		// allow skipping punctuation in candidate without consuming query
		if (SKIPPABLE_IN_CANDIDATE.test(c[ci] ?? "")) continue;
	}
	return qi === q.length;
}

/**
 * Higher is better. Emphasizes contiguous runs and basename matches;
 * punctuation gaps are cheap so collapsed queries still rank well.
 */
export function scoreHit(hit: FileHit, query: string): number {
	if (!query) return 1;
	const fileName = hit.fileName.replace(/\/$/, "");
	const path = hit.relativePath;
	const q = query.toLowerCase();
	const lowerName = fileName.toLowerCase();
	const lowerPath = path.toLowerCase();

	const nameScore = scoreFuzzyAgainst(q, lowerName);
	if (nameScore < 0 && !fuzzySubsequenceMatch(q, lowerPath)) return 0;
	const pathScore = scoreFuzzyAgainst(q, lowerPath);
	const best = Math.max(nameScore, pathScore * 0.85);
	if (best < 0) return 0;

	let score = best;
	// Basename matches beat path-only (collapsed queries should surface the file name)
	if (nameScore >= 0) score += 40 + nameScore * 0.25;
	const compactName = lowerName.replace(SKIPPABLE_IN_CANDIDATE, "");
	const compactQuery = q.replace(SKIPPABLE_IN_CANDIDATE, "");
	if (compactName === compactQuery) score += 50;
	else if (compactName.startsWith(compactQuery)) score += 20;
	if (hit.fileName.endsWith("/")) score += 6;
	// shallower paths win slight tie-break
	score -= Math.min(path.split("/").length, 8);
	return score;
}

/** Returns -1 if no match; otherwise a non-negative quality score. */
export function scoreFuzzyAgainst(query: string, candidate: string): number {
	if (!query) return 1;
	if (!fuzzySubsequenceMatch(query, candidate)) return -1;

	// Walk aligning query chars; reward adjacency and matches right after separators.
	let qi = 0;
	let score = 0;
	let consecutive = 0;
	let lastMatch = -2;
	for (let ci = 0; ci < candidate.length && qi < query.length; ci += 1) {
		const cc = candidate[ci] ?? "";
		const qc = query[qi] ?? "";
		if (cc === qc) {
			let bonus = 1;
			if (ci === lastMatch + 1) {
				consecutive += 1;
				bonus += 4 + consecutive;
			} else {
				consecutive = 0;
				if (ci === 0 || SKIPPABLE_IN_CANDIDATE.test(candidate[ci - 1] ?? "")) bonus += 6;
			}
			score += bonus;
			lastMatch = ci;
			qi += 1;
		} else if (SKIPPABLE_IN_CANDIDATE.test(cc)) {
			// free skip — tiny penalty so pure contiguous still wins
			score -= 0.15;
		} else {
			score -= 0.4;
		}
	}
	if (qi < query.length) return -1;
	// Prefer shorter candidates (tighter match)
	score += Math.max(0, 30 - candidate.length * 0.15);
	return score;
}

export function rankHitsLocally(hits: FileHit[], query: string, limit: number): FileHit[] {
	if (!query) return hits.slice(0, limit);
	return hits
		.map((hit) => ({ hit, score: scoreHit(hit, query) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || a.hit.relativePath.localeCompare(b.hit.relativePath))
		.slice(0, limit)
		.map((x) => x.hit);
}

/** fd list + fzf filter (preferred) or local separator-tolerant fuzzy. */
export async function searchWithFd(
	query: string,
	cwd: string,
	fdPath: string,
	limit: number,
	signal: AbortSignal,
	fzfPath?: string | null,
): Promise<FileHit[]> {
	const candidates = await listProjectPaths(cwd, fdPath, signal);
	if (signal.aborted || candidates.length === 0) return [];
	if (!query) return candidates.slice(0, limit);

	if (fzfPath) {
		const filtered = await filterWithFzf(query, candidates, fzfPath, limit, signal);
		if (filtered && filtered.length > 0) return filtered;
		// fzf missing-match or failed → local fuzzy (fzf may be stricter on some builds)
	}

	return rankHitsLocally(candidates, query, limit);
}

export async function fuzzyFindFiles(
	rawQuery: string,
	deps: FuzzyFileSearchDeps,
	signal: AbortSignal,
): Promise<FileHit[]> {
	const cwd = deps.getCwd();
	const query = normalizeSearchQuery(rawQuery, cwd);
	const searchFff = deps.searchFff ?? searchWithFff;
	const fffHits = searchFff(query, MAX_FUZZY_FILE_RESULTS);
	if (fffHits && fffHits.length > 0) return fffHits.slice(0, MAX_FUZZY_FILE_RESULTS);
	if (signal.aborted) return [];

	const fdPath = await deps.getFdPath();
	if (!fdPath) return fffHits ?? [];

	const fzfPath = deps.getFzfPath ? await deps.getFzfPath() : null;
	const searchFd = deps.searchFd ?? searchWithFd;
	const fdHits = await searchFd(query, cwd, fdPath, MAX_FUZZY_FILE_RESULTS, signal, fzfPath);
	if (signal.aborted) return [];
	return fdHits.slice(0, MAX_FUZZY_FILE_RESULTS);
}

// ── provider wrap ─────────────────────────────────────────────────────

export function createFuzzyFileAutocompleteProvider(
	current: AutocompleteProvider,
	deps: FuzzyFileSearchDeps,
): AutocompleteProvider {
	return {
		triggerCharacters: current.triggerCharacters,
		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
			options,
		): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol);
			const token = shouldFuzzyFileComplete(before, { force: options.force });
			if (!token) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			// Prefer built-in / extension argument completers (e.g. /model) when present
			if (before.trimStart().startsWith("/") && before.includes(" ") && !token.isAt) {
				const base = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				if (base && base.items.length > 0) return base;
			}

			const hits = await fuzzyFindFiles(token.rawQuery, deps, options.signal);
			if (options.signal.aborted) return null;
			if (hits.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				prefix: token.prefix,
				items: hitsToAutocompleteItems(hits, token),
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** Resolve a binary from PATH, agent bin dir, or common locations — no shell required. */
export function resolveLocalBin(names: string[]): string | null {
	const pathEnv = process.env.PATH ?? "";
	const dirs = pathEnv.split(":").filter(Boolean);
	const home = process.env.HOME || homedir();
	const agentDir = process.env.PI_AGENT_DIR || join(home, ".pi", "agent");
	const extras = [
		join(agentDir, "bin"),
		join(home, ".local", "bin"),
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	];
	for (const dir of [...dirs, ...extras]) {
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

async function resolveBin(pi: ExtensionAPI, cwd: string, names: string[]): Promise<string | null> {
	const local = resolveLocalBin(names);
	if (local) return local;
	try {
		const script = `${names.map((n) => `command -v ${n}`).join(" || ")} || true`;
		const which = await pi.exec("bash", ["-lc", script], {
			cwd,
			timeout: 3_000,
		});
		const path = which.stdout.trim().split("\n")[0]?.trim();
		return path || null;
	} catch {
		return null;
	}
}

type SessionCtx = {
	cwd: string;
	hasUI?: boolean;
	ui?: {
		addAutocompleteProvider?: (
			factory: (current: AutocompleteProvider) => AutocompleteProvider,
		) => void;
	};
};

function registerProvider(pi: ExtensionAPI, ctx: SessionCtx, event: unknown): void {
	// hasUI can be false during print/rpc bind; still register when ui API exists.
	const add = ctx.ui?.addAutocompleteProvider;
	if (!add) return;

	clearFuzzyFileListCache();

	let fdPath: string | null | undefined = resolveLocalBin(["fd", "fdfind"]);
	let fzfPath: string | null | undefined = resolveLocalBin(["fzf"]);
	const fdPromise =
		fdPath != null
			? Promise.resolve(fdPath)
			: resolveBin(pi, ctx.cwd, ["fd", "fdfind"]).then((path) => {
					fdPath = path;
					return path;
				});
	const fzfPromise =
		fzfPath != null
			? Promise.resolve(fzfPath)
			: resolveBin(pi, ctx.cwd, ["fzf"]).then((path) => {
					fzfPath = path;
					return path;
				});

	const getCwd = () => {
		const fromEvent =
			event && typeof event === "object" && "cwd" in event
				? String((event as { cwd?: string }).cwd ?? "")
				: "";
		return fromEvent || ctx.cwd || process.cwd();
	};

	// Warm the file list in the background so the first @query is instant.
	void (async () => {
		const fd = await fdPromise;
		if (!fd) return;
		await listProjectPaths(getCwd(), fd, new AbortController().signal);
	})();

	add((current) =>
		createFuzzyFileAutocompleteProvider(current, {
			getCwd,
			getFdPath: async () => {
				if (fdPath != null) return fdPath;
				return fdPromise;
			},
			getFzfPath: async () => {
				if (fzfPath != null) return fzfPath;
				return fzfPromise;
			},
		}),
	);
}

/** Register stacked provider on session_start (and again after UI bind if needed). */
export function installFuzzyFileAutocomplete(pi: ExtensionAPI): void {
	// Register at factory time is impossible (no ui yet). session_start is the hook.
	// Do NOT gate on hasUI alone — some hosts set it late; require addAutocompleteProvider.
	pi.on("session_start", (event, ctx) => {
		registerProvider(pi, ctx, event);
	});
}

export default function fuzzyFileAutocompleteExtension(pi: ExtensionAPI): void {
	installFuzzyFileAutocomplete(pi);
}
