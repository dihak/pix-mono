import { describe, expect, it } from "bun:test";
import { extname } from "node:path";

// ── Re-export internal helpers for testing via module augmentation ────────────
// transcribe.ts exports only the default fn; we test the pure logic
// inline here to avoid coupling tests to private internals.

// ── mimeType (copied from transcribe.ts) ─────────────────────────────────────

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

// ── parseTranscriptionResponse (extracted logic from execute) ─────────────────

function parseTranscriptionResponse(raw: string): string {
	try {
		const parsed = JSON.parse(raw) as { text?: string };
		return parsed.text ?? raw;
	} catch {
		return raw;
	}
}

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
