/**
 * ui/widget.ts — Persistent above-editor widget showing running/completed agents.
 *
 * Pix twist vs tintinweb: model name is ALWAYS shown inline in the header line
 * (e.g. "Explore [haiku]") even when it matches the parent model. Types and
 * formatting helpers are re-exported from tools.ts to avoid circular deps.
 *
 * Ported from tintinweb/pi-subagents (MIT), adapted for pix-mono.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentManager } from "../agent-manager.ts";
import { getConfig } from "../agent-types.ts";
import type { AgentActivity, AgentDetails, Theme } from "../tools.ts";
import { formatMs, formatTokens, formatTurns, SPINNER } from "../tools.ts";
import type { AgentInvocation, SubagentType } from "../types.ts";
import { getLifetimeTotal, getSessionContextPercent } from "../usage.ts";

export type { AgentActivity, AgentDetails, Theme };
export { formatMs, formatTokens, formatTurns, SPINNER };

// ── constants ─────────────────────────────────────────────────────────────────

const MAX_WIDGET_LINES = 12;

export const ERROR_STATUSES = new Set([
	"error",
	"aborted",
	"steered",
	"stopped",
]);

const TOOL_DISPLAY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

// ── UICtx type ────────────────────────────────────────────────────────────────

export type UICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((
					tui: unknown,
					theme: Theme,
			  ) => { render(): string[]; invalidate(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
};

// ── helpers ───────────────────────────────────────────────────────────────────

export function formatSessionTokens(
	tokens: number,
	percent: number | null,
	theme: Theme,
	compactions = 0,
): string {
	const tokenStr = formatTokens(tokens);
	const annot: string[] = [];
	if (percent !== null) {
		const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
		annot.push(theme.fg(color, `${Math.round(percent)}%`));
	}
	if (compactions > 0) annot.push(theme.fg("dim", `⇊${compactions}`));
	if (annot.length === 0) return tokenStr;
	return `${tokenStr} (${annot.join(" · ")})`;
}

export function getDisplayName(type: SubagentType): string {
	return getConfig(type).displayName;
}

export function getPromptModeLabel(type: SubagentType): string | undefined {
	return getConfig(type).promptMode === "append" ? "twin" : undefined;
}

export function buildInvocationTags(invocation: AgentInvocation | undefined): {
	modelName?: string;
	tags: string[];
} {
	const tags: string[] = [];
	if (!invocation) return { tags };
	if (invocation.thinking) tags.push(`thinking: ${invocation.thinking}`);
	if (invocation.isolated) tags.push("isolated");
	if (invocation.inheritContext) tags.push("inherit ctx");
	if (invocation.runInBackground) tags.push("bg");
	if (invocation.maxTurns != null) tags.push(`max: ${invocation.maxTurns}`);
	return { modelName: invocation.modelName, tags };
}

function truncateLine(text: string, len = 60): string {
	const line =
		text
			.split("\n")
			.find((l) => l.trim())
			?.trim() ?? "";
	if (line.length <= len) return line;
	return `${line.slice(0, len)}…`;
}

export function describeActivity(
	activeTools: Map<string, string>,
	responseText?: string,
): string {
	if (activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of activeTools.values()) {
			const action = TOOL_DISPLAY[toolName] ?? toolName;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const [action, count] of groups) {
			parts.push(count > 1 ? `${action} ${count}×` : action);
		}
		return `${parts.join(", ")}…`;
	}
	if (responseText?.trim()) return truncateLine(responseText);
	return "thinking…";
}

// ── AgentWidget ───────────────────────────────────────────────────────────────

export class AgentWidget {
	private uiCtx: UICtx | undefined;
	private widgetFrame = 0;
	private widgetInterval: ReturnType<typeof setInterval> | undefined;
	private finishedTurnAge = new Map<string, number>();
	private static readonly ERROR_LINGER_TURNS = 2;
	private widgetRegistered = false;
	private tui: unknown = undefined;
	private lastStatusText: string | undefined;

	constructor(
		private manager: AgentManager,
		private agentActivity: Map<string, AgentActivity>,
	) {}

	setUICtx(ctx: UICtx) {
		if (ctx !== this.uiCtx) {
			this.uiCtx = ctx;
			this.widgetRegistered = false;
			this.tui = undefined;
			this.lastStatusText = undefined;
		}
	}

	onTurnStart() {
		for (const [id, age] of this.finishedTurnAge) {
			this.finishedTurnAge.set(id, age + 1);
		}
		this.update();
	}

	ensureTimer() {
		if (!this.widgetInterval) {
			this.widgetInterval = setInterval(() => this.update(), 80);
		}
	}

	private shouldShowFinished(agentId: string, status: string): boolean {
		const age = this.finishedTurnAge.get(agentId) ?? 0;
		const maxAge = ERROR_STATUSES.has(status)
			? AgentWidget.ERROR_LINGER_TURNS
			: 1;
		return age < maxAge;
	}

	markFinished(agentId: string) {
		if (!this.finishedTurnAge.has(agentId)) {
			this.finishedTurnAge.set(agentId, 0);
		}
	}

	private renderFinishedLine(
		a: {
			id: string;
			type: SubagentType;
			status: string;
			description: string;
			toolUses: number;
			startedAt: number;
			completedAt?: number;
			error?: string;
			invocation?: AgentInvocation;
		},
		theme: Theme,
	): string {
		const name = getDisplayName(a.type);
		const modeLabel = getPromptModeLabel(a.type);
		const duration = formatMs((a.completedAt ?? Date.now()) - a.startedAt);

		// model label (the pix twist — always shown)
		const modelLabel = a.invocation?.modelName
			? ` ${theme.fg("muted", `[${a.invocation.modelName}]`)}`
			: "";
		const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";

		let icon: string;
		let statusText: string;
		if (a.status === "completed") {
			icon = theme.fg("success", "✓");
			statusText = "";
		} else if (a.status === "steered") {
			icon = theme.fg("warning", "✓");
			statusText = theme.fg("warning", " (turn limit)");
		} else if (a.status === "stopped") {
			icon = theme.fg("dim", "■");
			statusText = theme.fg("dim", " stopped");
		} else if (a.status === "error") {
			icon = theme.fg("error", "✗");
			const errMsg = a.error ? `: ${a.error.slice(0, 60)}` : "";
			statusText = theme.fg("error", ` error${errMsg}`);
		} else {
			icon = theme.fg("error", "✗");
			statusText = theme.fg("warning", " aborted");
		}

		const parts: string[] = [];
		const activity = this.agentActivity.get(a.id);
		if (activity)
			parts.push(formatTurns(activity.turnCount, activity.maxTurns));
		if (a.toolUses > 0)
			parts.push(`${a.toolUses} tool use${a.toolUses === 1 ? "" : "s"}`);
		parts.push(duration);

		return `${icon} ${theme.fg("dim", name)}${modelLabel}${modeTag}  ${theme.fg("dim", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${statusText}`;
	}

	private renderWidget(
		tui: { terminal: { columns: number }; requestRender?: () => void },
		theme: Theme,
	): string[] {
		const allAgents = this.manager.listAgents();
		const running = allAgents.filter((a) => a.status === "running");
		const queued = allAgents.filter((a) => a.status === "queued");
		const finished = allAgents.filter(
			(a) =>
				a.status !== "running" &&
				a.status !== "queued" &&
				a.completedAt &&
				this.shouldShowFinished(a.id, a.status),
		);

		if (running.length === 0 && queued.length === 0 && finished.length === 0)
			return [];

		const w = tui.terminal.columns;
		const truncate = (line: string) => truncateToWidth(line, w);
		const hasActive = running.length > 0 || queued.length > 0;
		const headingColor = hasActive ? "accent" : "dim";
		const headingIcon = hasActive ? "●" : "○";
		const frame = SPINNER[this.widgetFrame % SPINNER.length];

		const finishedLines: string[] = [];
		for (const a of finished) {
			finishedLines.push(
				truncate(
					`${theme.fg("dim", "├─")} ${this.renderFinishedLine(a, theme)}`,
				),
			);
		}

		const runningLines: string[][] = [];
		for (const a of running) {
			const name = getDisplayName(a.type);
			const modeLabel = getPromptModeLabel(a.type);
			// model label inline (the pix twist)
			const modelLabel = a.invocation?.modelName
				? ` ${theme.fg("muted", `[${a.invocation.modelName}]`)}`
				: "";
			const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
			const elapsed = formatMs(Date.now() - a.startedAt);

			const bg = this.agentActivity.get(a.id);
			const toolUses = bg?.toolUses ?? a.toolUses;
			const tokens = getLifetimeTotal(bg?.lifetimeUsage);
			const contextPercent = bg?.session
				? getSessionContextPercent(
						bg.session as Parameters<typeof getSessionContextPercent>[0],
					)
				: null;
			const tokenText =
				tokens > 0
					? formatSessionTokens(
							tokens,
							contextPercent,
							theme,
							a.compactionCount,
						)
					: "";

			const parts: string[] = [];
			if (bg) parts.push(formatTurns(bg.turnCount, bg.maxTurns));
			if (toolUses > 0)
				parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
			if (tokenText) parts.push(tokenText);
			parts.push(elapsed);
			const statsText = parts.join(" · ");

			const activity = bg
				? describeActivity(bg.activeTools, bg.responseText)
				: "thinking…";

			runningLines.push([
				truncate(
					theme.fg("dim", "├─") +
						` ${theme.fg("accent", frame)} ${theme.bold(name)}${modelLabel}${modeTag}  ${theme.fg("muted", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", statsText)}`,
				),
				truncate(theme.fg("dim", "│  ") + theme.fg("dim", `  ⎿  ${activity}`)),
			]);
		}

		const queuedLine =
			queued.length > 0
				? truncate(
						theme.fg("dim", "├─") +
							` ${theme.fg("muted", "◦")} ${theme.fg("dim", `${queued.length} queued`)}`,
					)
				: undefined;

		const maxBody = MAX_WIDGET_LINES - 1;
		const totalBody =
			finishedLines.length + runningLines.length * 2 + (queuedLine ? 1 : 0);

		const lines: string[] = [
			truncate(
				theme.fg(headingColor, headingIcon) +
					" " +
					theme.fg(headingColor, "Agents"),
			),
		];

		if (totalBody <= maxBody) {
			lines.push(...finishedLines);
			for (const pair of runningLines) lines.push(...pair);
			if (queuedLine) lines.push(queuedLine);

			// Fix last connector ├─ → └─
			if (lines.length > 1) {
				const last = lines.length - 1;
				lines[last] = lines[last].replace("├─", "└─");
				if (runningLines.length > 0 && !queuedLine && last >= 2) {
					lines[last - 1] = lines[last - 1].replace("├─", "└─");
					lines[last] = lines[last].replace("│  ", "   ");
				}
			}
		} else {
			let budget = maxBody - 1;
			let hiddenRunning = 0;
			let hiddenFinished = 0;

			for (const pair of runningLines) {
				if (budget >= 2) {
					lines.push(...pair);
					budget -= 2;
				} else {
					hiddenRunning++;
				}
			}
			if (queuedLine && budget >= 1) {
				lines.push(queuedLine);
				budget--;
			}
			for (const fl of finishedLines) {
				if (budget >= 1) {
					lines.push(fl);
					budget--;
				} else {
					hiddenFinished++;
				}
			}

			const overflowParts: string[] = [];
			if (hiddenRunning > 0) overflowParts.push(`${hiddenRunning} running`);
			if (hiddenFinished > 0) overflowParts.push(`${hiddenFinished} finished`);
			lines.push(
				truncate(
					theme.fg("dim", "└─") +
						` ${theme.fg("dim", `+${hiddenRunning + hiddenFinished} more (${overflowParts.join(", ")})`)}`,
				),
			);
		}

		return lines;
	}

	update() {
		if (!this.uiCtx) return;
		const allAgents = this.manager.listAgents();

		let runningCount = 0;
		let queuedCount = 0;
		let hasFinished = false;
		for (const a of allAgents) {
			if (a.status === "running") runningCount++;
			else if (a.status === "queued") queuedCount++;
			else if (a.completedAt && this.shouldShowFinished(a.id, a.status))
				hasFinished = true;
		}
		const hasActive = runningCount > 0 || queuedCount > 0;

		if (!hasActive && !hasFinished) {
			if (this.widgetRegistered) {
				this.uiCtx.setWidget("agents", undefined);
				this.widgetRegistered = false;
				this.tui = undefined;
			}
			if (this.lastStatusText !== undefined) {
				this.uiCtx.setStatus("subagents", undefined);
				this.lastStatusText = undefined;
			}
			if (this.widgetInterval) {
				clearInterval(this.widgetInterval);
				this.widgetInterval = undefined;
			}
			for (const [id] of this.finishedTurnAge) {
				if (!allAgents.some((a) => a.id === id))
					this.finishedTurnAge.delete(id);
			}
			return;
		}

		let newStatusText: string | undefined;
		if (hasActive) {
			const parts: string[] = [];
			if (runningCount > 0) parts.push(`${runningCount} running`);
			if (queuedCount > 0) parts.push(`${queuedCount} queued`);
			const total = runningCount + queuedCount;
			newStatusText = `${parts.join(", ")} agent${total === 1 ? "" : "s"}`;
		}
		if (newStatusText !== this.lastStatusText) {
			this.uiCtx.setStatus("subagents", newStatusText);
			this.lastStatusText = newStatusText;
		}

		this.widgetFrame++;

		if (!this.widgetRegistered) {
			this.uiCtx.setWidget(
				"agents",
				(tui, theme) => {
					this.tui = tui;
					return {
						render: () =>
							this.renderWidget(
								tui as {
									terminal: { columns: number };
									requestRender?: () => void;
								},
								theme,
							),
						invalidate: () => {
							this.widgetRegistered = false;
							this.tui = undefined;
						},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else {
			(
				this.tui as { requestRender?: () => void } | undefined
			)?.requestRender?.();
		}
	}

	dispose() {
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		if (this.uiCtx) {
			this.uiCtx.setWidget("agents", undefined);
			this.uiCtx.setStatus("subagents", undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
		this.lastStatusText = undefined;
	}
}
