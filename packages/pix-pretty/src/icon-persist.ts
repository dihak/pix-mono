/**
 * icon-persist.ts — disk persistence for the global icon mode.
 *
 * Stores the single icon mode in ~/.pi/agent/pretty.json so a choice made via
 * /pretty survives quit/restart. Kept separate from icon-catalog.ts so the
 * catalog resolver stays pure (no fs) and trivially testable.
 *
 *   ~/.pi/agent/pretty.json  ->  { "icons": "unicode" }
 *
 * Precedence: a persisted value wins; otherwise the catalog's env-seeded
 * default (PRETTY_ICONS) stands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ICON_MODES, type IconMode, setIconMode } from "./icon-catalog.js";

function isIconMode(m: string): m is IconMode {
	return (ICON_MODES as readonly string[]).includes(m);
}

function statePath(): string {
	return join(getAgentDir(), "pretty.json");
}

/** Read the persisted icon mode, or undefined if unset/invalid/missing. */
export function loadIconMode(): IconMode | undefined {
	try {
		const p = statePath();
		if (!existsSync(p)) return undefined;
		const raw = JSON.parse(readFileSync(p, "utf-8")) as { icons?: string };
		const mode = raw?.icons;
		if (mode == null) return undefined;
		return isIconMode(mode) ? mode : undefined;
	} catch {
		return undefined;
	}
}

/** Persist the icon mode, merging into pretty.json. */
export function saveIconMode(mode: IconMode): void {
	try {
		const p = statePath();
		mkdirSync(dirname(p), { recursive: true });
		let existing: Record<string, unknown> = {};
		if (existsSync(p)) {
			try {
				existing = JSON.parse(readFileSync(p, "utf-8")) as Record<
					string,
					unknown
				>;
			} catch {
				existing = {};
			}
		}
		writeFileSync(p, JSON.stringify({ ...existing, icons: mode }, null, 2));
	} catch (err) {
		console.warn("pix-pretty: persist icon mode failed:", err);
	}
}

/**
 * Apply the persisted mode (if any) to the catalog. Called once at extension
 * load so the env-seeded default is overridden by the user's saved choice.
 */
export function initIconMode(): void {
	const saved = loadIconMode();
	if (saved) setIconMode(saved);
}
