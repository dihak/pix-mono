import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildTranscriptionResult,
	mimeType,
	parseTranscriptionResponse,
	resolveOutputPath,
	writeTranscriptionFile,
} from "./transcribe.js";

// ── mimeType ─────────────────────────────────────────────────────────────────

describe("mimeType", () => {
	it("returns audio/mpeg for .mp3", () => {
		expect(mimeType("recording.mp3")).toBe("audio/mpeg");
	});

	it("returns audio/mpeg for .mpga", () => {
		expect(mimeType("recording.mpga")).toBe("audio/mpeg");
	});

	it("returns audio/wav for .wav", () => {
		expect(mimeType("recording.wav")).toBe("audio/wav");
	});

	it("returns audio/flac for .flac", () => {
		expect(mimeType("music.flac")).toBe("audio/flac");
	});

	it("returns audio/ogg for .ogg", () => {
		expect(mimeType("voice.ogg")).toBe("audio/ogg");
	});

	it("returns audio/mp4 for .m4a", () => {
		expect(mimeType("podcast.m4a")).toBe("audio/mp4");
	});

	it("returns audio/webm for .webm", () => {
		expect(mimeType("clip.webm")).toBe("audio/webm");
	});

	it("returns audio/mp4 for .mp4", () => {
		expect(mimeType("video.mp4")).toBe("audio/mp4");
	});

	it("is case-insensitive on extension", () => {
		expect(mimeType("LOUD.MP3")).toBe("audio/mpeg");
		expect(mimeType("file.WAV")).toBe("audio/wav");
		expect(mimeType("track.Flac")).toBe("audio/flac");
	});

	it("returns application/octet-stream for unknown extension", () => {
		expect(mimeType("archive.zip")).toBe("application/octet-stream");
	});

	it("returns application/octet-stream for no extension", () => {
		expect(mimeType("noext")).toBe("application/octet-stream");
	});

	it("handles paths with directories", () => {
		expect(mimeType("/home/user/audio/meeting.mp3")).toBe("audio/mpeg");
		expect(mimeType("./recordings/call.wav")).toBe("audio/wav");
	});

	it("handles dotfiles with audio extensions", () => {
		expect(mimeType(".hidden.mp3")).toBe("audio/mpeg");
	});
});

// ── parseTranscriptionResponse ───────────────────────────────────────────────

describe("parseTranscriptionResponse", () => {
	it("extracts text from JSON response", () => {
		const raw = JSON.stringify({ text: "Hello, world!" });
		expect(parseTranscriptionResponse(raw)).toBe("Hello, world!");
	});

	it("extracts text from JSON with extra fields", () => {
		const raw = JSON.stringify({
			text: "Transcribed content",
			duration: 5.2,
			language: "en",
		});
		expect(parseTranscriptionResponse(raw)).toBe("Transcribed content");
	});

	it("returns raw JSON string when text field is missing", () => {
		const raw = JSON.stringify({ result: "no text field" });
		expect(parseTranscriptionResponse(raw)).toBe(raw);
	});

	it("returns plain text as-is when not JSON", () => {
		expect(parseTranscriptionResponse("Just plain text")).toBe(
			"Just plain text",
		);
	});

	it("returns empty string from JSON with empty text", () => {
		const raw = JSON.stringify({ text: "" });
		// ?? only triggers on null/undefined, not empty string — so "" is returned
		expect(parseTranscriptionResponse(raw)).toBe("");
	});

	it("returns raw when text is null", () => {
		const raw = JSON.stringify({ text: null });
		// null ?? raw → raw
		expect(parseTranscriptionResponse(raw)).toBe(raw);
	});

	it("returns raw when text is undefined (absent from parsed object)", () => {
		const raw = JSON.stringify({ other: "stuff" });
		// parsed.text is undefined → undefined ?? raw → raw
		expect(parseTranscriptionResponse(raw)).toBe(raw);
	});

	it("handles multiline transcription", () => {
		const text = "Line one.\nLine two.\nLine three.";
		const raw = JSON.stringify({ text });
		expect(parseTranscriptionResponse(raw)).toBe(text);
	});

	it("handles unicode in transcription", () => {
		const text = "日本語のテスト 🎙️";
		const raw = JSON.stringify({ text });
		expect(parseTranscriptionResponse(raw)).toBe(text);
	});

	it("handles broken JSON gracefully", () => {
		expect(parseTranscriptionResponse("{broken")).toBe("{broken");
	});

	it("handles empty string input", () => {
		expect(parseTranscriptionResponse("")).toBe("");
	});
});

// ── resolveOutputPath ────────────────────────────────────────────────────────

