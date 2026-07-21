/**
 * ponytail.ts — pure logic + Pi extension
 *
 * "Lazy senior dev" mode: governs WHAT the agent builds (minimal code, YAGNI),
 * orthogonal to caveman which governs HOW it talks. Pure helpers exported for
 * tests; ponytail(pi, status) is the extension entry, wired by index.ts.
 *
 * Ruleset adapted from DietrichGebert/ponytail (MIT), the "lazy senior dev"
 * skill. We inject it as a system-prompt fragment — no external hooks/files.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadOptValue, saveOptValue } from "./persist.ts";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

// ── Levels ────────────────────────────────────────────────────────────────────

export const LEVELS = ["off", "lite", "full", "ultra"] as const;

export type Level = (typeof LEVELS)[number];

export const STOP_ALIASES = new Set(["off", "stop", "quit", "0"]);

// Numeric shortcuts: /opt ponytail 1|2|3
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
};

// ── Prompt fragments ──────────────────────────────────────────────────────────

const BASE = `\
PONYTAIL MODE ACTIVE. You are a lazy senior developer. Lazy means efficient, \
not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:
1. Does this need to exist at all? Speculative need = skip it, say so in one line. (YAGNI)
2. Stdlib does it? Use it.
3. Native platform feature covers it? Use it (\`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code).
4. Already-installed dependency solves it? Use it. Never add a new one for what a few lines can do.
5. Can it be one line? One line.
6. Only then: the minimum code that works.

The ladder is a reflex, not a research project. Two rungs work → take the higher one and move on.

Rules:
- No unrequested abstractions: no interface with one impl, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later". Deletion over addition. Boring over clever. Fewest files possible.
- Complex request? Ship the lazy version and question it in the same response. Never stall on an answer you can default.
- Two same-size stdlib options? Take the one correct on edge cases. Lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications with a normal code comment naming the ceiling and the upgrade path.`;

const INTENSITY: Record<Exclude<Level, "off">, string> = {
	lite: `\
Build what's asked, but name the lazier alternative in one line. User picks.
Example: "Done, cache added. FYI: \`functools.lru_cache\` covers this in one line if you'd rather not own a cache class."`,

	full: `\
The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation.
Example: "\`@lru_cache(maxsize=1000)\` on the fetch function. Skipped custom cache class, add when lru_cache measurably falls short."`,

	ultra: `\
YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same breath.
Example: "No cache until a profiler says so. When it does: \`@lru_cache\`. A hand-rolled TTL cache class is a bug farm with a hit rate."`,
};

const SAFETY = `\
When NOT to be lazy: never simplify away input validation at trust boundaries, \
error handling that prevents data loss, security, accessibility, or anything \
explicitly requested. Hardware is never the spec ideal — leave the calibration knob.
Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind \
(an assert-based self-check or one small test file; no frameworks). Trivial one-liners need no test.
Output: code first, then at most three short lines — what was skipped, when to add it.
Boundaries: ponytail governs what you build, not how you talk. "stop ponytail" / "normal mode" reverts.`;

/**
 * Build the system prompt injection for a given level.
 * Returns empty string when level is "off".
 */
export function buildPrompt(level: Level): string {
	if (level === "off") return "";
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
 * Help text shown when /opt ponytail is run with no argument.
 */
export function buildHelp(current: Level): string {
	const statusLine = current === "off" ? "off" : `${STATUS_LABELS[current]} (${current})`;
	return [
		`Ponytail mode: ${statusLine}`,
		"",
		"Usage: /optimizer ponytail <level>",
		"  1  lite   - name the lazier alternative, you pick",
		"  2  full   - the ladder enforced (default)",
		"  3  ultra  - YAGNI extremist",
		"  0  off    - disable (aliases: off, stop, quit)",
		"",
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

export function ponytail(pi: ExtensionAPI, status: OptimizerStatus): OptimizerHandle {
	let level: Level = "off";

	// -- Status: report into the shared optimizer indicator. --

	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		status.set("ponytail", level !== "off", ctx);
	}

	// Inject ponytail prompt via before_agent_start
	pi.on("before_agent_start", async (event, _ctx) => {
		const prompt = buildPrompt(level);
		if (!prompt) return undefined;
		const existing = event.systemPrompt ?? "";
		return { systemPrompt: `${prompt}\n\n${existing}` };
	});

	// -- Restore live level from the session log on load --

	pi.on("session_start", async (_event, ctx) => {
		// Session log first (in-session branch nav), then disk (survives a full
		// quit/restart). Disk wins when present.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "ponytail-level") {
				level = (entry.data as { level: Level })?.level ?? level;
			}
		}
		const saved = loadOptValue("ponytail");
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

	async function run(value: string, ctx: ExtensionCommandContext): Promise<void> {
		const resolved = resolveLevel(value);
		if (resolved === null) return;
		level = resolved;

		pi.appendEntry("ponytail-level", { level });
		saveOptValue("ponytail", level);
		syncStatus(ctx);

		ctx.ui.notify(
			level === "off" ? "Ponytail mode off." : `Ponytail: ${STATUS_LABELS[level]}`,
			"info",
		);
	}

	return {
		name: "ponytail",
		help: "ponytail — lazy senior dev (minimal code)",
		values: LEVELS,
		current: () => level,
		run,
	};
}
