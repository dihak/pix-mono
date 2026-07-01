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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { routerBaseUrl } from "./data.js";

const REQUEST_TIMEOUT_MS = 120_000; // audio transcription can take longer
const CHAT_TRUNCATE_LIMIT = 50_000; // only when no output_file is provided
const DEFAULT_MODEL = "dg/nova-3";

function auth(): string | undefined {
	return process.env.ROUTER_API_KEY;
}

/** Map file extension to MIME type for common audio formats. */
export function mimeType(filePath: string): string {
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

/** Extract the `text` field from a JSON envelope, or return the raw string. */
export function parseTranscriptionResponse(raw: string): string {
	try {
		const parsed = JSON.parse(raw) as { text?: string };
		return parsed.text ?? raw;
	} catch {
		return raw;
	}
}

/** Resolve a possibly-relative `output_file` to an absolute path. */
export function resolveOutputPath(outputFile: string): string {
	return isAbsolute(outputFile)
		? outputFile
		: resolve(process.cwd(), outputFile);
}

/** Write transcription text to disk, creating parent directories as needed. */
export async function writeTranscriptionFile(
	outputFile: string,
	text: string,
): Promise<string> {
	const abs = resolveOutputPath(outputFile);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, text, "utf-8");
	return abs;
}

/**
 * Build the tool return value from a successful transcription.
 * - If `outputFile` is set: write the full text verbatim and return a short summary.
 * - Otherwise: return the text inline, truncated to fit chat.
 */
export async function buildTranscriptionResult(
	text: string,
	model: string,
	source: "api" | "curl-fallback",
	outputFile: string | undefined,
): Promise<{
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
}> {
	const details: Record<string, unknown> = {
		source,
		model,
		chars: text.length,
	};

	if (outputFile) {
		const abs = await writeTranscriptionFile(outputFile, text);
		details.output_path = abs;
		return {
			content: [
				{
					type: "text",
					text: `Transcribed ${text.length} chars → ${abs}`,
				},
			],
			details,
		};
	}

	return {
		content: [{ type: "text", text: text.slice(0, CHAT_TRUNCATE_LIMIT) }],
		details,
	};
}

export default function registerTranscribe(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "transcribe",
		label: "Transcribe",
		description:
			"Convert speech to text. Transcribes an audio file using the 9Router audio transcription API (Deepgram Nova 3). Optionally writes the full text to a file on disk.",
		promptSnippet:
			"transcribe(file, output_file?, model?, language?) — Transcribe an audio file to text. Supports mp3, wav, flac, ogg, m4a, webm. Default model: dg/nova-3. If output_file is set, the full text is written to that path (parent dirs created) and only a short path summary is returned to the model.",
		promptGuidelines: [
			"Use transcribe when you need to convert speech/audio to text.",
			"The file parameter should be an absolute or relative path to an audio file on disk.",
			"Supports common audio formats: mp3, wav, flac, ogg, m4a, webm, mp4.",
			"Default model is dg/nova-3 (Deepgram Nova 3). Override with model parameter if needed.",
			"Optionally specify language as ISO 639-1 code (e.g. 'en', 'es', 'fr') for better accuracy.",
			"Pass output_file to write the full transcription to disk — useful when the result is long, when it will be re-read or piped to another tool, or to keep chat context small. Relative paths are resolved against the current working directory.",
			"Without output_file the transcribed text is returned inline (truncated to 50,000 chars).",
		],
		parameters: Type.Object({
			file: Type.String({
				description: "Path to the audio file to transcribe",
			}),
			output_file: Type.Optional(
				Type.String({
					description:
						"Write the full transcription text to this path (parent dirs are created). Relative paths resolve against cwd. When set, content returned to the model is just a short path summary.",
				}),
			),
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
			const outputFile = params.output_file;
			let apiMsg = "";

			const run = async (source: "api" | "curl-fallback", raw: string) =>
				buildTranscriptionResult(
					parseTranscriptionResponse(raw),
					model,
					source,
					outputFile,
				);

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

				return await run("api", raw);
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
				return await run("curl-fallback", raw);
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
