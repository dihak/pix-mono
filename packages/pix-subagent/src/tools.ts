/**
 * tools.ts — The 3 LLM-callable tool definitions:
 *   agent          — spawn a sub-agent (fg or bg)
 *   agent_result   — fetch latest output / full result by id
 *   agent_steer    — steer or force-stop a running bg agent
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
import { lookupBenchmark } from "@xynogen/pix-data";
import { icon } from "@xynogen/pix-pretty/icon-catalog";
import { Type } from "typebox";
import type { AgentManager } from "./agent-manager.ts";
import { getAgentConversation, normalizeMaxTurns, SUBAGENT_TOOL_NAMES } from "./agent-runner.ts";
import { BUILTIN_TOOL_NAMES, getAgentConfig, getAvailableTypes, getConfig } from "./agent-types.ts";
import { resolveAgentInvocationConfig } from "./invocation-config.ts";
import { resolveModel } from "./model-resolver.ts";
import type { AgentInvocation, LifetimeUsage } from "./types.ts";
import { type ContextUsageLike, getSessionContextUsage, type SessionLike } from "./usage.ts";

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
	/** Context-window utilization as a pre-formatted string (e.g. "30.1K/1.00M (3%)"), or "" when unavailable. */
	context: string;
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
	const t = icon("tokens");
	if (count >= 1_000_000) return `${t} ${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${t} ${(count / 1_000).toFixed(1)}k token`;
	return `${t} ${count} token`;
}

