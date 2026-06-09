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
 *      and HOW to explore it on demand via the `toolbox` tool. We deliberately
 *      do NOT dump the whole inventory every turn — that is what `toolbox`
 *      (fuzzy search over names + descriptions) is for.
 *   2. EVERY subsequent prompt — the terse one-line CAPABILITY_REMINDER, a
 *      cheap (~40 tok) reinforcement that points back at toolbox.
 */

import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";

type LoadedSkill = NonNullable<BuildSystemPromptOptions["skills"]>[number];

/** The standing per-turn reminder. Kept terse — it ships on every turn. */
export const CAPABILITY_REMINDER =
	"Reminder — always check your knowledge resources " +
	"(skills/tools/MCP/web/user) before improvising. " +
	"`toolbox(query)` finds the right one; enable gated tools via toolbox. " +
	"All tools are always callable via function definitions.";

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
		"toolbox is the gateway: `toolbox(query)` searches tools/MCP/skills/commands; `toolbox(action:'enable'|'disable', name)` toggles a gated tool prompt-visible or gated. Empty query lists all.",
	);
	if (skillNames.length) {
		lines.push(`Skills: ${skillNames.join(", ")}.`);
	}
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
			content = CAPABILITY_REMINDER;
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
