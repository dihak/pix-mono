/**
 * json.ts — JSON token-optimization via jq + TOON.
 *
 * A small system-prompt nudge teaching the model to run JSON through
 * `jq` (query/reshape) and `toon` (compress for context), and to convert
 * back to JSON only when a strict contract requires it.
 *
 * The bundled `toon-json` skill lives in pix-skills and is auto-discovered
 * from there — no resources_discover hook needed here.
 *
 * TOON = Token-Oriented Object Notation (https://github.com/toon-format/spec).
 * It shines on uniform/tabular arrays of objects (declare keys once, stream
 * rows) and loses to compact JSON on deeply nested / non-uniform / array-of-
 * arrays data. The prompt encodes that boundary so the model picks correctly.
 *
 * Pure helpers are exported for tests; json(pi) is the extension entry, called
 * by index.ts alongside caveman(pi) and rtk(pi).
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

// ── System prompt ───────────────────────────────────────────────────────────

export const JSON_SYSTEM_PROMPT = `# JSON Handling — jq + TOON

When working with information-dense JSON (LLM/OpenAPI schemas, API responses,
config dumps, datasets), prefer this pipeline over dumping raw JSON into context:

\`\`\`bash
curl -s <url> | jq '<query>' | toon          # fetch → reshape → compress
cat data.json   | jq '.items'  | toon --stats # local file, show token savings
echo "$TOON"    | toon -d                      # convert TOON back to JSON
\`\`\`

## Why
- **jq** queries/reshapes so you only carry the slice you need.
- **toon** re-encodes JSON as TOON: uniform arrays of objects declare their
  keys once (\`key[N]{a,b,c}:\`) then stream bare rows — large token savings on
  tabular/dense data. \`toon\` auto-detects direction; \`-d\` decodes back.

## When TOON helps (use it)
- Uniform/tabular arrays of objects (TOON's sweet spot — savings scale with rows × fields)
- Flat objects and primitive arrays
- Shallow nesting

## When to SKIP TOON (keep JSON)
- API-level contracts / payloads you must send or store verbatim
- Deeply nested or non-uniform structures (compact JSON can win)
- Arrays of arrays (TOON is less efficient here)
- Anything a downstream parser requires as strict JSON

Rule of thumb: TOON for **reading** dense data into context; JSON for **contracts**.
See the \`toon-json\` skill for the full workflow.`;

// ── Prompt relevance gate ─────────────────────────────────────────────────────

/**
 * Tokens that signal the user prompt is about JSON / the jq+TOON workflow.
 * Matched as whole words (case-insensitive) so "adjust" / "jsx" don't trip "js".
 */
const JSON_TRIGGERS = [
	"json",
	"jsonl",
	"ndjson",
	"js",
	"jq",
	"toon",
	"openapi",
	"swagger",
] as const;

const JSON_TRIGGER_RE = new RegExp(`\\b(${JSON_TRIGGERS.join("|")})\\b`, "i");

/**
 * True when the user prompt mentions JSON (or a related token), so the
 * jq+TOON guidance is only injected when actually relevant. Case-insensitive
 * and word-bounded ("JSON", "Json", "json" all match; "adjust" does not).
 */
export function mentionsJson(prompt: string | undefined | null): boolean {
	if (!prompt) return false;
	return JSON_TRIGGER_RE.test(prompt);
}

// ── Pure decision helper ──────────────────────────────────────────────────────

export interface ToonAdvice {
	/** Whether TOON is likely to reduce tokens for this shape. */
	useToon: boolean;
	/** Short human-readable reason. */
	reason: string;
}

/**
 * Heuristic guidance on whether a parsed JSON value is a good TOON candidate.
 *
 * This is intentionally a *recommendation* surfaced to the model / user, not an
 * enforcement. It encodes the efficiency boundary from the TOON spec:
 *   - uniform arrays of objects → strongly yes (tabular sweet spot)
 *   - flat objects / primitive arrays → yes
 *   - arrays of arrays → no (TOON's one losing case)
 *   - deeply nested / non-uniform → no (compact JSON can win)
 *
 * @param value parsed JSON (object/array/primitive)
 * @param maxDepth nesting depth at which we stop recommending TOON (default 4)
 */
