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
 */


import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	BUILTIN_TOOL_NAMES,
	getAgentConfig,
	getAvailableTypes,
	getConfig,
} from "./agent-types.ts";
import { getAgentConversation, normalizeMaxTurns, SUBAGENT_TOOL_NAMES } from "./agent-runner.ts";
import type { AgentManager } from "./agent-manager.ts";
import { resolveModel } from "./model-resolver.ts";
import { resolveAgentInvocationConfig } from "./invocation-config.ts";
import { getLifetimeTotal } from "./usage.ts";
import type { AgentInvocation, LifetimeUsage } from "./types.ts";

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
}

export interface AgentDetails {
	displayName: string;
	description: string;
	subagentType: string;
	toolUses: number;
	tokens: string;
	durationMs: number;
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error" | "background";
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

export const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

export function formatTurns(turnCount: number, maxTurns?: number | null): string {
	return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`;
}

export function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function textResult(msg: string, details?: AgentDetails) {
	return { content: [{ type: "text" as const, text: msg }], details: details as unknown };
}

/** Strip provider prefix + date suffix for a compact model label. e.g. "anthropic/claude-haiku-4-5-20251001" → "haiku-4-5" */
function shortModelLabel(model: { provider: string; id: string; name?: string }): string {
	// prefer name, strip "Claude " prefix
	if (model.name) return model.name.replace(/^Claude\s+/i, "").toLowerCase();
	const id = model.id.replace(/-\d{8}$/, ""); // strip date suffix
	return id;
}

function buildStats(d: AgentDetails, theme: Theme): string {
	const parts: string[] = [];
	if (d.modelName) parts.push(theme.fg("muted", `[${d.modelName}]`));
	if (d.tags) parts.push(...d.tags.map((t) => theme.fg("dim", t)));
	if (d.turnCount != null && d.turnCount > 0) parts.push(theme.fg("dim", formatTurns(d.turnCount, d.maxTurns)));
	if (d.toolUses > 0) parts.push(theme.fg("dim", `${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`));
	if (d.tokens) parts.push(theme.fg("dim", d.tokens));
	return parts.join(" " + theme.fg("dim", "·") + " ");
}

// ── tool description builder ─────────────────────────────────────────────────

export function buildAgentToolDescription(modelList: string[]): string {
	const available = getAvailableTypes();

	const typeList = available
		.map((name) => {
			const cfg = getAgentConfig(name);
			const modelSuffix = cfg?.model ? ` (${cfg.model})` : "";
			const tools = cfg?.builtinToolNames;
			const toolsSuffix =
				!tools || tools.length === BUILTIN_TOOL_NAMES.length
					? " (Tools: *)"
					: ` (Tools: ${tools.join(", ")})`;
			return `- ${name}: ${cfg?.description ?? name}${modelSuffix}${toolsSuffix}`;
		})
		.join("\n");

	const modelsText =
		modelList.length > 0
			? `\nAvailable models:\n${modelList.map((m) => `  ${m}`).join("\n")}`
			: "";

	const toolsText = `\nAvailable tools (for allowed_tools[]): ${BUILTIN_TOOL_NAMES.join(", ")}`;

	return `Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools.

Available agent types and their tools:
${typeList}

Custom agents can be defined in .pi/agents/<name>.md (project) or ${getAgentDir()}/agents/<name>.md (global) — picked up automatically. Project-level overrides global.
${modelsText}
${toolsText}

## When not to use
If the target is already known, use a direct tool — \`read\` for a known path, \`grep\`/\`find\` for a specific symbol. Reserve this tool for open-ended questions or tasks that span the codebase.

## Usage notes
- Always include a short (3-5 word) description summarizing what the agent will do (shown in UI).
- When you launch multiple agents for independent work, send them in a single message with multiple tool uses, with run_in_background: true on each, so they run concurrently.
- When the agent is done, it returns a single message. The result is not visible to the user — to show the user, send a text message with a concise summary.
- Trust but verify: an agent's summary describes what it intended to do, not what it did. When an agent writes or edits code, check the actual changes before reporting work as done.
- Use run_in_background for work you don't need immediately. You will be notified when it completes — do NOT poll or sleep waiting for it.
- Use resume with an agent ID to continue a previous agent's work.
- Use agent_steer to send mid-run messages to a running background agent.
- Use model to specify a model from the available models list above (provider/id or fuzzy e.g. "haiku").
- Use allowed_tools[] to restrict which tools the sub-agent can use (useful for scoping work). Omit for the agent type's default tool set.
- Use thinking to control extended thinking level: off|minimal|low|medium|high|xhigh.
- Use inherit_context if the agent needs the parent conversation history.

## Writing the prompt
Provide clear, detailed prompts so the agent can work autonomously. Brief it like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried.
- Explain what you're trying to accomplish and why.
- Include file paths, line numbers, what specifically to change.
- If you need a short response, say so.

**Never delegate understanding.** Write prompts that prove you understood: include file paths, line numbers, what specifically to change.`;
}

// ── the 3 tools ──────────────────────────────────────────────────────────────

export function createAgentTool(
	pi: Parameters<typeof manager.spawnAndWait>[0],
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
			prompt: Type.String({ description: "The task for the agent to perform." }),
			description: Type.String({ description: "A short (3-5 word) description of the task (shown in UI)." }),
			subagent_type: Type.String({
				description: `The type of specialized agent to use. Available: ${getAvailableTypes().join(", ")}. Custom agents from .pi/agents/*.md are also available.`,
			}),
			model: Type.Optional(
				Type.String({
					description: 'Optional model override. Accepts "provider/id" or fuzzy name (e.g. "haiku", "sonnet"). Must be in the available models list.',
				}),
			),
			allowed_tools: Type.Optional(
				Type.Array(Type.String(), {
					description: `Restrict the sub-agent to a subset of tools. Intersected with the agent type's default set (never widens). Available: ${BUILTIN_TOOL_NAMES.join(", ")}. Omit for the type's full default set.`,
				}),
			),
			thinking: Type.Optional(
				Type.String({ description: "Thinking level: off|minimal|low|medium|high|xhigh." }),
			),
			max_turns: Type.Optional(
				Type.Number({ description: "Maximum agentic turns before stopping. Omit for unlimited.", minimum: 1 }),
			),
			run_in_background: Type.Optional(
				Type.Boolean({ description: "true = background (returns ID immediately, notifies on completion). false (default) = foreground (streams inline)." }),
			),
			resume: Type.Optional(
				Type.String({ description: "Agent ID to resume from. Continues previous context." }),
			),
			isolated: Type.Optional(
				Type.Boolean({ description: "true = no extension/MCP tools, builtins only." }),
			),
			inherit_context: Type.Optional(
				Type.Boolean({ description: "true = fork parent conversation into the sub-agent." }),
			),
		}),

