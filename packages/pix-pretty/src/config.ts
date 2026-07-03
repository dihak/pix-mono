import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pixConfig } from "@xynogen/pix-data/pix-config";
import type { BundledTheme } from "./types.js";

const DEFAULT_THEME: BundledTheme = "github-dark";

export function getDefaultAgentDir(): string | undefined {
	const home = process.env.HOME ?? "";
	return home ? join(home, ".pi/agent") : undefined;
}

function readThemeFromSettings(agentDir?: string): BundledTheme | undefined {
	const resolvedAgentDir = agentDir ?? getDefaultAgentDir();
	if (!resolvedAgentDir) return undefined;

	try {
		const settings = JSON.parse(readFileSync(join(resolvedAgentDir, "settings.json"), "utf8")) as {
			theme?: unknown;
		};
		return typeof settings.theme === "string" ? (settings.theme as BundledTheme) : undefined;
	} catch {
		return undefined;
	}
}

function resolvePrettyTheme(agentDir?: string): BundledTheme {
	// Precedence: env → pix.json → settings.json → default
	return (
		(process.env.PRETTY_THEME as BundledTheme | undefined) ??
		(pixConfig().pretty.theme as BundledTheme) ??
		readThemeFromSettings(agentDir) ??
		DEFAULT_THEME
	);
}

export let THEME: BundledTheme = resolvePrettyTheme();

export function setPrettyTheme(agentDir?: string): void {
	const resolvedTheme = resolvePrettyTheme(agentDir);
	if (resolvedTheme === THEME) return;
	THEME = resolvedTheme;
}

export function envInt(name: string, fallback: number): number {
	const v = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Precedence for numeric config: env var → pix.json → hardcoded default
function pixOrEnvInt(envName: string, pixValue: number, fallback: number): number {
	const env = process.env[envName];
	if (env) {
		const v = Number.parseInt(env, 10);
		if (Number.isFinite(v) && v > 0) return v;
	}
	return pixValue !== fallback ? pixValue : fallback;
}

const pc = pixConfig().pretty;

export const MAX_HL_CHARS = pixOrEnvInt("PRETTY_MAX_HL_CHARS", pc.maxHighlightChars, 80_000);

export const MAX_PREVIEW_LINES = pixOrEnvInt("PRETTY_MAX_PREVIEW_LINES", pc.maxPreviewLines, 80);

export const CACHE_LIMIT = pixOrEnvInt("PRETTY_CACHE_LIMIT", pc.cacheLimit, 128);

// --- Diff rendering limits (edit/write tools) ---
export const MAX_RENDER_LINES = pixOrEnvInt("PRETTY_MAX_RENDER_LINES", pc.maxRenderLines, 150);

// Word-level emphasis only when paired del/add lines are at least this similar.
export const WORD_DIFF_MIN_SIM = 0.15;

// ---------------------------------------------------------------------------
// ANSI
// ---------------------------------------------------------------------------