export function adviseToon(value: unknown, maxDepth = 4): ToonAdvice {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return { useToon: false, reason: "empty array — nothing to compress" };
		}
		// Array of arrays: TOON's only structurally-worse case.
		if (value.every((v) => Array.isArray(v))) {
			return {
				useToon: false,
				reason: "array of arrays — JSON is more compact",
			};
		}
		// Uniform array of flat objects → tabular sweet spot.
		if (isUniformObjectArray(value)) {
			return {
				useToon: true,
				reason: `uniform array of ${value.length} objects — TOON tabular sweet spot`,
			};
		}
		// Array of primitives.
		if (value.every((v) => !isObjectLike(v))) {
			return {
				useToon: true,
				reason: "primitive array — TOON omits quotes/braces",
			};
		}
		return {
			useToon: false,
			reason: "non-uniform array — savings uncertain, keep JSON",
		};
	}

	if (isObjectLike(value)) {
		const depth = objectDepth(value);
		if (depth > maxDepth) {
			return {
				useToon: false,
				reason: `nesting depth ${depth} > ${maxDepth} — compact JSON may win`,
			};
		}
		return {
			useToon: true,
			reason: "shallow object — TOON drops quotes/braces",
		};
	}

	return { useToon: false, reason: "primitive value — nothing to compress" };
}

/** True for plain objects/arrays (things with nested structure). */
function isObjectLike(v: unknown): v is Record<string, unknown> | unknown[] {
	return typeof v === "object" && v !== null;
}

/**
 * A uniform array of objects: every element is a plain (non-array) object and
 * they all share the same set of keys, each holding a primitive value. This is
 * exactly the shape TOON encodes as a single header + bare rows.
 */
export function isUniformObjectArray(arr: unknown[]): boolean {
	if (arr.length === 0) return false;
	const first = arr[0];
	if (!isPlainObject(first)) return false;
	const keys = Object.keys(first).sort();
	if (keys.length === 0) return false;

	return arr.every((el) => {
		if (!isPlainObject(el)) return false;
		const elKeys = Object.keys(el).sort();
		if (elKeys.length !== keys.length) return false;
		for (let i = 0; i < keys.length; i++) {
			if (elKeys[i] !== keys[i]) return false;
			// values must be primitive for a clean tabular row
			if (isObjectLike((el as Record<string, unknown>)[keys[i]!])) return false;
		}
		return true;
	});
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Max nesting depth of a JSON value (primitives = 0). */
export function objectDepth(value: unknown): number {
	if (!isObjectLike(value)) return 0;
	const children = Array.isArray(value) ? value : Object.values(value);
	let max = 0;
	for (const child of children) {
		const d = objectDepth(child);
		if (d > max) max = d;
	}
	return max + 1;
}

// ── Bundled skill path ────────────────────────────────────────────────────────

// ── Pi extension ──────────────────────────────────────────────────────────────

export function json(
	pi: ExtensionAPI,
	status: OptimizerStatus,
): OptimizerHandle {
	let enabled = true;
	let jqAvailable: boolean | null = null;
	let toonAvailable: boolean | null = null;

	// Report into the shared optimizer indicator.
	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		status.set(
			"toon",
			enabled && jqAvailable !== false && toonAvailable !== false,
			ctx,
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		syncStatus(ctx);
	});

	// Inject the JSON-handling nudge into the system prompt, but ONLY when the
	// user prompt actually mentions JSON / a related token — otherwise it's dead
	// weight in every turn. Probe jq/toon lazily here (not at session_start) so
	// we don't add startup overhead for a workflow the user may never trigger.
	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return undefined;
		if (!mentionsJson(event.prompt)) return undefined;

		// Probe once on first JSON-relevant prompt.
		if (jqAvailable === null || toonAvailable === null) {
			const [jqRes, toonRes] = await Promise.all([
				pi.exec("which", ["jq"], { timeout: 1000 }).catch(() => ({ code: 1 })),
				pi
					.exec("which", ["toon"], { timeout: 1000 })
					.catch(() => ({ code: 1 })),
			]);
			jqAvailable = jqRes.code === 0;
			toonAvailable = toonRes.code === 0;
			if (!jqAvailable)
				ctx.ui.notify(
					"jq not found — JSON/TOON guidance disabled. Install: sudo apt install jq  or  brew install jq",
					"warning",
				);
			if (!toonAvailable)
				ctx.ui.notify(
					"toon not found — JSON/TOON guidance disabled. Install: bun add -g @toon-format/cli  or  npm i -g @toon-format/cli",
					"warning",
				);
			syncStatus(ctx);
		}

		if (jqAvailable === false || toonAvailable === false) return undefined;
		const existing = event.systemPrompt ?? "";
		return { systemPrompt: `${JSON_SYSTEM_PROMPT}\n\n${existing}` };
	});

	// -- Overlay value handler (called by the /optimizer overlay) --

	async function run(
		value: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		enabled = value === "on";

		syncStatus(ctx);
		ctx.ui.notify(`JSON/TOON guidance ${enabled ? "on" : "off"}.`, "info");
	}

	return {
		name: "toon",
		help: "toon — jq+TOON guidance for dense JSON",
		values: ["off", "on"],
		current: () => (enabled ? "on" : "off"),
		run,
	};
}
