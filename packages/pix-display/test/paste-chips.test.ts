/**
 * Tests for paste-chips marker restyling and width safety.
 *
 * Regression: restyling markers can widen lines (e.g. "#1" → "text"),
 * which caused a TUI crash when the restyled line exceeded terminal width.
 * See: pi-crash.log — "Rendered line 38 exceeds terminal width (285 > 283)"
 */

import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	endsWithMarker,
	expandPasteMarkers,
	replaceImagePaths,
	restyleMarkers,
} from "../src/paste-chips.js";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ─── restyleMarkers ──────────────────────────────────────────────────────────

describe("paste-chips restyleMarkers", () => {
	describe("text markers", () => {
		it("restyles chars marker to colored icon text chip", () => {
			const result = restyleMarkers("[paste #1 2232 chars]", new Set());
			expect(result).toContain("\x1b[");
			expect(stripAnsi(result)).toBe("󰉿 text 2.2k chars");
		});

		it("restyles lines marker to colored icon text chip", () => {
			const result = restyleMarkers("[paste #2 +42 lines]", new Set());
			expect(stripAnsi(result)).toBe("󰉿 text 42 lines");
		});

		it("restyles bare marker (no size info) to text chip with id", () => {
			const result = restyleMarkers("[paste #3]", new Set());
			expect(stripAnsi(result)).toBe("󰉿 text #3");
		});
	});

	describe("image markers", () => {
		it("restyles marker to colored icon image chip when ID is in imageIds", () => {
			const imageIds = new Set([1]);
			const result = restyleMarkers("[paste #1 58 chars]", imageIds);
			expect(result).toContain("\x1b[");
			expect(stripAnsi(result)).toBe("󰋩 image #1");
		});

		it("does not restyle non-image ID as image", () => {
			const imageIds = new Set([1]);
			const result = restyleMarkers("[paste #2 100 chars]", imageIds);
			expect(stripAnsi(result)).toBe("󰉿 text 100 chars");
		});
	});

	describe("multiple markers in one line", () => {
		it("restyles all markers in a single line", () => {
			const imageIds = new Set([1]);
			const line = "before [paste #1 58 chars] middle [paste #2 +10 lines] after";
			const result = restyleMarkers(line, imageIds);
			expect(stripAnsi(result)).toBe("before 󰋩 image #1 middle 󰉿 text 10 lines after");
		});
	});

	describe("no markers", () => {
		it("returns line unchanged when no markers present", () => {
			const line = "just regular text with no paste markers";
			expect(restyleMarkers(line, new Set())).toBe(line);
		});

		it("returns empty string unchanged", () => {
			expect(restyleMarkers("", new Set())).toBe("");
		});
	});

	describe("ANSI-styled markers", () => {
		it("restyles markers embedded in ANSI sequences", () => {
			const line = "\x1b[38;2;84;92;126m[paste #1 500 chars]\x1b[0m";
			const result = restyleMarkers(line, new Set());
			expect(stripAnsi(result)).toBe("󰉿 text 500 chars");
		});

		it("restyles markers with cursor inversion codes inside", () => {
			// Cursor at '5' inside the char count: [paste #1 \x1b[7m5\x1b[0m8 chars]
			const line = "[paste #1 \x1b[7m5\x1b[0m8 chars]";
			const result = restyleMarkers(line, new Set());
			expect(stripAnsi(result)).toBe("󰉿 text 58 chars");
		});

		it("restyles image markers with cursor codes at bracket", () => {
			const imageIds = new Set([2]);
			const line = "\x1b[7m[\x1b[0mpaste #2 99 chars\x1b[7m]\x1b[0m";
			const result = restyleMarkers(line, imageIds);
			expect(stripAnsi(result)).toBe("󰋩 image #2");
		});

		it("restyles lines marker with cursor codes inside", () => {
			const line = "[paste #3 \x1b[7m+\x1b[0m42 lines]";
			const result = restyleMarkers(line, new Set());
			expect(stripAnsi(result)).toBe("󰉿 text 42 lines");
		});
	});
});

