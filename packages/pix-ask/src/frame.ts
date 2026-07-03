/**
 * Modal frame primitives — inlined from pix-pretty/modal-frame to avoid
 * cross-package subpath imports that break under Node CJS require.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 40;
const MAX_WIDTH = 96;
const MARGIN = 4;
/** 2 border cols + 2 padding spaces */
const CHROME = 4;

// ── Width ─────────────────────────────────────────────────────────────────────

/** Clamp terminal width to a sane modal width (40–96 cols). */
export function modalWidth(termWidth: number): number {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, termWidth - MARGIN));
}

// ── Frame ─────────────────────────────────────────────────────────────────────

export interface FrameOptions {
	width: number;
	lines: string[];
	/** Color function for border glyphs — e.g. `(s) => theme.fg("accent", s)` */
	color: (s: string) => string;
	/** Background fill function — e.g. `(s) => theme.bg("customMessageBg", s)` */
	bg?: (s: string) => string;
	/** Optional pre-styled string rendered as the first content row (tab bar etc.) */
	top?: string;
}

/**
 * Render a rounded modal box.
 *
 * Returns an array of full-width ANSI strings:
 *   ╭──────────────────╮
 *   │ [top row]        │   ← only if top is set
 *   │ content line 1   │
 *   │ content line 2   │
 *   ╰──────────────────╯
 */
export function frameLines(opts: FrameOptions): string[] {
	const { width, lines, color, top } = opts;
	const bg = opts.bg ?? ((s: string) => s);
	const inner = Math.max(1, width - CHROME);
	const dashes = "─".repeat(width - 2);

	const SENTINEL = "\x00";
	const bgOpen = bg(SENTINEL).split(SENTINEL)[0] ?? "";
	const reassert = (s: string): string =>
		bgOpen
			? s.replace(/\x1b\[([0-9;]*)m/g, (seq, p: string) =>
					p === "0" || p.split(";").includes("49") ? `${seq}${bgOpen}` : seq,
				)
			: s;

	const row = (content: string): string => {
		const pad = inner - visibleWidth(content);
		const padded = pad > 0 ? content + " ".repeat(pad) : truncateToWidth(content, inner);
		return bg(`${color("│")} ${reassert(padded)} ${color("│")}`);
	};

	const out: string[] = [bg(color(`╭${dashes}╮`))];
	if (top !== undefined) out.push(row(top));
	for (const line of lines) out.push(row(line));
	out.push(bg(color(`╰${dashes}╯`)));
	return out;
}
