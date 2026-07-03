/**
 * tools.ts — The 3 LLM-callable tool definitions:
 *   agent          — spawn a sub-agent (fg or bg)
 *   agent_result   — fetch latest output / full result by id
 *   agent_steer    — inject a message into a running bg agent
 *
 * Design notes:
 * - agent description is built dynamically at registration (live model + type list).
 * - allowed_tools[] intersects the resolved tool set (never widens).
 * - modelName is ALWAYS populated (the pix twist — shown even when same as parent).
 * - renderCall/renderResult ported from tintinweb/pi-subagents (MIT).
 *
 * Token-cost note: the `agent` tool is the most expensive call the LLM makes
 * (a detailed `prompt` field alone is 50-200 output tokens). Parameter keys are
 * kept short (`type`, `turns`, `background`) and rare options (`isolated`,
 * `inherit_context`) are intentionally absent from the schema — they bloat
 * every call with `false` fillers yet are almost never used. They remain
 * configurable via custom agent .md frontmatter (../custom-agents.ts) for the
 * rare case that needs them.
 */

import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentManager } from "./agent-manager.ts";
import {
	getAgentConversation,
	normalizeMaxTurns,
	SUBAGENT_TOOL_NAMES,
} from "./agent-runner.ts";
import {
	BUILTIN_TOOL_NAMES,
	getAgentConfig,
	getAvailableTypes,
	getConfig,
} from "./agent-types.ts";
import { resolveAgentInvocationConfig } from "./invocation-config.ts";
import { resolveModel } from "./model-resolver.ts";
import { lookupBenchmark } from "@xynogen/pix-data";
import type { AgentInvocation, LifetimeUsage } from "./types.ts";
import {
	getLifetimeTotal,
	getSessionContextPercent,
	type SessionLike,
} from "./usage.ts";

// ── Types shared with ui/widget.ts (widget imports from here to avoid circular) ─

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

export interface AgentActivity {
	activeTools: Map<string, string>;
	toolUses: number;
	responseText: string;
	session?: unknown;
	turnCount: number;
	maxTurns?: number;
	lifetimeUsage: LifetimeUsage;
	/** Cumulative milliseconds spent streaming output (not idle/tool time). */
	streamingMs: number;
}

export interface AgentDetails {
	displayName: string;
	description: string;
	subagentType: string;
	toolUses: number;
	tokens: string;
	/** Context-window utilization 0–100, or null/undefined when unavailable. */
	contextPercent?: number | null;
	/** Raw output tokens — for t/s = outputTokens / streamingMs. */
	outputTokens?: number;
	durationMs: number;
	/** Cumulative streaming-only milliseconds (for accurate t/s). */
	streamingMs?: number;
	status:
		| "queued"
		| "running"
		| "completed"
		| "steered"
		| "aborted"
		| "stopped"
		| "error"
		| "background";
	activity?: string;
	spinnerFrame?: number;
	modelName?: string;
	tags?: string[];
	turnCount?: number;
	maxTurns?: number;
	agentId?: string;
	error?: string;
}

// ── Formatting helpers (also exported for ui/widget.ts) ──────────────────────

export const SPINNER = [
	"\u280b",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283c",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280f",
];

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

export function formatTurns(
	turnCount: number,
	maxTurns?: number | null,
): string {
	return maxTurns != null ? `🗘${turnCount}≤${maxTurns}` : `🗘${turnCount}`;
}

export function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Output tokens per second over a duration. "" when either input is
 * non-positive (no work / zero elapsed) so callers can skip the segment.
 */
