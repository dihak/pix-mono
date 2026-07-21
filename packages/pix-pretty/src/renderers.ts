import { getLsStyle } from "@dihak/pix-data/pix-config";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { BOLD, FG_BLUE, FG_DIM, FG_GREEN, FG_RED, FG_RULE, FG_YELLOW, RST } from "./ansi.js";
import { MAX_PREVIEW_LINES } from "./config.js";
import { hlBlock } from "./highlight.js";
import { dirIcon, fileIcon } from "./icons.js";
import { lang } from "./lang.js";
import { lnum, normalizeLineEndings, pluralize, rule, termW } from "./utils.js";

/** Render syntax-highlighted file content with line numbers. */
export async function renderFileContent(
	content: string,
	filePath: string,
	offset = 1,
	maxLines = MAX_PREVIEW_LINES,
): Promise<string> {
	const normalizedContent = normalizeLineEndings(content);
	const lines = normalizedContent.split("\n");
	const total = lines.length;
	const show = lines.slice(0, maxLines);
	const lg = lang(filePath);
	const hl = await hlBlock(show.join("\n"), lg);

	const tw = termW();
	const startLine = offset;
	const endLine = startLine + show.length - 1;
	const nw = Math.max(3, String(endLine).length);
	const gw = nw + 3; // num + " │ "
	const cw = Math.max(1, tw - gw);

	const out: string[] = [];
	out.push(rule(tw));

	for (let i = 0; i < hl.length; i++) {
		const ln = startLine + i;
		const code = hl[i] ?? show[i] ?? "";
		const display = truncateToWidth(code, cw, `${FG_DIM}›`);
		out.push(`${lnum(ln, nw)} ${FG_RULE}│${RST} ${display}${RST}`);
	}

	out.push(rule(tw));
	if (total > maxLines) {
		out.push(`${FG_DIM}  … ${pluralize(total - maxLines, "more line")} (${total} total)${RST}`);
	}
	return out.join("\n");
}

/** Render bash output with colored exit code and stderr highlighting. */
export function renderBashOutput(
	text: string,
	exitCode: number | null,
): { summary: string; body: string } {
	const isOk = exitCode === 0;
	const statusFg = isOk ? FG_GREEN : FG_RED;
	const statusIcon = isOk ? "✓" : "✗";
	const codeStr =
		exitCode !== null
			? `${statusFg}${statusIcon} exit ${exitCode}${RST}`
			: `${FG_YELLOW}⚡ killed${RST}`;

	const lines = text.split("\n");
	const maxShow = MAX_PREVIEW_LINES;
	const show = lines.slice(0, maxShow);
	const remaining = lines.length - maxShow;

	let body = show.join("\n");
	if (remaining > 0) {
		body += `\n${FG_DIM}  … ${pluralize(remaining, "more line")}${RST}`;
	}

	return { summary: codeStr, body };
}

/** Render ls output using the configured style (grid or tree). */
export function renderTree(text: string, basePath: string): string {
	return getLsStyle() === "tree" ? renderLsTree(text, basePath) : renderLsGrid(text, basePath);
}

/** Vertical tree view with connectors and icons. */
function renderLsTree(text: string, _basePath: string): string {
	const lines = text.trim().split("\n").filter(Boolean);
	if (!lines.length) return `${FG_DIM}(empty directory)${RST}`;

	const out: string[] = [];
	const total = lines.length;
	const show = lines.slice(0, MAX_PREVIEW_LINES);

	for (let i = 0; i < show.length; i++) {
		const entry = (show[i] ?? "").trim();
		const isLast = i === show.length - 1 && total <= MAX_PREVIEW_LINES;
		const prefix = isLast ? "└── " : "├── ";
		const connector = `${FG_RULE}${prefix}${RST}`;

		const isDir = entry.endsWith("/");
		const name = isDir ? entry.slice(0, -1) : entry;
		const icon = isDir ? dirIcon() : fileIcon(name);
		const fg = isDir ? FG_BLUE + BOLD : "";
		const reset = isDir ? RST : "";

		out.push(`${connector}${icon}${fg}${name}${reset}`);
	}

	if (total > MAX_PREVIEW_LINES) {
		out.push(
			`${FG_RULE}└── ${RST}${FG_DIM}… ${pluralize(total - MAX_PREVIEW_LINES, "more entry", "more entries")}${RST}`,
		);
	}

	return out.join("\n");
}

