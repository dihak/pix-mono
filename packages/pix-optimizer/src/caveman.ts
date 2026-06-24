/**
 * caveman.ts — pure logic + Pi extension
 *
 * Pure helpers exported for tests; caveman(pi) is the extension entry,
 * called by index.ts alongside rtk(pi).
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadOptValue, saveOptValue } from "./persist.ts";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

// ── Levels ────────────────────────────────────────────────────────────────────

export const LEVELS = ["off", "lite", "full", "ultra", "micro"] as const;

export type Level = (typeof LEVELS)[number];

export const STOP_ALIASES = new Set(["off", "stop", "quit", "0"]);

// Numeric shortcuts: /caveman 1|2|3
export const LEVEL_NUMBERS: Record<string, Level> = {
	"1": "lite",
	"2": "full",
	"3": "ultra",
};

// ── Status labels ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<Exclude<Level, "off">, string> = {
	lite: "LITE",
	full: "FULL",
	ultra: "ULTRA",
	micro: "MICRO",
};

// ── Prompt fragments ──────────────────────────────────────────────────────────

const BASE = `\
IMPORTANT: You are in CAVEMAN MODE. Respond terse like smart caveman. \
All technical substance stay. Only fluff die.

Rules:
- Drop articles (a/an/the), filler (just/really/basically/actually/simply), \
pleasantries, hedging
- Fragments OK. Short synonyms preferred. Technical terms exact
- Code blocks unchanged. Errors quoted exact
- Pattern: [thing] [action] [reason]. [next step].

Bad: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Good: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"`;

const MICRO_PROMPT = `# Token efficiency
Respond like smart caveman. Cut all filler, keep technical substance.
- Drop articles (a, an, the), filler (just, really, basically, actually).
- Drop pleasantries (sure, certainly, happy to).
- No hedging. Fragments fine. Short synonyms.
- Technical terms stay exact. Code blocks unchanged.
- Pattern: [thing] [action] [reason]. [next step].`;

const INTENSITY: Record<Exclude<Level, "off" | "micro">, string> = {
	lite: `\
No filler/hedging. Keep articles + full sentences. Professional but tight.
Example: "Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."`,

	full: `\
Drop articles, fragments OK, short synonyms.
Example: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."`,

	ultra: `\
Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y).
Example: "Inline obj prop → new ref → re-render. \`useMemo\`."`,
};

const SAFETY = `\
Auto-clarity: drop caveman for security warnings, irreversible action confirmations, \
or when user is confused. Resume after.
Boundaries: write normal code. Only compress explanations. "stop caveman" or "normal mode" reverts.`;

/**
 * Build the system prompt injection for a given level.
 * Returns empty string when level is "off".
 */
export function buildPrompt(level: Level): string {
	if (level === "off") return "";
	if (level === "micro") return MICRO_PROMPT;
	return [BASE, "", `Intensity: ${INTENSITY[level]}`, "", SAFETY].join("\n");
}

// ── Level resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a raw command arg to a Level, or return null if unrecognised.
 * Handles stop aliases (stop/quit → "off") and valid level names.
 */
export function resolveLevel(arg: string): Level | null {
	const a = arg.trim().toLowerCase();
	if (STOP_ALIASES.has(a)) return "off";
	if (LEVEL_NUMBERS[a]) return LEVEL_NUMBERS[a];
	if (LEVELS.includes(a as Level)) return a as Level;
	return null;
}

/**
 * Help text shown when /caveman is run with no argument.
 */
export function buildHelp(current: Level): string {
	const statusLine =
		current === "off" ? "off" : `${STATUS_LABELS[current]} (${current})`;
	return [
		`Caveman mode: ${statusLine}`,
		"",
		"Usage: /caveman <level>",
		"  1  lite   - professional, no fluff",
		"  2  full   - classic caveman",
		"  3  ultra  - maximum compression",
		"  0  off    - disable (aliases: off, stop, quit)",
		"",
		"Other levels: micro",
		"  config    - open settings dialog",
	].join("\n");
}

/**
 * Toggle: off → full, anything else → off.
 */
export function toggleLevel(current: Level): Level {
	return current === "off" ? "full" : "off";
}

// ── Pi extension ────────────────────────────────────────────────────────────

export function caveman(
	pi: ExtensionAPI,
	status: OptimizerStatus,
): OptimizerHandle {
	let level: Level = "off";

	// -- Status: report into the shared optimizer indicator. --

	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		status.set("caveman", level !== "off", ctx);
	}

	// Inject caveman prompt via before_agent_start
	pi.on("before_agent_start", async (event, _ctx) => {
		const prompt = buildPrompt(level);
		if (!prompt) return undefined;
		const existing = event.systemPrompt ?? "";
		return { systemPrompt: `${prompt}\n\n${existing}` };
	});

	// -- Restore live level from the session log on load --

	pi.on("session_start", async (_event, ctx) => {
		// Session log first (survives in-session branch nav), then disk (survives
		// a full quit/restart). Disk wins when present so a new session restores
		// the last chosen level instead of defaulting to off.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "caveman-level") {
				level = (entry.data as { level: Level })?.level ?? level;
			}
		}
		const saved = loadOptValue("caveman");
		if (saved && LEVELS.includes(saved as Level)) level = saved as Level;
		syncStatus(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("session_shutdown", async () => {});

	// -- Overlay value handler (called by the /optimizer overlay) --

	async function run(
		value: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const resolved = resolveLevel(value);
		if (resolved === null) return;
		level = resolved;

		pi.appendEntry("caveman-level", { level });
		saveOptValue("caveman", level);
		syncStatus(ctx);

		ctx.ui.notify(
			level === "off"
				? "Caveman mode off."
				: `Caveman: ${STATUS_LABELS[level]}`,
			"info",
		);
	}

	return {
		name: "caveman",
		help: "caveman — terse output",
		values: LEVELS,
		current: () => level,
		run,
	};
}
