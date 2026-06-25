/**
 * fetch.ts — fetch tool via 9Router API, with curl fallback.
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

function curl(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
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
	});
}

/**
 * Extract readable page content from the exa fetch JSON envelope.
 * Shape: { provider, url, title, content: { format, text }, ... }
 * Falls back to the raw string when it isn't the expected JSON shape.
 */
export function formatFetchResult(raw: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return raw;
	}
	if (typeof parsed !== "object" || parsed === null) return raw;

	const obj = parsed as {
		title?: string | null;
		url?: string | null;
		content?: { text?: string | null } | string | null;
	};

	const text =
		typeof obj.content === "string"
			? obj.content
			: (obj.content?.text ?? undefined);
	if (typeof text !== "string") return raw;

	const header: string[] = [];
	if (obj.title) header.push(`# ${obj.title}`);
	if (obj.url) header.push(`URL: ${obj.url}`);

	return header.length > 0 ? `${header.join("\n")}\n\n${text}` : text;
}

export default function registerFetch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "fetch",
		label: "Fetch",
		description:
			"Fetch a web page as markdown, text, or raw HTML via exa. Returns page content.",
		promptSnippet:
			"fetch(url, format, max_characters?) — format: 'markdown', 'text', or 'html'. Read page content via exa.",
		promptGuidelines: [
			"Use fetch when you need to read the full content of a specific URL.",
			"Prefer format='markdown' for readable content, 'text' for plain text extraction, 'html' for raw source.",
			"Set max_characters to cap response size (default 1000, 0 = unlimited). Use 5000-10000 for typical pages.",
			"Always prefer fetch over raw curl/browser for reading page content.",
		],
		renderCall: makeRenderCall("fetch", (args) => String(args.url ?? "")),
		renderResult: makeRenderResult(),
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			format: StringEnum(["markdown", "text", "html"] as const, {
				description: "Desired output format",
			}),
			max_characters: Type.Optional(
				Type.Number({
					description: "Max characters (default 1000, 0 = unlimited)",
					default: 1000,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const maxChars = params.max_characters ?? 1000;
			const fmt = params.format ?? "markdown";
			let apiMsg = "";

			try {
				onUpdate?.({
					content: [
						{ type: "text", text: `Fetching (${fmt}): ${params.url}...` },
					],
					details: undefined,
				});

				const raw = await apiPost(
					"/web/fetch",
					{
						model: "exa",
						url: params.url,
						format: fmt,
						max_characters: maxChars,
					},
					signal,
				);

				const formatted = formatFetchResult(raw);
				const truncated =
					maxChars > 0 && formatted.length > maxChars
						? `${formatted.slice(0, maxChars)}\n\n[truncated]`
						: formatted;

				return {
					content: [{ type: "text", text: truncated.slice(0, 20_000) }],
					details: {
						source: "api",
						chars: formatted.length,
						truncated: maxChars > 0 && formatted.length > maxChars,
					},
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
				let html = await curl(["-L", params.url]);
				if (maxChars > 0 && html.length > maxChars)
					html = `${html.slice(0, maxChars)}\n\n[truncated]`;

				const banner =
					"[FALLBACK — raw curl] API unavailable, content may differ from exa formatted output.";
				const body =
					fmt === "html"
						? `${banner}\n\n${html.slice(0, 19_500)}`
						: `${banner}\n\nRaw HTML (format='${fmt}' not applied):\n\n${html.slice(0, 19_000)}`;

				return {
					content: [{ type: "text", text: body.slice(0, 20_000) }],
					details: { source: "curl-fallback", chars: html.length },
				};
			} catch (curlErr: unknown) {
				const curlMsg =
					curlErr instanceof Error ? curlErr.message : String(curlErr);
				return {
					content: [
						{
							type: "text",
							text: `Fetch failed (both API and curl).\nAPI: ${apiMsg}\nCurl: ${curlMsg}`,
						},
					],
					details: { source: "failed" },
					isError: true,
				};
			}
		},
	});
}