/** Horizontal grid with icons (like eza/ls). */
function renderLsGrid(text: string, _basePath: string): string {
	const lines = text.trim().split("\n").filter(Boolean);
	if (!lines.length) return `${FG_DIM}(empty directory)${RST}`;

	const total = lines.length;
	const show = lines.slice(0, MAX_PREVIEW_LINES);

	// Build styled cells + measure their visible widths
	const cells: string[] = [];
	const cellWidths: number[] = [];

	for (const raw of show) {
		const entry = raw.trim();
		const isDir = entry.endsWith("/");
		const name = isDir ? entry.slice(0, -1) : entry;
		const icon = isDir ? dirIcon() : fileIcon(name);
		const fg = isDir ? FG_BLUE + BOLD : "";
		const reset = isDir ? RST : "";
		const cell = `${icon}${fg}${name}${reset}`;
		cells.push(cell);
		cellWidths.push(visibleWidth(cell));
	}

	// Layout into columns that fit the terminal width
	const tw = termW();
	const GAP = 3; // spaces between columns
	const rows = layoutGrid(cells, cellWidths, tw, GAP);

	if (total > MAX_PREVIEW_LINES) {
		rows.push(
			`${FG_DIM}… ${pluralize(total - MAX_PREVIEW_LINES, "more entry", "more entries")}${RST}`,
		);
	}

	return rows.join("\n");
}

/**
 * Lay out styled cells into a grid that fills rows left-to-right,
 * using as many columns as fit within `maxWidth`.
 */
function layoutGrid(cells: string[], widths: number[], maxWidth: number, gap: number): string[] {
	const n = cells.length;
	if (n === 0) return [];

	// Try increasing column counts to find the maximum that fits
	let bestCols = 1;
	for (let cols = 2; cols <= n; cols++) {
		const numRows = Math.ceil(n / cols);
		let totalW = 0;
		let fits = true;
		for (let c = 0; c < cols; c++) {
			// Find max width in this column
			let colW = 0;
			for (let r = 0; r < numRows; r++) {
				const idx = r * cols + c;
				if (idx < n && (widths[idx] ?? 0) > colW) colW = widths[idx] ?? 0;
			}
			totalW += colW + (c < cols - 1 ? gap : 0);
			if (totalW > maxWidth) {
				fits = false;
				break;
			}
		}
		if (fits) bestCols = cols;
		else break;
	}

	const cols = bestCols;
	const numRows = Math.ceil(n / cols);

	// Compute column widths
	const colWidths: number[] = [];
	for (let c = 0; c < cols; c++) {
		let colW = 0;
		for (let r = 0; r < numRows; r++) {
			const idx = r * cols + c;
			if (idx < n && (widths[idx] ?? 0) > colW) colW = widths[idx] ?? 0;
		}
		colWidths.push(colW);
	}

	// Render rows
	const out: string[] = [];
	for (let r = 0; r < numRows; r++) {
		const parts: string[] = [];
		for (let c = 0; c < cols; c++) {
			const idx = r * cols + c;
			if (idx >= n) break;
			const cell = cells[idx] ?? "";
			const w = widths[idx] ?? 0;
			const target = colWidths[c] ?? 0;
			// Pad to column width, except for the last column in a row
			const pad = c < cols - 1 ? " ".repeat(Math.max(0, target - w + gap)) : "";
			parts.push(cell + pad);
		}
		out.push(parts.join(""));
	}

	return out;
}

// ---------------------------------------------------------------------------
// FFF integration (optional) — Fast File Finder with frecency & SIMD search
//
// If @ff-labs/fff-node is installed, find/grep use FFF for speed + frecency.
// If not, falls back to wrapping SDK tools (current behavior).
// ---------------------------------------------------------------------------
