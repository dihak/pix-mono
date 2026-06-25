/**
 * transcribe.ts — speech-to-text tool via 9Router audio transcription API, with curl fallback.
 *
 * Uses the OpenAI-compatible /audio/transcriptions endpoint through the router.
 * Accepts a file path to an audio file and returns the transcribed text.
 *
 * Default model: dg/nova-3 (Deepgram Nova 3)
 *
 * Environment:
 *   ROUTER_API_BASE  — router API base URL (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token for the router
 */

import { type ExecFileException, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { routerBaseUrl } from "./data.js";

const REQUEST_TIMEOUT_MS = 120_000; // audio transcription can take longer
const DEFAULT_MODEL = "dg/nova-3";

function auth(): string | undefined {
	return process.env.ROUTER_API_KEY;
}

/** Map file extension to MIME type for common audio formats. */
function mimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	const types: Record<string, string> = {
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".flac": "audio/flac",
		".ogg": "audio/ogg",
		".m4a": "audio/mp4",
		".webm": "audio/webm",
		".mp4": "audio/mp4",
		".mpga": "audio/mpeg",
	};
	return types[ext] ?? "application/octet-stream";
}

async function apiMultipart(
	path: string,
	filePath: string,
	model: string,
	language: string | undefined,
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
		const fileData = await readFile(filePath);
		const blob = new Blob([fileData], { type: mimeType(filePath) });

		const form = new FormData();
		form.append("file", blob, basename(filePath));
		form.append("model", model);
		if (language) form.append("language", language);

		const res = await fetch(url, {
			method: "POST",
			headers: {
				...(key ? { Authorization: `Bearer ${key}` } : {}),
			},
			body: form,
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
			["-sS", "--connect-timeout", "10", "--max-time", "120", ...args],
			{ maxBuffer: 10 * 1024 * 1024, timeout: REQUEST_TIMEOUT_MS },
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

export default function registerTranscribe(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "transcribe",
		label: "Transcribe",
		description:
			"Convert speech to text. Transcribes an audio file using the 9Router audio transcription API (Deepgram Nova 3).",
		promptSnippet:
			"transcribe(file, model?, language?) — Transcribe an audio file to text. Supports mp3, wav, flac, ogg, m4a, webm. Default model: dg/nova-3.",
		promptGuidelines: [
			"Use transcribe when you need to convert speech/audio to text.",
			"The file parameter should be an absolute or relative path to an audio file on disk.",
			"Supports common audio formats: mp3, wav, flac, ogg, m4a, webm, mp4.",
			"Default model is dg/nova-3 (Deepgram Nova 3). Override with model parameter if needed.",
			"Optionally specify language as ISO 639-1 code (e.g. 'en', 'es', 'fr') for better accuracy.",
		],
		parameters: Type.Object({
			file: Type.String({
				description: "Path to the audio file to transcribe",
			}),
			model: Type.Optional(
				Type.String({
					description: "Transcription model to use (default: dg/nova-3)",
					default: DEFAULT_MODEL,
				}),
			),
			language: Type.Optional(
				Type.String({
					description:
						"ISO 639-1 language code (e.g. 'en', 'es', 'fr') for better accuracy",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const model = params.model ?? DEFAULT_MODEL;
			const filePath = params.file;
			let apiMsg = "";

			try {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `Transcribing: ${filePath} (model: ${model})...`,
						},
					],
					details: undefined,
				});

				const raw = await apiMultipart(
					"/audio/transcriptions",
					filePath,
					model,
					params.language,
					signal,
				);

				// The API may return JSON {"text": "..."} or plain text
				let text: string;
				try {
					const parsed = JSON.parse(raw) as { text?: string };
					text = parsed.text ?? raw;
				} catch {
					text = raw;
				}

				return {
					content: [{ type: "text", text: text.slice(0, 50_000) }],
					details: {
						source: "api",
						model,
						chars: text.length,
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

			// curl fallback — uses multipart form upload
			try {
				const curlArgs = [
					"-X",
					"POST",
					...(auth() ? ["-H", `Authorization: Bearer ${auth()}`] : []),
					"-F",
					`file=@${filePath}`,
					"-F",
					`model=${model}`,
					...(params.language ? ["-F", `language=${params.language}`] : []),
					`${routerBaseUrl()}/audio/transcriptions`,
				];

				const raw = await curl(curlArgs);

				let text: string;
				try {
					const parsed = JSON.parse(raw) as { text?: string };
					text = parsed.text ?? raw;
				} catch {
					text = raw;
				}

				return {
					content: [
						{
							type: "text",
							text: `[FALLBACK — curl] API called via curl instead of fetch.\n\n${text.slice(0, 49_500)}`,
						},
					],
					details: { source: "curl-fallback", model },
				};
			} catch (curlErr: unknown) {
				const curlMsg =
					curlErr instanceof Error ? curlErr.message : String(curlErr);
				return {
					content: [
						{
							type: "text",
							text: `Transcription failed (both API and curl).\nAPI: ${apiMsg}\nCurl: ${curlMsg}`,
						},
					],
					details: { source: "failed" },
					isError: true,
				};
			}
		},
	});
}