// ─── Width safety (regression for crash) ─────────────────────────────────────

describe("paste-chips width safety", () => {
	it("restyling a chars marker can decrease visible width", () => {
		const original = "[paste #1 2232 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(visibleWidth(restyled)).toBeLessThan(visibleWidth(original));
	});

	it("restyling a lines marker can decrease visible width", () => {
		// "[paste #2 +42 lines]" (20 chars) → "[paste text +42]" (16 chars) = -4 width
		const original = "[paste #2 +42 lines]";
		const restyled = restyleMarkers(original, new Set());
		expect(visibleWidth(restyled)).toBeLessThan(visibleWidth(original));
	});

	it("restyling to image label changes width", () => {
		// "[paste #1 58 chars]" (19 chars) → "[paste image #1]" (16 chars)
		const imageIds = new Set([1]);
		const original = "[paste #1 58 chars]";
		const restyled = restyleMarkers(original, imageIds);
		expect(visibleWidth(restyled)).not.toBe(visibleWidth(original));
	});

	it("chars marker with large char count compacts metadata", () => {
		const original = "[paste #1 9999 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(stripAnsi(restyled)).toBe("󰉿 text 10k chars");
		expect(visibleWidth(restyled)).toBeLessThan(visibleWidth(original));
	});

	it("chars marker with multi-digit ID omits id from text chip", () => {
		const original = "[paste #10 9999 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(stripAnsi(restyled)).toBe("󰉿 text 10k chars");
		expect(visibleWidth(restyled)).toBeLessThan(visibleWidth(original));
	});

	describe("width behavior", () => {
		it("icon chip stays within terminal width when marker line fits", () => {
			const terminalWidth = 283;
			const marker = "[paste #1 2232 chars]";
			const padding = " ".repeat(terminalWidth - visibleWidth(marker));
			const line = marker + padding;

			expect(visibleWidth(line)).toBe(terminalWidth);

			const restyled = restyleMarkers(line, new Set());
			expect(visibleWidth(restyled)).toBeLessThanOrEqual(terminalWidth);
		});
	});
});

// ─── expandPasteMarkers (boundary wrapping) ──────────────────────────────────

describe("paste-chips expandPasteMarkers", () => {
	it("wraps a single text paste in <paste> tags", () => {
		const pastes = new Map([[1, "curl https://a.example"]]);
		const result = expandPasteMarkers("[paste #1 22 chars]", pastes);
		expect(result).toBe("<paste>curl https://a.example</paste>");
	});

	it("wraps an image paste (path content) in <paste> tags", () => {
		const pastes = new Map([[1, "/tmp/pi-clipboard-abc.png"]]);
		const result = expandPasteMarkers("[paste #1 25 chars]", pastes);
		expect(result).toBe("<paste>/tmp/pi-clipboard-abc.png</paste>");
	});

	it("gives adjacent pastes distinct boundaries (no merge)", () => {
		const pastes = new Map([
			[1, "curl one"],
			[2, "curl two"],
		]);
		const result = expandPasteMarkers("ini [paste #1 8 chars] ini juga [paste #2 8 chars]", pastes);
		expect(result).toBe("ini <paste>curl one</paste> ini juga <paste>curl two</paste>");
	});

	it("wraps line-counted markers too", () => {
		const pastes = new Map([[3, "line1\nline2\nline3"]]);
		const result = expandPasteMarkers("[paste #3 +3 lines]", pastes);
		expect(result).toBe("<paste>line1\nline2\nline3</paste>");
	});

	it("leaves text without markers unchanged", () => {
		const pastes = new Map([[1, "unused"]]);
		expect(expandPasteMarkers("plain text", pastes)).toBe("plain text");
	});

	it("is a no-op when there are no pastes", () => {
		expect(expandPasteMarkers("[paste #1 5 chars]", new Map())).toBe("[paste #1 5 chars]");
	});
});