export function formatSpeed(outputTokens: number, durationMs: number): string {
	if (outputTokens <= 0 || durationMs <= 0) return "";
	return `${Math.round(outputTokens / (durationMs / 1000))} t/s`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function textResult(msg: string, details?: AgentDetails) {
	return {
		content: [{ type: "text" as const, text: msg }],
		details: details as unknown,
	};
}

/** Strip provider prefix + date suffix for a compact model label. e.g. "anthropic/claude-haiku-4-5-20251001" → "haiku-4-5" */
function shortModelLabel(model: {
	provider: string;
	id: string;
	name?: string;
}): string {
	// prefer name, strip "Claude " prefix
	if (model.name) return model.name.replace(/^Claude\s+/i, "").toLowerCase();
	const id = model.id.replace(/-\d{8}$/, ""); // strip date suffix
	return id;
}

function buildStats(d: AgentDetails, theme: Theme): string {
	const parts: string[] = [];
	if (d.modelName) parts.push(theme.fg("muted", `[${d.modelName}]`));
	if (d.tags) parts.push(...d.tags.map((t) => theme.fg("dim", t)));
	if (d.turnCount != null && d.turnCount > 0)
		parts.push(theme.fg("dim", formatTurns(d.turnCount, d.maxTurns)));
	if (d.toolUses > 0)
		parts.push(
			theme.fg("dim", `${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`),
		);
	if (d.tokens) {
		const pct =
			d.contextPercent != null
				? ` ${theme.fg("dim", `(${Math.round(d.contextPercent)}%)`)}`
				: "";
		parts.push(theme.fg("dim", d.tokens) + pct);
	}
	return parts.join(` ${theme.fg("dim", "·")} `);
}

// ── tool description builder ─────────────────────────────────────────────────

export function buildAgentToolDescription(modelList: string[]): string {
	const available = getAvailableTypes();

	const typeList = available
		.map((name) => {
			const cfg = getAgentConfig(name);
			const tools = cfg?.builtinToolNames;
			const toolsSuffix =
				!tools || tools.length === BUILTIN_TOOL_NAMES.length
					? " (Tools: *)"
					: ` (Tools: ${tools.join(", ")})`;
			return `- ${name}: ${cfg?.description ?? name}${toolsSuffix}`;
		})
		.join("\n");

	const modelsText =
		modelList.length > 0
			? `\nAvailable models:\n${modelList.map((m) => `  ${m}`).join("\n")}`
			: "";

	const toolsText = `\nAvailable tools (for allowed_tools[]): ${BUILTIN_TOOL_NAMES.join(", ")}`;

	return `Launch a new agent to handle complex, multi-step tasks autonomously.

Available agent types and their tools:
${typeList}

Custom agents can be defined in .pi/agents/<name>.md (project) or ${getAgentDir()}/agents/<name>.md (global) — picked up automatically. Project-level overrides global.
${modelsText}
${toolsText}

## When not to use
If the target is already known, use a direct tool — \`read\` for a known path, \`grep\`/\`find\` for a specific symbol. Reserve this tool for open-ended questions or tasks that span the codebase.

## Usage notes
- Always include a short (3-5 word) \`description\` (shown in UI).
- Launch independent agents concurrently: send multiple \`agent\` tool calls in one message.
- The agent's result is not visible to the user — summarize it in a text message. Trust but verify: check the actual changes before reporting done.
- Agents always run in background — the parent is free to continue working while the agent executes.
- \`resume\` with an agent ID to continue a prior agent's work; \`agent_steer\` to redirect a running background agent.
- Pick the model yourself via \`model:\` (provider/id or fuzzy e.g. "haiku"). For mechanical/read-only work prefer a cheap tier; for hard reasoning match or exceed the parent. Type sets the tool belt + persona only — never the model.
- \`thinking\`: off|minimal|low|medium|high|xhigh.
- Only \`general-purpose\` has an open tool belt — use \`allowed_tools\` to narrow it. Explore/Plan and custom agents already have a fixed belt; omit \`allowed_tools\` for those.

## Writing the prompt
Brief it like a smart colleague who just walked into the room — it hasn't seen this conversation. Include what to accomplish, why, file paths, line numbers, what specifically to change, and whether a short response is fine. **Never delegate understanding.**`;
}

// ── the 3 tools ──────────────────────────────────────────────────────────────

export function createAgentTool(
	pi: Parameters<typeof manager.spawn>[0],
	manager: AgentManager,
	agentActivity: Map<string, AgentActivity>,
	reloadCustomAgents: () => void,
	modelList: string[],
) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.AGENT,
		label: "Agent",
		description: buildAgentToolDescription(modelList),
		promptSnippet: "Launch autonomous sub-agents for complex multi-step tasks",

		parameters: Type.Object({
			prompt: Type.String({
				description: "The task for the agent to perform.",
			}),
			description: Type.String({
				description:
					"A short (3-5 word) description of the task (shown in UI).",
			}),
			type: Type.String({
				description: `The type of specialized agent to use. Available: ${getAvailableTypes().join(", ")}. Custom agents from .pi/agents/*.md are also available.`,
			}),
			model: Type.Optional(
				Type.String({
					description:
						'Optional model override. Accepts "provider/id" or fuzzy name (e.g. "haiku", "sonnet"). Must be in the available models list.',
				}),
			),
			allowed_tools: Type.Optional(
				Type.Array(Type.String(), {
					description: `Restrict the sub-agent to a subset of tools. General-purpose only — other types already have a fixed belt. Intersected with the type's default set (never widens). Available: ${BUILTIN_TOOL_NAMES.join(", ")}. Omit for the type's default set.`,
				}),
			),
			thinking: Type.Optional(
				Type.String({
					description: "Thinking level: off|minimal|low|medium|high|xhigh.",
				}),
			),
			turns: Type.Optional(
				Type.Number({
					description:
						"Maximum agentic turns before stopping. Omit for unlimited.",
					minimum: 1,
				}),
			),
			resume: Type.Optional(
				Type.String({
					description: "Agent ID to resume from. Continues previous context.",
				}),
			),
		}),

		renderCall(args, theme) {
			const typeName = resolveTypeName(args);
			const displayName = typeName ? getConfig(typeName).displayName : "Agent";
			const desc = args.description ?? "";
			return new Text(
				"▸ " +
					theme.fg("toolTitle", theme.bold(displayName)) +
					(desc ? `  ${theme.fg("muted", desc as string)}` : ""),
				0,
				0,
			);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as AgentDetails | undefined;
			if (!details) {
				const text =
					result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(text, 0, 0);
			}

			const stats = buildStats(details, theme);

			// Streaming / running — live state shown by the ● Agents widget, so the
			// inline transcript stays empty to avoid stacking one card per agent.
			if (isPartial || details.status === "running") {
				return new Text("", 0, 0);
			}

			// Background launched
			if (details.status === "background") {
				return new Text(
					theme.fg(
						"dim",
						`  ⎿  Running in background (ID: ${details.agentId})`,
					),
					0,
					0,
				);
			}

			// Completed / steered. Collapsed view stays empty — the ● Agents widget
			// carries the full finished line, so the inline transcript doesn't echo
			// it (caller shouldn't output the result). Expanded view still shows the
			// summary + full output on demand.
			if (details.status === "completed" || details.status === "steered") {
				if (!expanded) return new Text("", 0, 0);
				const duration = formatMs(details.durationMs);
				const isSteered = details.status === "steered";
				const icon = theme.fg("success", "✓");
				const speed = formatSpeed(
					details.outputTokens ?? 0,
					details.streamingMs ?? details.durationMs,
				);
				let line =
					icon +
					(stats ? ` ${stats}` : "") +
					" " +
					theme.fg("dim", "·") +
					" " +
					theme.fg("dim", duration) +
					(speed ? ` ${theme.fg("dim", "·")} ${theme.fg("dim", speed)}` : "") +
					// Steered = stopped at turn limit; keep that note inline since the
					// stats alone don't say why it ended.
					(isSteered ? ` ${theme.fg("dim", "(turn limit)")}` : "");

				// Expanded view appends the full result below the one-line summary.
				if (expanded) {
					const resultText =
						result.content[0]?.type === "text" ? result.content[0].text : "";
					if (resultText) {
						const lines = resultText.split("\n").slice(0, 50);
						for (const l of lines) line += `\n${theme.fg("dim", `  ${l}`)}`;
						if (resultText.split("\n").length > 50)
							line +=
								"\n" +
								theme.fg(
									"muted",
									"  … (use agent_result with verbose for full output)",
								);
					}
				}
				return new Text(line, 0, 0);
			}

			// Stopped
			if (details.status === "stopped") {
				let line = theme.fg("dim", "■") + (stats ? ` ${stats}` : "");
				line += `\n${theme.fg("dim", "  ⎿  Stopped")}`;
				return new Text(line, 0, 0);
			}

			// Error / aborted
			let line = theme.fg("error", "✗") + (stats ? ` ${stats}` : "");
			if (details.status === "error")
				line += `\n${theme.fg("error", `  ⎿  Error: ${details.error ?? "unknown"}`)}`;
			else
				line += `\n${theme.fg("warning", "  ⎿  Aborted (max turns exceeded)")}`;
			return new Text(line, 0, 0);
		},

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			reloadCustomAgents();

			// Resolve agent type — accept the new `type` key, with the legacy
			// `subagent_type` spelling kept as a fallback so RPC/older callers
			// and persisted invocations don't break. The typed schema no longer
			// declares the legacy key, so read it via a loose record view.
			const looseParams = params as Record<string, unknown>;
			const rawType =
				(params.type as string | undefined) ??
				(looseParams.subagent_type as string | undefined) ??
				"general-purpose";
			const resolvedKey =
				getAvailableTypes().find(
					(t) => t.toLowerCase() === rawType.toLowerCase(),
				) ?? rawType;
			const subagentType = getAvailableTypes().includes(resolvedKey)
				? resolvedKey
				: "general-purpose";
			const fellBack =
				subagentType === "general-purpose" && resolvedKey !== "general-purpose";

			const displayName = getConfig(subagentType).displayName;
			const customConfig = getAgentConfig(subagentType);

			// Accept new short keys plus the legacy long spellings (backward compat).
			const resolvedConfig = resolveAgentInvocationConfig(customConfig, {
				model: params.model as string | undefined,
				thinking: params.thinking as string | undefined,
				turns: params.turns as number | undefined,
				// Legacy spelling — read via the loose view since the schema dropped it.
				max_turns: looseParams.max_turns as number | undefined,
			});

			// Resolve model — ALWAYS compute modelName (the pix twist)
			let model = ctx.model;
			let modelName: string | undefined;
			if (resolvedConfig.modelInput) {
				const resolved = resolveModel(
					resolvedConfig.modelInput,
					ctx.modelRegistry,
				);
				if (typeof resolved === "string") {
					// Model not found — return error to planner so it can re-pick
					if (resolvedConfig.modelFromParams) return textResult(resolved);
					// Config-specified but unavailable: silent fallback to parent
				} else {
					model = resolved;
				}
			}
			// Always set modelName (the twist: visible even when same as parent)
			if (model) modelName = shortModelLabel(model);

			// Mentor guard: reject when the chosen model is weaker than the parent
			// OR when benchmark data is missing (can't verify it meets the floor).
			// Equal or higher scores are allowed — same-tier calls (e.g. Opus → Opus)
			// are useful for a second perspective on critical decisions.
			if (subagentType === "Mentor" && model && ctx.model) {
				const childBench = lookupBenchmark(model.id);
				const parentBench = lookupBenchmark(ctx.model.id);
				const childScore = childBench?.overallScore ?? null;
				const parentScore = parentBench?.overallScore ?? null;
				if (childScore == null || parentScore == null) {
					const missing = [
						childScore == null ? `"${modelName}"` : "",
						parentScore == null ? "current model" : "",
					]
						.filter(Boolean)
						.join(" and ");
					return textResult(
						`Cannot verify Mentor model is at least as capable as the parent — no benchmark score for ${missing}. ` +
							`Pick a model with a known ⚡ score from the available models list so the guard can verify it.`,
					);
				}
				if (childScore < parentScore) {
					return textResult(
						`Mentor model "${modelName}" (⚡${childScore}) is weaker than the current model (⚡${parentScore}). ` +
							`Mentor requires a model at least as capable as the parent (⚡${parentScore}+) — pick one from the available models list.`,
					);
				}
			}

			const thinking = resolvedConfig.thinking;
			const inheritContext = resolvedConfig.inheritContext;
			const isolated = resolvedConfig.isolated;
			const effectiveMaxTurns = normalizeMaxTurns(resolvedConfig.maxTurns);

			// Build invocation snapshot (for widget + notification)
			const agentInvocation: AgentInvocation = {
				modelName, // always set
				thinking,
				maxTurns: effectiveMaxTurns,
				isolated,
				inheritContext,
			};

			const detailBase = {
				displayName,
				description: params.description as string,
				subagentType,
				modelName, // pix twist: always pass through
				tags: [] as string[],
			};

			// Surface any config-load warnings (e.g. invalid thinking level)
			if (customConfig?.warnings?.length) {
				for (const w of customConfig.warnings) detailBase.tags.push(w);
			}

			if (fellBack) detailBase.tags.push("(unknown type → general-purpose)");
			if (thinking) detailBase.tags.push(`thinking: ${thinking}`);
			if (isolated) detailBase.tags.push("isolated");

			// Resume existing agent
			if (params.resume) {
				const existing = manager.getRecord(params.resume as string);
				if (!existing)
					return textResult(
						`Agent not found: "${params.resume}". It may have been cleaned up.`,
					);
				if (!existing.session)
					return textResult(
						`Agent "${params.resume}" has no active session to resume.`,
					);
				const record = await manager.resume(
					params.resume as string,
					params.prompt as string,
					signal,
				);
				if (!record)
					return textResult(`Failed to resume agent "${params.resume}".`);
				return textResult(
					record.result?.trim() || record.error?.trim() || "No output.",
					buildDetails(detailBase, record),
				);
			}

			// Validate + build allowed_tools list
			const rawAllowed = params.allowed_tools as string[] | undefined;
			let allowedToolNames: string[] | undefined;
			if (rawAllowed) {
				const knownSet = new Set([...BUILTIN_TOOL_NAMES]);
				const unknown = rawAllowed.filter((t) => !knownSet.has(t));
				// Warn about unknown names but proceed with the valid subset
				const valid = rawAllowed.filter((t) => knownSet.has(t));
				if (unknown.length > 0) {
					const note = `(unknown tool names ignored: ${unknown.join(", ")})`;
					detailBase.tags.push(note);
				}
				allowedToolNames = valid.length > 0 ? valid : undefined;
			}

			// Always background — spawn and return immediately
			const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(
				effectiveMaxTurns,
				() => {
					agentActivity.set(id, bgState);
				},
			);

			let id: string;
			try {
				id = manager.spawn(pi, ctx, subagentType, params.prompt as string, {
					description: params.description as string,
					model,
					maxTurns: effectiveMaxTurns,
					isolated,
					inheritContext,
					thinkingLevel: thinking,
					isBackground: true,
					invocation: agentInvocation,
					// Intentionally no `signal` here: the tool-call signal is aborted
					// when the parent turn ends, which would kill the background agent
					// prematurely — bg agents are meant to outlive the spawning turn.
					allowedToolNames,
					...bgCallbacks,
				});
			} catch (err) {
				return textResult(err instanceof Error ? err.message : String(err));
			}

			agentActivity.set(id, bgState);

			return textResult(
				`Running in background (ID: ${id}). Use agent_result to check progress or agent_steer to redirect.`,
				{
					...detailBase,
					toolUses: 0,
					tokens: "",
					durationMs: 0,
					status: "background",
					agentId: id,
				},
			);
		},
	});
}

