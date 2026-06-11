import { relative } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	ANSI_CAPTURE_RE,
	BG_BASE,
	BG_ERROR,
	FG_LNUM,
	FG_RULE,
	RST,
} from "./ansi.js";
import type {
	FgTheme,
	ToolContent,
	ToolImageContent,
	ToolResultLike,
	ToolTextContent,
} from "./types.js";

export function renderToolError(error: string, theme: FgTheme): string {
	return fillToolBackground(`\n${theme.fg("error", error)}`, BG_ERROR);
}

export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function preserveToolBackground(ansi: string, bg: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (seq, params: string) => {
		const codes = params.split(";");
		return params === "0" || codes.includes("49") ? `${seq}${bg}` : seq;
	});
}

export function fillToolBackground(text: string, bg = BG_BASE): string {
	const width = termW();
	return text
		.split("\n")
		.map((line) => {
			const normalized = preserveToolBackground(line, bg);
			const fitted = preserveToolBackground(
				truncateToWidth(normalized, width, ""),
				bg,
			);
			const padding = Math.max(0, width - visibleWidth(fitted));
			return `${bg}${fitted}${" ".repeat(padding)}${RST}`;
		})
		.join("\n");
}

let _cachedTermW: number | undefined;

/** Read terminal width — checks all available sources in priority order.
 *  Falls back to querying the controlling tty via fd 1/2/stdin ioctl.
 *  Result is cached and invalidated on SIGWINCH / stdout resize. */
export function termW(): number {
	if (_cachedTermW !== undefined) return _cachedTermW;

	const stderrWithColumns = process.stderr as NodeJS.WriteStream & {
		columns?: number;
	};
	const raw =
		process.stdout.columns ||
		stderrWithColumns.columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		_readTtyColumns() ||
		120;
	_cachedTermW = Math.max(1, Math.min(raw, 210));

	// Invalidate on resize so next call re-reads
	process.stdout.once("resize", () => {
		_cachedTermW = undefined;
	});
	process.stdin.once("resize", () => {
		_cachedTermW = undefined;
	});

	return _cachedTermW;
}

/** Synchronously query the tty size via Node's built-in ioctl binding.
 *  Works even when stdout/stderr are piped, as long as stdin is a tty. */
function _readTtyColumns(): number | undefined {
	try {
		// Node exposes getWindowSize() on tty.ReadStream / tty.WriteStream
		const { getWindowSize } = require("tty") as {
			getWindowSize?: (fd: number) => [number, number];
		};
		if (getWindowSize) {
			// Try fd 1 (stdout), 2 (stderr), 0 (stdin) in order
			for (const fd of [1, 2, 0]) {
				try {
					const [cols] = getWindowSize(fd);
					if (cols && cols > 0) return cols;
				} catch {
					/* fd not a tty */
				}
			}
		}
	} catch {
		/* tty module unavailable */
	}
	return undefined;
}

export function shortPath(cwd: string, home: string, p: string): string {
	if (!p) return "";
	const r = relative(cwd, p);
	if (!r.startsWith("..") && !r.startsWith("/")) return r;
	return p.replace(home, "~");
}

export function rule(w: number): string {
	return `${FG_RULE}${"─".repeat(w)}${RST}`;
}

export function lnum(n: number, w: number): string {
	const v = String(n);
	return `${FG_LNUM}${" ".repeat(Math.max(0, w - v.length))}${v}${RST}`;
}

// ---------------------------------------------------------------------------
// Human-readable file size
// ---------------------------------------------------------------------------

export function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// File-type icons — Nerd Font glyphs (Seti-UI + Devicons, stable in NF v3+)
//
// Requires a Nerd Font installed (e.g., JetBrainsMono Nerd Font, FiraCode NF).
// Fallback: set PRETTY_ICONS=none to disable icons.
// ---------------------------------------------------------------------------

export function isTextContent(
	content: ToolContent,
): content is ToolTextContent {
	return content.type === "text";
}

export function isImageContent(
	content: ToolContent,
): content is ToolImageContent {
	return content.type === "image";
}

export function getTextContent(result: ToolResultLike): string {
	return (
		result.content
			?.filter(isTextContent)
			.map((content) => content.text || "")
			.join("\n") ?? ""
	);
}

export function setResultDetails<T>(result: ToolResultLike, details: T): void {
	result.details = details;
}

export function makeTextResult<TDetails>(
	text: string,
	details: TDetails,
): ToolResultLike<TDetails> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

export function appendNotices(text: string, notices: string[]): string {
	return notices.length ? `${text}\n\n[${notices.join(". ")}]` : text;
}

export function countRipgrepMatches(text: string): number {
	return text
		.trim()
		.split("\n")
		.filter((line) => /^.+?[:-]\d+[:-]/.test(line)).length;
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function trimToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function escapeRegexLiteral(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildLiteralAlternationPattern(patterns: string[]): string {
	return patterns
		.map(escapeRegexLiteral)
		.sort((a, b) => b.length - a.length)
		.join("|");
}

export function shouldIgnoreCaseForPatterns(patterns: string[]): boolean {
	return patterns.every((pattern) => pattern.toLowerCase() === pattern);
}

export function getConstraintBackedPath(
	constraints: string | undefined,
): string | undefined {
	const trimmed = trimToUndefined(constraints);
	if (
		!trimmed ||
		/\s/.test(trimmed) ||
		trimmed.includes("!") ||
		trimmed.endsWith("/") ||
		/[*?[{]/.test(trimmed)
	) {
		return undefined;
	}
	return trimmed;
}