// ─── image paste round-trip (insert → marker → wrapped expansion) ───────────

// Mirrors the real clipboard-image flow: Pi writes the image to a temp file and
// calls editor.insertTextAtCursor(path), which routes through replaceImagePaths;
// on submit, getExpandedText → expandPasteMarkers wraps each paste. We compose
// the two pure functions over a fake editor-internals object to prove the whole
// chain without standing up a live TUI editor.
describe("paste-chips image paste round-trip", () => {
	const makeInternals = () => ({
		pastes: new Map<number, string>(),
		pasteCounter: 0,
	});

	it("collapses a clipboard image path into an image marker", () => {
		const internals = makeInternals();
		const imageIds = new Set<number>();
		const path = "/tmp/pi-clipboard-abc123.png";

		const buffer = replaceImagePaths(path, internals, imageIds);

		expect(buffer).toBe(`[paste #1 ${path.length} chars]`);
		expect(internals.pastes.get(1)).toBe(path);
		expect(imageIds.has(1)).toBe(true);
	});

	it("expands the collapsed image path wrapped in <paste> tags", () => {
		const internals = makeInternals();
		const imageIds = new Set<number>();
		const path = "/tmp/pi-clipboard-abc123.png";

		const buffer = replaceImagePaths(path, internals, imageIds);
		const expanded = expandPasteMarkers(buffer, internals.pastes);

		expect(expanded).toBe(`<paste>${path}</paste>`);
	});

	it("keeps two pasted images on distinct boundaries", () => {
		const internals = makeInternals();
		const imageIds = new Set<number>();

		const first = replaceImagePaths("/tmp/one.png", internals, imageIds);
		const second = replaceImagePaths("/tmp/two.jpg", internals, imageIds);
		const expanded = expandPasteMarkers(`${first} ${second}`, internals.pastes);

		expect(expanded).toBe("<paste>/tmp/one.png</paste> <paste>/tmp/two.jpg</paste>");
		expect(imageIds.has(1)).toBe(true);
		expect(imageIds.has(2)).toBe(true);
	});

	it("leaves a non-image path uncollapsed (no marker, no wrapping)", () => {
		const internals = makeInternals();
		const imageIds = new Set<number>();

		const buffer = replaceImagePaths("/tmp/notes.txt", internals, imageIds);
		const expanded = expandPasteMarkers(buffer, internals.pastes);

		expect(buffer).toBe("/tmp/notes.txt");
		expect(internals.pastes.size).toBe(0);
		expect(expanded).toBe("/tmp/notes.txt");
	});

	it("restyles the image marker to an image chip in the display layer", () => {
		const internals = makeInternals();
		const imageIds = new Set<number>();
		const buffer = replaceImagePaths("/tmp/shot.png", internals, imageIds);

		const stripped = stripAnsi(restyleMarkers(buffer, imageIds));

		expect(stripped).toBe("󰋩 image #1");
	});
});

// ─── endsWithMarker (trailing-space gate) ──────────────────────────────

describe("paste-chips endsWithMarker", () => {
	it("matches a chars marker at end of string", () => {
		expect(endsWithMarker("[paste #1 2232 chars]")).toBe(true);
	});

	it("matches a lines marker at end of string", () => {
		expect(endsWithMarker("hello [paste #2 +42 lines]")).toBe(true);
	});

	it("matches a bare marker at end of string", () => {
		expect(endsWithMarker("[paste #3]")).toBe(true);
	});

	it("does not match when marker is not at the end", () => {
		expect(endsWithMarker("[paste #1 58 chars] trailing")).toBe(false);
	});

	it("does not match plain text", () => {
		expect(endsWithMarker("just some text")).toBe(false);
	});

	it("does not match a lone trailing space", () => {
		expect(endsWithMarker(" ")).toBe(false);
	});
});