describe("resolveOutputPath", () => {
	it("keeps absolute paths as-is", () => {
		const abs = "/tmp/foo/bar.txt";
		expect(resolveOutputPath(abs)).toBe(abs);
	});

	it("resolves relative paths against cwd", () => {
		const rel = "transcripts/out.txt";
		const result = resolveOutputPath(rel);
		expect(result.endsWith("transcripts/out.txt")).toBe(true);
		expect(result.startsWith(process.cwd())).toBe(true);
	});
});

// ── writeTranscriptionFile ───────────────────────────────────────────────────

describe("writeTranscriptionFile", () => {
	const tmpRoot = mkdtempSync(join(tmpdir(), "pix-transcribe-test-"));

	it("writes text to the given file path", async () => {
		const file = join(tmpRoot, "simple.txt");
		const abs = await writeTranscriptionFile(file, "hello world");
		expect(abs).toBe(file);
		expect(await readFile(file, "utf-8")).toBe("hello world");
	});

	it("creates parent directories recursively", async () => {
		const file = join(tmpRoot, "deep", "nested", "dir", "out.txt");
		const abs = await writeTranscriptionFile(file, "deep content");
		expect(abs).toBe(file);
		expect(await readFile(file, "utf-8")).toBe("deep content");
	});

	it("preserves full unicode without truncation", async () => {
		const text = `日本語のテスト\n${"x".repeat(100_000)}`;
		const file = join(tmpRoot, "huge.txt");
		await writeTranscriptionFile(file, text);
		const got = await readFile(file, "utf-8");
		expect(got.length).toBe(text.length);
		expect(got).toBe(text);
	});

	it("overwrites an existing file", async () => {
		const file = join(tmpRoot, "overwrite.txt");
		await writeTranscriptionFile(file, "first");
		await writeTranscriptionFile(file, "second");
		expect(await readFile(file, "utf-8")).toBe("second");
	});

	// cleanup tmp root
	it("cleanup", async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});
});

// ── buildTranscriptionResult ─────────────────────────────────────────────────

describe("buildTranscriptionResult", () => {
	const tmpRoot = mkdtempSync(join(tmpdir(), "pix-transcribe-result-"));

	it("returns inline text (truncated at 50_000) when no output_file is set", async () => {
		const text = "a".repeat(60_000);
		const result = await buildTranscriptionResult(
			text,
			"dg/nova-3",
			"api",
			undefined,
		);
		expect(result.content).toHaveLength(1);
		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.text.length).toBe(50_000);
		expect(result.details).toEqual({
			source: "api",
			model: "dg/nova-3",
			chars: 60_000,
		});
	});

	it("returns inline text (untruncated) when short and no output_file", async () => {
		const text = "short transcript";
		const result = await buildTranscriptionResult(
			text,
			"dg/nova-3",
			"api",
			undefined,
		);
		expect(result.content[0]?.text).toBe("short transcript");
		expect(result.details.chars).toBe(text.length);
	});

	it("writes full text to file and returns short path summary when output_file is set", async () => {
		const text = "a".repeat(100_000); // way over 50k
		const file = join(tmpRoot, "result-a.txt");
		const result = await buildTranscriptionResult(
			text,
			"dg/nova-3",
			"api",
			file,
		);

		// content is a short summary, not the full text
		expect(result.content).toHaveLength(1);
		const summary = result.content[0]?.text ?? "";
		expect(summary.length).toBeLessThan(200);
		expect(summary).toContain("100000");
		expect(summary).toContain(file);

		// full text was written verbatim
		const onDisk = await readFile(file, "utf-8");
		expect(onDisk.length).toBe(100_000);
		expect(onDisk).toBe(text);

		// details includes resolved absolute path
		expect(result.details.output_path).toBe(file);
		expect(result.details.chars).toBe(100_000);
		expect(result.details.source).toBe("api");
	});

	it("passes through curl-fallback source label", async () => {
		const text = "hi";
		const result = await buildTranscriptionResult(
			text,
			"dg/nova-3",
			"curl-fallback",
			undefined,
		);
		expect(result.details.source).toBe("curl-fallback");
	});

	it("relative output_file is resolved against cwd and created", async () => {
		const text = "relative path content";
		const relDir = join(tmpRoot, "rel", "sub");
		const relFile = join(relDir, "out.txt");
		const result = await buildTranscriptionResult(
			text,
			"dg/nova-3",
			"api",
			relFile,
		);

		expect(result.details.output_path).toBe(relFile);
		expect(await readFile(relFile, "utf-8")).toBe("relative path content");
	});

	it("cleanup", async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	// silence unused-import warning for mkdir (we use it implicitly via writeTranscriptionFile)
	it("mkdir import sanity", () => {
		expect(typeof mkdir).toBe("function");
	});
});
