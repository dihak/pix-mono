/**
 * capability-nudge.ts — orient the model to its full toolbelt
 *
 * Models drift toward improvising mid-session, forgetting they can ask the
 * user, search the web, pull library docs (context7), use LSP, or invoke an
 * Agent Skill instead of guessing. Fires on EVERY user prompt via
 * `before_agent_start`, emitted as ONE hidden message (`display: false`).
 *
 * Two modes:
 *   1. FIRST prompt of the session — an orientation block: a high-level
 *      description of WHAT is available (counts of tools / MCP tools / skills)
 *      and HOW to explore it. We deliberately do NOT dump the whole inventory
 *      every turn — the model should call skill() for skills and use /toolbox
 *      (slash command, user-facing) to discover/enable gated tools.
 *   2. EVERY subsequent prompt — the terse one-line CAPABILITY_REMINDER, a
 *      cheap (~40 tok) reinforcement that steers toward skill() and /toolbox.
 *
 * NOTE: `toolbox` is a slash command only (/toolbox) — NOT a model-callable
 * function tool. The model cannot call toolbox() in function definitions.
 * The `skill` tool IS model-callable: skill() lists/loads bundled skills.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";

type LoadedSkill = NonNullable<BuildSystemPromptOptions["skills"]>[number];

/** The standing per-turn reminder. Kept terse — it ships on every turn. */
export const CAPABILITY_REMINDER =
	"Reminder — check knowledge resources " +
	"(skills/tools/MCP/web/user) before improvising. " +
	"Matching skill? Call skill() first. " +
	"Use /toolbox to discover/enable gated tools. " +
	"All tools callable via function definitions.";

/**
 * Build the optional graphify hint line.
 * Returns a string if graphify-out/graph.json exists in cwd, else undefined.
 */
export function graphifyHint(cwd: string): string | undefined {
	if (existsSync(join(cwd, "graphify-out", "graph.json"))) {
		return (
			"graphify-out/graph.json exists — for codebase questions (how does X work, " +
			'where is Y, trace Z) run `graphify query "<question>"` before reading files.'
		);
	}
	return undefined;
}

/** Count model-invocable skills (excludes user-only /skill:name entries). */
export function countInvocableSkills(
	skills: LoadedSkill[] | undefined,
): number {
	return (skills ?? []).filter((s) => !s.disableModelInvocation).length;
}

/**
 * Split tools by source (MCP vs other) and, when an `active` set is supplied,
 * by gate status (active = schema in the prompt now; gated = registered but
 * gated out, reachable only via toolbox). Without `active`, everything counts
 * as active (gated = 0) so callers that don't track the gate are unaffected.
 */
export function partitionTools(
	tools: ToolInfo[] | undefined,
	active?: Iterable<string>,
): {
	mcp: number;
	other: number;
	active: number;
	gated: number;
} {
	const activeSet = active ? new Set(active) : undefined;
	let mcp = 0;
	let other = 0;
	let activeCount = 0;
	let gated = 0;
	for (const t of tools ?? []) {
		if (/mcp/i.test(t.sourceInfo?.source ?? "")) mcp++;
		else other++;
		// A tool is "gated" only when we have an active set and it's absent from it.
		if (activeSet && !activeSet.has(t.name)) gated++;
		else activeCount++;
	}
	return { mcp, other, active: activeCount, gated };
}

/**
 * Build the one-time orientation block shown on the FIRST prompt. Describes the
 * shape of the toolbelt (counts) and how to explore it via `toolbox`, plus the
 * sorted skill names so the model knows what exists by name without a dump of
 * descriptions (those live in the system prompt / are searchable via toolbox).
 */
export function buildOrientation(
	tools: ToolInfo[] | undefined,
	skills: LoadedSkill[] | undefined,
	/** Currently-active tool names; absent ⇒ gate not tracked (all treated active). */
	activeToolNames?: Iterable<string>,
): string {
	const { mcp, other, gated } = partitionTools(tools, activeToolNames);
	const skillNames = (skills ?? [])
		.filter((s) => !s.disableModelInvocation)
		.map((s) => s.name)
		.sort();

	const inventory: string[] = [];
	if (other) inventory.push(`${other} tool${other === 1 ? "" : "s"}`);
	if (mcp) inventory.push(`${mcp} MCP tool${mcp === 1 ? "" : "s"}`);
	if (skillNames.length)
		inventory.push(
			`${skillNames.length} skill${skillNames.length === 1 ? "" : "s"}`,
		);
	const summary = inventory.length ? inventory.join(", ") : "your toolbelt";

	// Lead with the gate — tools not described in the prompt are still callable
	// via function definitions, but the model doesn't know about them.
	const gateLine = gated
		? `${gated} ${gated === 1 ? "is" : "are"} gated (kept out of the prompt to save context) — enable via toolbox to discover. All tools are always callable via function definitions.`
		: undefined;

	const lines = [
		`Toolbelt: ${summary}, plus LSP, MCP (context7 docs), web search/fetch, and the user.`,
	];
	if (gateLine) lines.push(gateLine);
	lines.push(
		"Don't improvise what a capability covers — ask the user, search the web, or pull docs first.",
		"`skill()` lists/loads bundled skills — call it when a skill matches your task. " +
			"/toolbox (slash command) discovers and enables gated tools.",
	);
	if (skillNames.length) {
		lines.push(`Skills: ${skillNames.join(", ")}.`);
	}
	// Graphify hint — only when a graph is already built for this project
	const gHint = graphifyHint(process.cwd());
	if (gHint) lines.push(gHint);
	// Framing — this block is orientation context, not a task. Without it the
	// model can mistake the first-turn orientation for the prompt and reply
	// "Ready, waiting for task" instead of acting on the user's request.
	lines.push(
		"(Orientation only — not a task. Act on the user's request now; do not reply to this notice.)",
	);
	return lines.join("\n");
}

export default function registerCapabilityNudge(pi: ExtensionAPI): void {
	let orientationSent = false;

	pi.on("before_agent_start", async (event) => {
		const skills = event.systemPromptOptions?.skills;

		let content: string;
		if (!orientationSent) {
			orientationSent = true;
			let tools: ToolInfo[] | undefined;
			try {
				tools = pi.getAllTools();
			} catch {
				tools = undefined;
			}
			// Active set lets the orientation distinguish callable-now from gated.
			// getActiveTools() returns string[] (tool NAMES) — not ToolInfo[]. Use as-is.
			let activeToolNames: string[] | undefined;
			try {
				activeToolNames = pi.getActiveTools();
			} catch {
				activeToolNames = undefined;
			}
			content = buildOrientation(tools, skills, activeToolNames);
		} else {
			// Per-turn reminder — append graphify hint when graph exists
			const cwd = process.cwd();
			const gHint = graphifyHint(cwd);
			content = gHint
				? `${CAPABILITY_REMINDER}\n${gHint}`
				: CAPABILITY_REMINDER;
		}

		return {
			message: {
				customType: "pix-capability-nudge",
				content,
				display: false,
			},
		};
	});
}
