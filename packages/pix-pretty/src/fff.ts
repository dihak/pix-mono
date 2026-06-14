import { join } from "node:path";

import type { GrepCursor, GrepMatch } from "@ff-labs/fff-node";

import type { FffBackedFinder, OptionalFffModule } from "./types.js";

export interface FffState {
	module: OptionalFffModule | null;
	finder: FffBackedFinder | null;
	partialIndex: boolean;
	dbDir: string | null;
}

export const fffState: FffState = {
	module: null,
	finder: null,
	partialIndex: false,
	dbDir: null,
};

export const FFF_SCAN_TIMEOUT = 15_000;

export function getPiPrettyFffDir(_agentDir: string): string {
	// FFF state lives under the XDG cache dir, not the agent dir.
	// Override with PRETTY_FFF_DIR; otherwise ~/.cache/pi/fff
	// ($XDG_CACHE_HOME/pi/fff when XDG_CACHE_HOME is set).
	const override = process.env.PRETTY_FFF_DIR?.trim();
	if (override) return override;
	const home = process.env.HOME ?? "";
	const cacheHome = process.env.XDG_CACHE_HOME?.trim() || join(home, ".cache");
	return join(cacheHome, "pi", "fff");
}

export async function fffEnsureFinder(
	cwd: string,
): Promise<FffBackedFinder | null> {
	if (fffState.finder && !fffState.finder.isDestroyed) return fffState.finder;
	if (!fffState.module || !fffState.dbDir) return null;

	const result = fffState.module.FileFinder.create({
		basePath: cwd,
		frecencyDbPath: join(fffState.dbDir, "frecency.mdb"),
		historyDbPath: join(fffState.dbDir, "history.mdb"),
		aiMode: true,
	});

	if (!result.ok) throw new Error(`FFF init failed: ${result.error}`);

	fffState.finder = result.value;
	const scan = await fffState.finder.waitForScan(FFF_SCAN_TIMEOUT);
	fffState.partialIndex = scan.ok && !scan.value;

	return fffState.finder;
}

export function fffDestroy(): void {
	if (fffState.finder && !fffState.finder.isDestroyed) {
		fffState.finder.destroy();
		fffState.finder = null;
	}
	fffState.partialIndex = false;
}

// ---------------------------------------------------------------------------
// FFF helpers (CursorStore, grep formatting)
// ---------------------------------------------------------------------------

function sanitizeGrepRecordContent(text: string): string {
	let content = text;
	if (content.endsWith("\r\n")) content = content.slice(0, -2);
	else if (content.endsWith("\r") || content.endsWith("\n"))
		content = content.slice(0, -1);

	return content
		.replace(/\r\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\n/g, "\\n");
}

function truncateGrepRecordContent(text: string): string {
	const content = sanitizeGrepRecordContent(text);
	return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

/**
 * Store for FFF grep pagination cursors.
 * Evicts oldest entry when exceeding maxSize.
 */
export class CursorStore {
	private cursors = new Map<string, GrepCursor>();
	private counter = 0;
	private maxSize: number;

	constructor(maxSize = 200) {
		this.maxSize = maxSize;
	}

	store(cursor: GrepCursor): string {
		const id = `fff_c${++this.counter}`;
		this.cursors.set(id, cursor);
		if (this.cursors.size > this.maxSize) {
			const first = this.cursors.keys().next().value;
			if (first) this.cursors.delete(first);
		}
		return id;
	}

	get(id: string): GrepCursor | undefined {
		return this.cursors.get(id);
	}

	get size(): number {
		return this.cursors.size;
	}
}

/**
 * Convert FFF GrepResult items to ripgrep-style "file:line:content" text.
 */
export function fffFormatGrepText(items: GrepMatch[], limit: number): string {
	const capped = items.slice(0, limit);
	if (!capped.length) return "No matches found";

	const lines: string[] = [];
	let currentFile = "";

	for (const match of capped) {
		if (match.relativePath !== currentFile) {
			if (currentFile) lines.push("");
			currentFile = match.relativePath;
		}
		if (match.contextBefore?.length) {
			const startLine = match.lineNumber - match.contextBefore.length;
			for (let i = 0; i < match.contextBefore.length; i++) {
				lines.push(
					`${match.relativePath}-${startLine + i}-${truncateGrepRecordContent(match.contextBefore[i] ?? "")}`,
				);
			}
		}
		lines.push(
			`${match.relativePath}:${match.lineNumber}:${truncateGrepRecordContent(match.lineContent)}`,
		);
		if (match.contextAfter?.length) {
			const startLine = match.lineNumber + 1;
			for (let i = 0; i < match.contextAfter.length; i++) {
				lines.push(
					`${match.relativePath}-${startLine + i}-${truncateGrepRecordContent(match.contextAfter[i] ?? "")}`,
				);
			}
		}
	}

	return lines.join("\n");
}