/**
 * Read the agent-type name from renderCall args, accepting the new `type` key
 * and the legacy `subagent_type` spelling. Returns undefined if neither is set.
 */
function resolveTypeName(args: Record<string, unknown>): string | undefined {
	const t = args.type;
	if (typeof t === "string" && t) return t;
	const legacy = args.subagent_type;
	if (typeof legacy === "string" && legacy) return legacy;
	return undefined;
}

// ── agent_result tool ────────────────────────────────────────────────────────

export function createAgentResultTool(
	manager: AgentManager,
	agentActivity: Map<string, AgentActivity>,
) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.GET_RESULT,
		label: "Agent Result",
		description:
			"Fetch the latest output or full result of a background agent by ID. Call this to retrieve what a background agent produced. Sets resultConsumed so the completion notification is suppressed.",
		parameters: Type.Object({
			agent_id: Type.String({
				description: "The agent ID returned by the agent tool.",
			}),
			verbose: Type.Optional(
				Type.Boolean({
					description:
						"true = full conversation history; false (default) = latest assistant text only.",
				}),
			),
		}),

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent_result ")) +
					theme.fg("accent", args.agent_id as string),
				0,
				0,
			);
		},

		async execute(_toolCallId, params) {
			const id = params.agent_id as string;
			const record = manager.getRecord(id);
			if (!record) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Agent not found: "${id}". It may have been cleaned up or the ID is wrong.`,
						},
					],
					details: undefined as unknown,
				};
			}

			// Suppress the pending completion nudge (agent_result consumed it)
			record.resultConsumed = true;

			if (params.verbose && record.session) {
				const convo = getAgentConversation(record.session);
				return {
					content: [
						{
							type: "text" as const,
							text: convo || "No conversation history yet.",
						},
					],
					details: undefined as unknown,
				};
			}

			const activity = agentActivity.get(id);
			const text =
				record.status === "running"
					? activity?.responseText?.trim() ||
						"Agent is still running. No output yet."
					: record.result?.trim() || record.error?.trim() || "No output.";
			return {
				content: [{ type: "text" as const, text }],
				details: undefined as unknown,
			};
		},
	});
}

// ── agent_steer tool ─────────────────────────────────────────────────────────

export function createAgentSteerTool(manager: AgentManager) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.STEER,
		label: "Steer Agent",
		description:
			"Inject a steering message into a running background agent to redirect its work without restarting. The message is delivered after the agent's current tool execution completes.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to steer." }),
			message: Type.String({ description: "The steering message to inject." }),
		}),

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent_steer ")) +
					theme.fg("accent", args.agent_id as string),
				0,
				0,
			);
		},

		async execute(_toolCallId, params) {
			const id = params.agent_id as string;
			const record = manager.getRecord(id);
			if (!record) {
				return {
					content: [
						{ type: "text" as const, text: `Agent not found: "${id}".` },
					],
					details: undefined as unknown,
				};
			}

			const message = params.message as string;

			if (record.session) {
				try {
					await record.session.steer(message);
					return {
						content: [
							{
								type: "text" as const,
								text: `Steering message delivered to agent "${id}".`,
							},
						],
						details: undefined as unknown,
					};
				} catch (err) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to steer agent: ${err instanceof Error ? err.message : String(err)}`,
							},
						],
						details: undefined as unknown,
					};
				}
			}

			// Session not ready yet — queue the steer
			if (!record.pendingSteers) record.pendingSteers = [];
			record.pendingSteers.push(message);
			return {
				content: [
					{
						type: "text" as const,
						text: `Agent "${id}" session not yet ready. Steer queued and will be delivered on session start.`,
					},
				],
				details: undefined as unknown,
			};
		},
	});
}