		renderCall(args, theme) {
			const displayName = args.subagent_type
				? (getConfig(args.subagent_type as string).displayName)
				: "Agent";
			const desc = args.description ?? "";
			return new Text(
				"▸ " + theme.fg("toolTitle", theme.bold(displayName)) + (desc ? "  " + theme.fg("muted", desc as string) : ""),
				0,
				0,
			);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as AgentDetails | undefined;
			if (!details) {
				const text = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(text, 0, 0);
			}

			const stats = buildStats(details, theme);

			// Streaming / running
			if (isPartial || details.status === "running") {
				const frame = SPINNER[details.spinnerFrame ?? 0];
				let line = theme.fg("accent", frame) + (stats ? " " + stats : "");
				line += "\n" + theme.fg("dim", `  ⎿  ${details.activity ?? "thinking…"}`);
				return new Text(line, 0, 0);
			}

			// Background launched
			if (details.status === "background") {
				return new Text(
					theme.fg("dim", `  ⎿  Running in background (ID: ${details.agentId})`),
					0,
					0,
				);
			}

			// Completed / steered
			if (details.status === "completed" || details.status === "steered") {
				const duration = formatMs(details.durationMs);
				const isSteered = details.status === "steered";
				const icon = isSteered ? theme.fg("warning", "✓") : theme.fg("success", "✓");
				let line = icon + (stats ? " " + stats : "") + " " + theme.fg("dim", "·") + " " + theme.fg("dim", duration);

				if (expanded) {
					const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
					if (resultText) {
						const lines = resultText.split("\n").slice(0, 50);
						for (const l of lines) line += "\n" + theme.fg("dim", `  ${l}`);
						if (resultText.split("\n").length > 50)
							line += "\n" + theme.fg("muted", "  … (use agent_result with verbose for full output)");
					}
				} else {
					line += "\n" + theme.fg("dim", `  ⎿  ${isSteered ? "Wrapped up (turn limit)" : "Done"}`);
				}
				return new Text(line, 0, 0);
			}

			// Stopped
			if (details.status === "stopped") {
				let line = theme.fg("dim", "■") + (stats ? " " + stats : "");
				line += "\n" + theme.fg("dim", "  ⎿  Stopped");
				return new Text(line, 0, 0);
			}

			// Error / aborted
			let line = theme.fg("error", "✗") + (stats ? " " + stats : "");
			if (details.status === "error")
				line += "\n" + theme.fg("error", `  ⎿  Error: ${details.error ?? "unknown"}`);
			else
				line += "\n" + theme.fg("warning", "  ⎿  Aborted (max turns exceeded)");
			return new Text(line, 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			reloadCustomAgents();

			// Resolve agent type
			const rawType = params.subagent_type as string;
			const resolvedKey = getAvailableTypes().find(
				(t) => t.toLowerCase() === rawType.toLowerCase(),
			) ?? rawType;
			const subagentType = getAvailableTypes().includes(resolvedKey) ? resolvedKey : "general-purpose";
			const fellBack = subagentType === "general-purpose" && resolvedKey !== "general-purpose";

			const displayName = getConfig(subagentType).displayName;
			const customConfig = getAgentConfig(subagentType);
			const resolvedConfig = resolveAgentInvocationConfig(customConfig, {
				model: params.model as string | undefined,
				thinking: params.thinking as string | undefined,
				max_turns: params.max_turns as number | undefined,
				run_in_background: params.run_in_background as boolean | undefined,
				inherit_context: params.inherit_context as boolean | undefined,
				isolated: params.isolated as boolean | undefined,
			});

			// Resolve model — ALWAYS compute modelName (the pix twist)
			let model = ctx.model;
			let modelName: string | undefined;
			if (resolvedConfig.modelInput) {
				const resolved = resolveModel(resolvedConfig.modelInput, ctx.modelRegistry);
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

			const thinking = resolvedConfig.thinking;
			const inheritContext = resolvedConfig.inheritContext;
			const runInBackground = resolvedConfig.runInBackground;
			const isolated = resolvedConfig.isolated;
			const effectiveMaxTurns = normalizeMaxTurns(resolvedConfig.maxTurns);

			// Build invocation snapshot (for widget + notification)
			const agentInvocation: AgentInvocation = {
				modelName,        // always set
				thinking,
				maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
				isolated,
				inheritContext,
				runInBackground,
			};

			const detailBase = {
				displayName,
				description: params.description as string,
				subagentType,
				modelName,   // pix twist: always pass through
				tags: [] as string[],
			};

			if (falling_back_note(fellBack)) detailBase.tags.push("(unknown type → general-purpose)");
			if (thinking) detailBase.tags.push(`thinking: ${thinking}`);
			if (isolated) detailBase.tags.push("isolated");

			// Resume existing agent
			if (params.resume) {
				const existing = manager.getRecord(params.resume as string);
				if (!existing) return textResult(`Agent not found: "${params.resume}". It may have been cleaned up.`);
				if (!existing.session) return textResult(`Agent "${params.resume}" has no active session to resume.`);
				const record = await manager.resume(params.resume as string, params.prompt as string, signal);
				if (!record) return textResult(`Failed to resume agent "${params.resume}".`);
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

			// Background execution
			if (runInBackground) {
				const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(
					effectiveMaxTurns,
					() => { agentActivity.set(id, bgState); },
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
			}

			// Foreground execution — streams via onUpdate
			const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(
				effectiveMaxTurns,
				() => {
					if (!onUpdate) return;
					onUpdate({
						content: [{ type: "text", text: fgState.responseText }],
						details: buildDetails(detailBase, {
							...fgState,
							status: "running",
							toolUses: fgState.toolUses,
							startedAt: Date.now() - fgState.durationMs,
						}) as unknown,
					});
				},
			);

			const record = await manager.spawnAndWait(
				pi,
				ctx,
				subagentType,
				params.prompt as string,
				{
					description: params.description as string,
					model,
					maxTurns: effectiveMaxTurns,
					isolated,
					inheritContext,
					thinkingLevel: thinking,
					invocation: agentInvocation,
					allowedToolNames,
					...fgCallbacks,
				},
			);

			const resultText = record.result?.trim() || record.error?.trim() || "No output.";
			return textResult(resultText, buildDetails(detailBase, record, fgState));
		},
	});
}

// ── agent_result tool ────────────────────────────────────────────────────────

export function createAgentResultTool(
	manager: AgentManager,
	agentActivity: Map<string, AgentActivity>,
) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.GET_RESULT,
		label: "Agent Result",
		description: "Fetch the latest output or full result of a background agent by ID. Call this to retrieve what a background agent produced. Sets resultConsumed so the completion notification is suppressed.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID returned by the agent tool." }),
			verbose: Type.Optional(
				Type.Boolean({ description: "true = full conversation history; false (default) = latest assistant text only." }),
			),
		}),

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent_result ")) + theme.fg("accent", args.agent_id as string),
				0,
				0,
			);
		},

		async execute(_toolCallId, params) {
			const id = params.agent_id as string;
			const record = manager.getRecord(id);
			if (!record) {
				return {
					content: [{ type: "text" as const, text: `Agent not found: "${id}". It may have been cleaned up or the ID is wrong.` }],
					details: undefined as unknown,
				};
			}

			// Suppress the pending completion nudge (agent_result consumed it)
			record.resultConsumed = true;

			if (params.verbose && record.session) {
				const convo = getAgentConversation(record.session);
				return { content: [{ type: "text" as const, text: convo || "No conversation history yet." }], details: undefined as unknown };
			}

			const activity = agentActivity.get(id);
			const text =
				record.status === "running"
					? (activity?.responseText?.trim() || "Agent is still running. No output yet.")
					: (record.result?.trim() || record.error?.trim() || "No output.");
			return { content: [{ type: "text" as const, text }], details: undefined as unknown };
		},
	});
}

