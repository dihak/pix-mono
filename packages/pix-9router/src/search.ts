/**
 * search.ts — search tool via 9Router API, with curl fallback.
 *
 * Environment:
 *   ROUTER_API_BASE  — router API base URL (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token for the router
 */

import { type ExecFileException, execFile } from "node:child_process";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { routerBaseUrl } from "./data.js";
import { makeRenderCall, makeRenderResult } from "./render.js";

const REQUEST_TIMEOUT_MS = 30_000;

function auth(): string | undefined {
	return process.env.ROUTER_API_KEY;
}

async function apiPost(
	path: string,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const url = `${routerBaseUrl()}${path}`;
	const key = auth();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const s = signal
		? AbortSignal.any([signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(key ? { Authorization: `Bearer ${key}` } : {}),
			},
			body: JSON.stringify(body),
			signal: s,
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			throw new Error(`API ${res.status}: ${errText.slice(0, 500)}`);
		}
		return await res.text();
	} finally {
		clearTimeout(timeout);
	}
}

function curl(args: string[], stdin?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"curl",
			["-sS", "--connect-timeout", "10", "--max-time", "25", ...args],
			{ maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
			(err, stdout, stderr) => {
				if (err) {
					const e = err as ExecFileException;
					const msg = e.killed
						? "curl timed out"
						: `curl exit ${e.code ?? "??"}: ${stderr.slice(0, 300)}`;
					reject(new Error(msg));
					return;
				}
				resolve(stdout);
			},
		);
		if (stdin && child.stdin) {
			child.stdin.write(stdin);
			child.stdin.end();
		}
	});
}

interface SearchResultItem {
	title?: string | null;
	url?: string | null;
	snippet?: string | null;
	published_at?: string | null;
	metadata?: { author?: string | null } | null;
	author?: string | null;
}

/**
 * Format a raw exa search response as a compact markdown list.
 * Falls back to pretty-printed JSON when the shape is unexpected.
 */
export function formatSearchResults(raw: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return raw.slice(0, 20_000);
	}

	const obj = parsed as Record<string, unknown>;
	const results = obj?.results;
	if (!Array.isArray(results)) {
		return JSON.stringify(parsed, null, 2).slice(0, 20_000);
	}

	if (results.length === 0) return "No results.";

	const lines: string[] = [];
	results.forEach((r: SearchResultItem, i: number) => {
		const title = (r.title ?? "").trim() || r.url || "(untitled)";
		lines.push(`${i + 1}. ${title}`);
		if (r.url) lines.push(`   ${r.url}`);
		const meta: string[] = [];
		const author = r.author ?? r.metadata?.author;
		if (author) meta.push(author);
		if (r.published_at) meta.push(r.published_at.slice(0, 10));
		if (meta.length > 0) lines.push(`   (${meta.join(" — ")})`);
		const snippet = (r.snippet ?? "").trim();
		if (snippet) lines.push(`   ${snippet.replace(/\s+/g, " ").slice(0, 300)}`);
		lines.push("");
	});

	return lines.join("\n").trim().slice(0, 20_000);
}

export default function registerSearch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "search",
		label: "Search",
		description:
			"Web or news search via exa. Returns title, url, and snippet for each result.",
		promptSnippet:
			"search(query, search_type, max_results?) — search_type: 'web' or 'news'. Defaults to 5 results, max 10.",
		promptGuidelines: [
			"Use search when you need up-to-date information or facts from the web.",
			"Set search_type='web' for general web results, search_type='news' for recent news articles.",
			"Always prefer search over raw curl/browser requests for information lookup.",
		],
		renderCall: makeRenderCall("search", (args) => String(args.query ?? "")),
		renderResult: makeRenderResult(),
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			search_type: StringEnum(["web", "news"] as const, {
				description: "web or news search",
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Max results (default 5, max 10)",
					default: 5,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const max = Math.min(params.max_results ?? 5, 10);
			const searchType = params.search_type ?? "web";
			let apiMsg = "";

			try {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `Searching (${searchType}): ${params.query}...`,
						},
					],
					details: undefined,
				});

				const raw = await apiPost(
					"/search",
					{
						model: "exa",
						query: params.query,
						search_type: searchType,
						max_results: max,
					},
					signal,
				);

				return {
					content: [
						{
							type: "text",
							text: formatSearchResults(raw),
						},
					],
					details: { source: "api" },
				};
			} catch (apiErr: unknown) {
				apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `API failed: ${apiMsg}\nFalling back to curl...`,
						},
					],
					details: undefined,
				});
			}

			try {
				const body = JSON.stringify({
					model: "exa",
					query: params.query,
					search_type: searchType,
					max_results: max,
				});
				const raw = await curl([
					"-X",
					"POST",
					"-H",
					"Content-Type: application/json",
					...(auth() ? ["-H", `Authorization: Bearer ${auth()}`] : []),
					"-d",
					body,
					`${routerBaseUrl()}/search`,
				]);

				return {
					content: [
						{
							type: "text",
							text: `[FALLBACK — curl] API called via curl instead of fetch.\n\n${formatSearchResults(raw).slice(0, 19_500)}`,
						},
					],
					details: { source: "curl-fallback" },
				};
			} catch (curlErr: unknown) {
				const curlMsg =
					curlErr instanceof Error ? curlErr.message : String(curlErr);
				return {
					content: [
						{
							type: "text",
							text: `Search failed (both API and curl).\nAPI: ${apiMsg}\nCurl: ${curlMsg}`,
						},
					],
					details: { source: "failed" },
					isError: true,
				};
			}
		},
	});
}