// ── shared helpers ───────────────────────────────────────────────────────────

/**
 * Create an AgentActivity state and spawn callbacks for tracking tool usage.
 *
 * `onWarning` pushes messages into `state.warnings` and triggers a stream update.
 * The fg path surfaces warnings via `detailBase.tags` when building final details;
 * bg agents store warnings on the state but don't surface them via notifications —
 * the notification path doesn't carry tags, and retrofitting it is non-trivial.
 * Fg-only surfacing is acceptable: bg warnings are rare config errors that also
 * appear in the parent's agent config diagnostics.
 */
function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
	const state: AgentActivity & { durationMs: number; warnings: string[] } = {
		activeTools: new Map(),
		toolUses: 0,
		turnCount: 0,
		maxTurns,
		responseText: "",
		session: undefined,
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		streamingMs: 0,
		durationMs: 0,
		warnings: [],
	};
	const startedAt = Date.now();
	let streamStart: number | null = null;

	const callbacks = {
		onWarning: (message: string) => {
			state.warnings.push(message);
			onStreamUpdate?.();
		},
		onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
			if (activity.type === "start") {
				state.activeTools.set(
					`${activity.toolName}_${Date.now()}`,
					activity.toolName,
				);
			} else {
				for (const [key, name] of state.activeTools) {
					if (name === activity.toolName) {
						state.activeTools.delete(key);
						break;
					}
				}
				state.toolUses++;
			}
			onStreamUpdate?.();
		},
		onTextDelta: (_delta: string, fullText: string) => {
			if (streamStart === null) streamStart = Date.now();
			state.responseText = fullText;
			state.durationMs = Date.now() - startedAt;
			onStreamUpdate?.();
		},
		onTurnEnd: (turnCount: number) => {
			state.turnCount = turnCount;
			onStreamUpdate?.();
		},
		onSessionCreated: (session: unknown) => {
			state.session = session as AgentActivity["session"];
		},
		onAssistantUsage: (usage: {
			input: number;
			output: number;
			cacheWrite: number;
		}) => {
			// Finalize the streaming window for this turn.
			if (streamStart !== null) {
				state.streamingMs += Date.now() - streamStart;
				streamStart = null;
			}
			state.lifetimeUsage.input += usage.input;
			state.lifetimeUsage.output += usage.output;
			state.lifetimeUsage.cacheWrite += usage.cacheWrite;
			onStreamUpdate?.();
		},
	};

	return { state, callbacks, getWarnings: () => state.warnings };
}

function buildDetails(
	base: Pick<
		AgentDetails,
		"displayName" | "description" | "subagentType" | "modelName" | "tags"
	>,
	record: {
		toolUses: number;
		startedAt: number;
		completedAt?: number;
		status: string;
		error?: string;
		id?: string;
		lifetimeUsage: { input: number; output: number; cacheWrite: number };
	},
	activity?: AgentActivity & { durationMs?: number },
): AgentDetails {
	const totalTokens = getLifetimeTotal(record.lifetimeUsage);
	const contextPercent = activity?.session
		? getSessionContextPercent(activity.session as SessionLike)
		: null;
	return {
		...base,
		toolUses: record.toolUses,
		tokens: totalTokens > 0 ? formatTokens(totalTokens) : "",
		contextPercent,
		outputTokens: record.lifetimeUsage.output,
		streamingMs: activity?.streamingMs,
		turnCount: activity?.turnCount,
		maxTurns: activity?.maxTurns,
		durationMs:
			activity?.durationMs ??
			(record.completedAt ?? Date.now()) - record.startedAt,
		status: record.status as AgentDetails["status"],
		agentId: record.id,
		error: record.error,
	};
}
