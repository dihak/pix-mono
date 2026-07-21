import { pixConfig } from "@dihak/pix-data/pix-config";

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