// ── agent_steer tool ─────────────────────────────────────────────────────────

export function createAgentSteerTool(manager: AgentManager) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.STEER,
		label: "Steer Agent",
		description: "Inject a steering message into a running background agent to redirect its work without restarting. The message is delivered after the agent's current tool execution completes.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to steer." }),
			message: Type.String({ description: "The steering message to inject." }),
		}),

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent_steer ")) + theme.fg("accent", args.agent_id as string),
				0,
				0,
			);
		},

		async execute(_toolCallId, params) {
			const id = params.agent_id as string;
			const record = manager.getRecord(id);
			if (!record) {
				return {
					content: [{ type: "text" as const, text: `Agent not found: "${id}".` }],
					details: undefined as unknown,
				};
			}

			const message = params.message as string;

			if (record.session) {
				try {
					await record.session.steer(message);
					return { content: [{ type: "text" as const, text: `Steering message delivered to agent "${id}".` }], details: undefined as unknown };
				} catch (err) {
					return {
						content: [{ type: "text" as const, text: `Failed to steer agent: ${err instanceof Error ? err.message : String(err)}` }],
						details: undefined as unknown,
					};
				}
			}

			// Session not ready yet — queue the steer
			if (!record.pendingSteers) record.pendingSteers = [];
			record.pendingSteers.push(message);
			return {
				content: [{ type: "text" as const, text: `Agent "${id}" session not yet ready. Steer queued and will be delivered on session start.` }],
				details: undefined as unknown,
			};
		},
	});
}

