/**
 * Tests for paste-chips marker restyling and width safety.
 *
 * Regression: restyling markers can widen lines (e.g. "#1" → "text"),
 * which caused a TUI crash when the restyled line exceeded terminal width.
 * See: pi-crash.log — "Rendered line 38 exceeds terminal width (285 > 283)"
 */

import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { restyleMarkers } from "./paste-chips";

// ─── restyleMarkers ──────────────────────────────────────────────────────────

describe("paste-chips restyleMarkers", () => {
	describe("text markers", () => {
		it("restyles chars marker to text label", () => {
			const result = restyleMarkers("[paste #1 2232 chars]", new Set());
			expect(result).toBe("[paste text 2232 chars]");
		});

		it("restyles lines marker to text label", () => {
			const result = restyleMarkers("[paste #2 +42 lines]", new Set());
			expect(result).toBe("[paste text +42]");
		});

		it("restyles bare marker (no size info) to text label", () => {
			const result = restyleMarkers("[paste #3]", new Set());
			expect(result).toBe("[paste text #3]");
		});
	});

	describe("image markers", () => {
		it("restyles marker to image label when ID is in imageIds", () => {
			const imageIds = new Set([1]);
			const result = restyleMarkers("[paste #1 58 chars]", imageIds);
			expect(result).toBe("[paste image #1]");
		});

		it("does not restyle non-image ID as image", () => {
			const imageIds = new Set([1]);
			const result = restyleMarkers("[paste #2 100 chars]", imageIds);
			expect(result).toBe("[paste text 100 chars]");
		});
	});

	describe("multiple markers in one line", () => {
		it("restyles all markers in a single line", () => {
			const imageIds = new Set([1]);
			const line =
				"before [paste #1 58 chars] middle [paste #2 +10 lines] after";
			const result = restyleMarkers(line, imageIds);
			expect(result).toBe(
				"before [paste image #1] middle [paste text +10] after",
			);
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
			expect(result).toBe("\x1b[38;2;84;92;126m[paste text 500 chars]\x1b[0m");
		});
	});
});

// ─── Width safety (regression for crash) ─────────────────────────────────────

describe("paste-chips width safety", () => {
	it("restyling a chars marker can increase visible width", () => {
		// This is the core issue: "#1" (2 chars) → "text" (4 chars) = +2 width
		const original = "[paste #1 2232 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(visibleWidth(restyled)).toBeGreaterThan(visibleWidth(original));
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

	it("chars marker with large char count widens by 2", () => {
		// "[paste #N CCCC chars]" → "[paste text CCCC chars]"
		// "#N" (2 chars for single digit) → "text" (4 chars) = exactly +2
		const original = "[paste #1 9999 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(visibleWidth(restyled) - visibleWidth(original)).toBe(2);
	});

	it("chars marker with multi-digit ID has smaller delta", () => {
		// "#10" (3 chars) → "text" (4 chars) = +1
		const original = "[paste #10 9999 chars]";
		const restyled = restyleMarkers(original, new Set());
		expect(visibleWidth(restyled) - visibleWidth(original)).toBe(1);
	});

	describe("reproduces crash scenario", () => {
		it("restyled line exceeds terminal width without clamping", () => {
			// Simulate the crash: a line at exactly terminal width (283)
			// containing a marker that widens by 2 after restyling.
			const terminalWidth = 283;
			const marker = "[paste #1 2232 chars]"; // 21 chars
			const padding = " ".repeat(terminalWidth - visibleWidth(marker));
			const line = marker + padding;

			// Verify the original line fits
			expect(visibleWidth(line)).toBe(terminalWidth);

			// Restyle it — this WOULD exceed width without the fix
			const restyled = restyleMarkers(line, new Set());
			expect(visibleWidth(restyled)).toBeGreaterThan(terminalWidth);
			// Specifically: "[paste text 2232 chars]" is 23 chars, +2 over original 21
			expect(visibleWidth(restyled)).toBe(terminalWidth + 2);
		});
	});
});
