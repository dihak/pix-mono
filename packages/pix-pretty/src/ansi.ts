import type { BgTheme } from "./types.js";

export let RST = "\x1b[0m";
export const BOLD = "\x1b[1m";

export const FG_LNUM = "\x1b[38;2;100;100;100m";
export const FG_DIM = "\x1b[38;2;80;80;80m";
export const FG_RULE = "\x1b[38;2;50;50;50m";
export const FG_GREEN = "\x1b[38;2;100;180;120m";
export const FG_RED = "\x1b[38;2;200;100;100m";
export const FG_YELLOW = "\x1b[38;2;220;180;80m";
export const FG_BLUE = "\x1b[38;2;100;140;220m";
const FG_MUTED = "\x1b[38;2;139;148;158m";

const BG_DEFAULT = "\x1b[49m";
export let BG_BASE = BG_DEFAULT; // tool box success/base bg — updated from theme's toolSuccessBg
export let BG_ERROR = BG_DEFAULT; // tool box error bg — updated from theme's toolErrorBg

/** Parse an ANSI 24-bit color escape into { r, g, b }. Handles both fg (38;2) and bg (48;2). */
function parseAnsiRgb(
	ansi: string,
): { r: number; g: number; b: number } | null {
	const m = ansi.match(
		new RegExp(`${ESC_RE}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`),
	);
	return m ? { r: +(m[1] ?? 0), g: +(m[2] ?? 0), b: +(m[3] ?? 0) } : null;
}

function getThemeBgAnsi(theme: BgTheme, key: string): string | null {
	try {
		const bgAnsi = theme.getBgAnsi?.(key);
		return bgAnsi && parseAnsiRgb(bgAnsi) ? bgAnsi : null;
	} catch {
		return null;
	}
}

/** Read themed tool backgrounds and update BG_BASE / BG_ERROR + RST.
 *  Recompute on each render so runtime theme changes are respected. */
export function resolveBaseBackground(theme: BgTheme | null | undefined): void {
	if (!theme?.getBgAnsi) return;

	BG_BASE =
		getThemeBgAnsi(theme, "toolBg") ??
		getThemeBgAnsi(theme, "background") ??
		BG_DEFAULT;
	BG_ERROR = getThemeBgAnsi(theme, "toolErrorBg") ?? BG_BASE;
	RST = `\x1b[0m${BG_BASE}`;
}

const ESC_RE = "\u001b";

export const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");

// ---------------------------------------------------------------------------
// Low-contrast fix (same as pi-diff)
// ---------------------------------------------------------------------------

function isLowContrastShikiFg(params: string): boolean {
	if (params === "30" || params === "90") return true;
	if (params === "38;5;0" || params === "38;5;8") return true;
	if (!params.startsWith("38;2;")) return false;
	const parts = params.split(";").map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n)))
		return false;
	const [, , r = 0, g = 0, b = 0] = parts;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

export function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (seq, params: string) =>
		isLowContrastShikiFg(params) ? FG_MUTED : seq,
	);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