// ── shared helpers ───────────────────────────────────────────────────────────

/** No-op helper to clearly name the fallback for TypeScript narrowing. */
function falling_back_note(b: boolean): b is true { return b; }

/**
 * Create an AgentActivity state and spawn callbacks for tracking tool usage.
 */
function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
	const state: AgentActivity & { durationMs: number } = {
		activeTools: new Map(),
		toolUses: 0,
		turnCount: 1,
		maxTurns,
		responseText: "",
		session: undefined,
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		durationMs: 0,
	};
	const startedAt = Date.now();

	const callbacks = {
		onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
			if (activity.type === "start") {
				state.activeTools.set(activity.toolName + "_" + Date.now(), activity.toolName);
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
		onAssistantUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
			state.lifetimeUsage.input += usage.input;
			state.lifetimeUsage.output += usage.output;
			state.lifetimeUsage.cacheWrite += usage.cacheWrite;
			onStreamUpdate?.();
		},
	};

	return { state, callbacks };
}

function buildDetails(
	base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
	record: { toolUses: number; startedAt: number; completedAt?: number; status: string; error?: string; id?: string; lifetimeUsage: { input: number; output: number; cacheWrite: number } },
	activity?: AgentActivity & { durationMs?: number },
): AgentDetails {
	const totalTokens = getLifetimeTotal(record.lifetimeUsage);
	return {
		...base,
		toolUses: record.toolUses,
		tokens: totalTokens > 0 ? formatTokens(totalTokens) : "",
		turnCount: activity?.turnCount,
		maxTurns: activity?.maxTurns,
		durationMs: activity?.durationMs ?? ((record.completedAt ?? Date.now()) - record.startedAt),
		status: record.status as AgentDetails["status"],
		agentId: record.id,
		error: record.error,
	};
}