/** Compact token count: 500 → "500", 30_100 → "30.1K", 1_000_000 → "1.00M". */
export function fmtTokenCount(n: number): string {
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Format context-window utilization: "󰉿 30.1K/1.00M (3%)".
 * Falls back to "󰉿 3% ctx" when the window size is unknown.
 * Returns "" when percent is null/unavailable (caller should skip the segment).
 */
export function formatContext(usage: ContextUsageLike | null | undefined): string {
	if (usage?.percent == null) return "";
	const t = icon("tokens");
	const pct = Math.round(usage.percent);
	if (!usage.contextWindow) return `${t} ${pct}% ctx`;
	const used = usage.tokens ?? Math.round((usage.percent / 100) * usage.contextWindow);
	return `${t} ${fmtTokenCount(used)}/${fmtTokenCount(usage.contextWindow)} (${pct}%)`;
}

export function formatTurns(turnCount: number, maxTurns?: number | null): string {
	const t = icon("turns");
	return maxTurns != null ? `${t} ${turnCount}≤${maxTurns}` : `${t} ${turnCount}`;
}

export function formatToolUses(count: number): string {
	return `${icon("tools")} ${count}`;
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

/** Render the agent call header and its task prompt in the transcript. */
export function formatAgentCall(args: Record<string, unknown>, theme: Theme): string {
	const typeName = resolveTypeName(args);
	const displayName = typeName ? getConfig(typeName).displayName : "Agent";
	const description = typeof args.description === "string" ? args.description : "";
	const model = typeof args.model === "string" ? args.model : "";
	const prompt = typeof args.prompt === "string" ? args.prompt : "";
	const modelStr = model ? ` ${theme.fg("muted", `[${model}]`)}` : "";
	const header =
		"▸ " +
		theme.fg("toolTitle", theme.bold(displayName)) +
		modelStr +
		(description ? `  ${theme.fg("muted", description)}` : "");

	// renderCall replaces Pi's default argument renderer. Keep the prompt here so
	// blocking foreground calls retain their only task context in the transcript.
	return prompt ? `${header}\n${theme.fg("dim", JSON.stringify(prompt))}` : header;
}

// ── Activity description (shared with ui/widget.ts) ──────────────────────────

export const TOOL_DISPLAY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

/**
 * Live tail of agent output: latest non-empty line, tail-anchored to `len`
 * chars (keeps the moving edge, not the stale first line).
 */
function truncateLine(text: string, len = 16): string {
	const lines = text.split("\n").filter((l) => l.trim());
	const line = lines.length ? (lines[lines.length - 1] ?? "").trim() : "";
	if (line.length <= len) return line;
	return `\u2026${line.slice(-len)}`;
}

export function describeActivity(activeTools: Map<string, string>, responseText?: string): string {
	if (activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of activeTools.values()) {
			const action = TOOL_DISPLAY[toolName] ?? toolName;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const [action, count] of groups) {
			parts.push(count > 1 ? `${action} ${count}\u00d7` : action);
		}
		return `${parts.join(", ")}\u2026`;
	}
	if (responseText?.trim()) return truncateLine(responseText);
	return "thinking\u2026";
}

// ── helpers ──────────────────────────────────────────────────────────────────

function textResult(msg: string, details?: AgentDetails) {
	return {
		content: [{ type: "text" as const, text: msg }],
		details: details as unknown,
	};
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
	if (d.turnCount != null && d.turnCount > 0)
		parts.push(theme.fg("dim", formatTurns(d.turnCount, d.maxTurns)));
	if (d.toolUses > 0) parts.push(theme.fg("dim", formatToolUses(d.toolUses)));
	if (d.context) parts.push(theme.fg("dim", d.context));
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
		modelList.length > 0 ? `\nAvailable models:\n${modelList.map((m) => `  ${m}`).join("\n")}` : "";

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
- Agents run in **background** by default: the tool returns immediately and automatically delivers the result when the agent finishes. Use this for independent work; do NOT poll or sleep-wait.
- **Foreground** (\`background: false\`): the tool blocks until the agent finishes and returns its result inline. Use it only when the result is required before proceeding (e.g. Plan or Explore before editing).
- \`agent_result\` is only needed to re-read a past background result or get verbose conversation history — never to wait.
- \`resume\` with an agent ID to continue a prior agent's work; \`agent_steer\` to redirect a running background agent or force-stop it (action: 'stop').
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
				description: "A short (3-5 word) description of the task (shown in UI).",
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
					description: "Maximum agentic turns before stopping. Omit for unlimited.",
					minimum: 1,
				}),
			),
			resume: Type.Optional(
				Type.String({
					description: "Agent ID to resume from. Continues previous context.",
				}),
			),
			background: Type.Optional(
				Type.Boolean({
					default: true,
					description:
						"Run in background (non-blocking). Default true. Set false only when the tool must block and return the result inline.",
				}),
			),
		}),

		renderCall(args, theme) {
			return new Text(formatAgentCall(args as Record<string, unknown>, theme), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as AgentDetails | undefined;
			if (!details) {
				const text = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(text, 0, 0);
			}

			const stats = buildStats(details, theme);

			// Streaming / running — show a compact live status line so the model
			// and activity are visible inline in the transcript (the ● Agents
			// widget carries full detail above the editor).
			if (isPartial || details.status === "running") {
				const frame =
					details.spinnerFrame != null
						? (SPINNER[details.spinnerFrame % SPINNER.length] ?? "⠋")
						: "⠋";
				const modelLabel = details.modelName
					? ` ${theme.fg("muted", `[${details.modelName}]`)}`
					: "";

				const parts: string[] = [];
				if (details.turnCount != null && details.turnCount > 0)
					parts.push(formatTurns(details.turnCount, details.maxTurns));
				if (details.toolUses > 0) parts.push(formatToolUses(details.toolUses));
				if (details.context) parts.push(details.context);
				const liveSpeed = formatSpeed(details.outputTokens ?? 0, details.streamingMs ?? 0);
				if (liveSpeed) parts.push(liveSpeed);
				if (details.durationMs > 0) parts.push(formatMs(details.durationMs));
				if (details.activity) parts.push(details.activity);
				const statsText =
					parts.length > 0 ? ` ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}` : "";

				const line =
					`  ${theme.fg("accent", frame)} ${theme.fg("toolTitle", theme.bold(details.displayName))}${modelLabel}` +
					` ${theme.fg("dim", "·")} ${theme.fg("muted", details.description)}${statsText}`;
				return new Text(line, 0, 0);
			}

			// Background launched
			if (details.status === "background") {
				const modelTag = details.modelName ? ` ${theme.fg("muted", `[${details.modelName}]`)}` : "";
				return new Text(
					theme.fg("dim", `  ⎿  Launched${modelTag} — result auto-delivered on completion`),
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
					const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
					if (resultText) {
						const lines = resultText.split("\n").slice(0, 50);
						for (const l of lines) line += `\n${theme.fg("dim", `  ${l}`)}`;
						if (resultText.split("\n").length > 50)
							line += `\n${theme.fg("muted", "  … (use agent_result with verbose for full output)")}`;
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
			else line += `\n${theme.fg("warning", "  ⎿  Aborted (max turns exceeded)")}`;
			return new Text(line, 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
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
				getAvailableTypes().find((t) => t.toLowerCase() === rawType.toLowerCase()) ?? rawType;
			const subagentType = getAvailableTypes().includes(resolvedKey)
				? resolvedKey
				: "general-purpose";
			const fellBack = subagentType === "general-purpose" && resolvedKey !== "general-purpose";

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
					return textResult(`Agent not found: "${params.resume}". It may have been cleaned up.`);
				if (!existing.session)
					return textResult(`Agent "${params.resume}" has no active session to resume.`);
				const record = await manager.resume(
					params.resume as string,
					params.prompt as string,
					signal,
				);
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

			const isBackground = runsInBackground(params.background);

			if (isBackground) {
				// ── Background mode: spawn and return immediately ──────────
				const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(
					effectiveMaxTurns,
					() => {
						agentActivity.set(bgId, bgState);
					},
				);

				let bgId: string;
				try {
					bgId = manager.spawn(pi, ctx, subagentType, params.prompt as string, {
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

				agentActivity.set(bgId, bgState);

				// Mark as user-initiated background so the widget lingers the
				// finished line (foreground results show inline in transcript).
				const bgRecord = manager.getRecord(bgId);
				if (bgRecord) bgRecord.isBackground = true;

				return textResult(
					`Agent launched (ID: ${bgId}). Its result will be delivered automatically when it finishes — do NOT poll or sleep-wait. Continue with other work or respond to the user.`,
					{
						...detailBase,
						toolUses: 0,
						context: "",
						durationMs: 0,
						status: "background",
						agentId: bgId,
					},
				);
			}

			// ── Foreground mode (background: false): await inline with streaming progress ──
			let fgSpinnerFrame = 0;
			const fgStartedAt = Date.now();
			const fgUpdateInterval = onUpdate
				? setInterval(() => {
						fgSpinnerFrame++;
						const act = agentActivity.get(fgId);
						const activity = act
							? describeActivity(act.activeTools, act.responseText)
							: "thinking…";
						const contextUsage = act?.session
							? getSessionContextUsage(act.session as SessionLike)
							: null;
						onUpdate({
							content: [{ type: "text" as const, text: "" }],
							details: {
								...detailBase,
								toolUses: act?.toolUses ?? 0,
								context: formatContext(contextUsage),
								outputTokens: act?.lifetimeUsage.output,
								streamingMs: act?.streamingMs,
								durationMs: Date.now() - fgStartedAt,
								status: "running" as const,
								activity,
								spinnerFrame: fgSpinnerFrame,
								turnCount: act?.turnCount,
								maxTurns: act?.maxTurns,
							} satisfies AgentDetails,
						});
					}, 80)
				: undefined;

			const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(
				effectiveMaxTurns,
				() => {
					agentActivity.set(fgId, fgState);
				},
			);

			let fgId: string;
			try {
				fgId = manager.spawn(pi, ctx, subagentType, params.prompt as string, {
					description: params.description as string,
					model,
					maxTurns: effectiveMaxTurns,
					isolated,
					inheritContext,
					thinkingLevel: thinking,
					// Keep the manager record foreground so the widget does not render
					// a second status line while this blocking tool call streams inline.
					isBackground: false,
					invocation: agentInvocation,
					signal, // foreground: parent abort kills the agent
					allowedToolNames,
					...fgCallbacks,
				});
			} catch (err) {
				if (fgUpdateInterval) clearInterval(fgUpdateInterval);
				return textResult(err instanceof Error ? err.message : String(err));
			}

			agentActivity.set(fgId, fgState);

			// Emit initial partial so renderResult shows the live line immediately
			if (onUpdate) {
				onUpdate({
					content: [{ type: "text" as const, text: "" }],
					details: {
						...detailBase,
						toolUses: 0,
						context: "",
						durationMs: 0,
						status: "running" as const,
						activity: "starting…",
						spinnerFrame: 0,
						turnCount: 0,
						maxTurns: effectiveMaxTurns,
					} satisfies AgentDetails,
				});
			}

			// Await the agent's promise — this blocks the tool call until the agent finishes
			const record = manager.getRecord(fgId);
			if (record?.promise) {
				await record.promise;
			}

			if (fgUpdateInterval) clearInterval(fgUpdateInterval);

			// Suppress the completion notification — result is returned inline
			const finalRecord = manager.getRecord(fgId);
			if (finalRecord) finalRecord.resultConsumed = true;

			agentActivity.delete(fgId);

			const resultText = finalRecord?.result?.trim() || finalRecord?.error?.trim() || "No output.";

			return textResult(
				resultText,
				buildDetails(
					detailBase,
					finalRecord ?? {
						toolUses: 0,
						startedAt: Date.now(),
						status: "error",
						lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
					},
					fgState,
				),
			);
		},
	});
}

/**
 * Background is the safe default: parent work can continue while an independent
 * child runs. Only an explicit `false` opts into the blocking inline-result path.
 */
export function runsInBackground(background: unknown): boolean {
	return background !== false;
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
			"Fetch the latest output or full result of a background agent by ID. Call this to retrieve what a background agent produced. Sets resultConsumed so the completion notification is suppressed.\n\nNOTE: You do NOT need to call this to wait for an agent. Results are delivered automatically when agents finish. Only use this to re-read a previous result or get verbose conversation history.",
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
					? activity?.responseText?.trim() || "Agent is still running. No output yet."
					: record.result?.trim() || record.error?.trim() || "No output.";
			return {
				content: [{ type: "text" as const, text }],
				details: undefined as unknown,
			};
		},
	});
}

// ── agent_steer tool (polymorphic: steer | stop) ────────────────────────────

export function createAgentSteerTool(manager: AgentManager) {
	return defineTool({
		name: SUBAGENT_TOOL_NAMES.STEER,
		label: "Steer Agent",
		description:
			"Steer or force-stop a running background agent. action='steer' (default) injects a steering message after the agent's current tool execution completes. action='stop' immediately aborts the agent — use when the agent is stuck, no longer needed, or the user asks to kill it.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to steer or stop." }),
			action: Type.Optional(
				Type.Union([Type.Literal("steer"), Type.Literal("stop")], {
					description:
						"'steer' (default) to redirect the agent with a message. 'stop' to force-kill the agent immediately.",
					default: "steer",
				}),
			),
			message: Type.Optional(
				Type.String({
					description:
						"The steering message to inject. Required for action='steer', ignored for action='stop'.",
				}),
			),
		}),

		renderCall(args, theme) {
			const action = (args.action as string) || "steer";
			const label = action === "stop" ? "agent_stop" : "agent_steer";
			return new Text(
				theme.fg("toolTitle", theme.bold(`${label} `)) +
					theme.fg(action === "stop" ? "error" : "accent", args.agent_id as string),
				0,
				0,
			);
		},

		async execute(_toolCallId, params) {
			const id = params.agent_id as string;
			const action = (params.action as string) || "steer";
			const record = manager.getRecord(id);
			if (!record) {
				return {
					content: [{ type: "text" as const, text: `Agent not found: "${id}".` }],
					details: undefined as unknown,
				};
			}

			// ── stop action: force-abort immediately ──────────────────
			if (action === "stop") {
				const stopped = manager.abort(id);
				if (!stopped) {
					// Already finished — return whatever result it produced
					const existing = record.result ?? "";
					return {
						content: [
							{
								type: "text" as const,
								text: `Agent "${id}" is not running (status: ${record.status}).${existing ? `\nPartial output:\n${existing}` : ""}`,
							},
						],
						details: undefined as unknown,
					};
				}

				// Wait briefly for the session to flush its partial response text
				// into record.result (the .then() handler runs async after abort).
				await new Promise((r) => setTimeout(r, 200));

				const partial = record.result ?? "";
				const lines = [
					`Agent "${id}" stopped.`,
					partial
						? `Partial output saved. Use agent_result("${id}") to retrieve it.`
						: "No output was captured before the agent was stopped.",
				];
				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: undefined as unknown,
				};
			}

			// ── steer action: inject message ──────────────────────────
			const message = params.message as string | undefined;
			if (!message) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Missing required 'message' parameter for steer action.`,
						},
					],
					details: undefined as unknown,
				};
			}

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
				state.activeTools.set(`${activity.toolName}_${Date.now()}`, activity.toolName);
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
		onAssistantUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
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
	base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
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
	const contextUsage = activity?.session
		? getSessionContextUsage(activity.session as SessionLike)
		: null;
	return {
		...base,
		toolUses: record.toolUses,
		context: formatContext(contextUsage),
		outputTokens: record.lifetimeUsage.output,
		streamingMs: activity?.streamingMs,
		turnCount: activity?.turnCount,
		maxTurns: activity?.maxTurns,
		durationMs: activity?.durationMs ?? (record.completedAt ?? Date.now()) - record.startedAt,
		status: record.status as AgentDetails["status"],
		agentId: record.id,
		error: record.error,
	};
}
