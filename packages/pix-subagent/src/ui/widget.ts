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
import { icon } from "@xynogen/pix-pretty/icon-catalog";
import type { AgentManager } from "../agent-manager.ts";
import { getConfig } from "../agent-types.ts";
import type { AgentActivity, AgentDetails, Theme } from "../tools.ts";
import {
	formatMs,
	formatSpeed,
	formatTokens,
	formatTurns,
	SPINNER,
} from "../tools.ts";
import type { AgentInvocation, SubagentType } from "../types.ts";
import {
	getLifetimeTotal,
	getSessionContextPercent,
	type SessionLike,
} from "../usage.ts";

export type { AgentActivity, AgentDetails, Theme };
export { formatMs, formatSpeed, formatTokens, formatTurns, SPINNER };

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
	theme: Theme;
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
	return `${tokenStr} ${theme.fg("dim", "(")}${annot.join(theme.fg("dim", " · "))}${theme.fg("dim", ")")}`;
}

export function getDisplayName(type: SubagentType): string {
	return getConfig(type).displayName;
}

export function getPromptModeLabel(type: SubagentType): string | undefined {
	return getConfig(type).promptMode === "append" ? "fork" : undefined;
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

	if (invocation.maxTurns != null) tags.push(`max: ${invocation.maxTurns}`);
	return { modelName: invocation.modelName, tags };
}

/**
 * Live tail of agent output: latest non-empty line, tail-anchored to `len`
 * chars (keeps the moving edge, not the stale first line). Leading … marks
 * the clip. e.g. "…ting batch 6".
 */
function truncateLine(text: string, len = 16): string {
	const lines = text.split("\n").filter((l) => l.trim());
	const line = lines.length ? (lines[lines.length - 1] ?? "").trim() : "";
	if (line.length <= len) return line;
	return `…${line.slice(-len)}`;
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
	private lingerTimeout: ReturnType<typeof setTimeout> | undefined;
	private static readonly FINISHED_LINGER_MS = 5_000;
	private static readonly ERROR_LINGER_MS = 15_000;
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
		this.update();
	}

	ensureTimer() {
		// Cancel any pending linger-only timeout — the fast interval supersedes it.
		if (this.lingerTimeout) {
			clearTimeout(this.lingerTimeout);
			this.lingerTimeout = undefined;
		}
		if (!this.widgetInterval) {
			this.widgetInterval = setInterval(() => this.update(), 80);
		}
	}

	private shouldShowFinished(status: string, completedAt: number): boolean {
		// Linger a few seconds after finish, then drop. The ✓ … Done line in the
		// transcript is the permanent record; errors stay longer so failures are
		// noticed. The 80ms widget timer re-evaluates this continuously.
		const linger = ERROR_STATUSES.has(status)
			? AgentWidget.ERROR_LINGER_MS
			: AgentWidget.FINISHED_LINGER_MS;
		return Date.now() - completedAt < linger;
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
			lifetimeUsage?: { input: number; output: number; cacheWrite: number };
			session?: unknown;
			compactionCount?: number;
			turnCount?: number;
			maxTurns?: number;
			streamingMs?: number;
		},
		theme: Theme,
	): string {
		const name = getDisplayName(a.type);
		const modeLabel = getPromptModeLabel(a.type);
		const durationMs = (a.completedAt ?? Date.now()) - a.startedAt;
		const duration = formatMs(durationMs);

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
			icon = theme.fg("success", "✓");
			statusText = theme.fg("dim", " (turn limit)");
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
		// Turns read from the record (a.*), not agentActivity — onComplete deletes
		// the activity entry before this line renders, which had dropped ↻N.
		if (a.turnCount != null && a.turnCount > 0)
			parts.push(formatTurns(a.turnCount, a.maxTurns));
		if (a.toolUses > 0)
			parts.push(`${a.toolUses} tool use${a.toolUses === 1 ? "" : "s"}`);
		// Token + context% + speed read from the record (survives the
		// agentActivity delete that fires in onComplete before this renders).
		const tokens = getLifetimeTotal(a.lifetimeUsage);
		if (tokens > 0) {
			const contextPercent = a.session
				? getSessionContextPercent(a.session as SessionLike)
				: null;
			parts.push(
				formatSessionTokens(
					tokens,
					contextPercent,
					theme,
					a.compactionCount ?? 0,
				),
			);
		}
		parts.push(duration);
		const speed = formatSpeed(
			a.lifetimeUsage?.output ?? 0,
			a.streamingMs ?? durationMs,
		);
		if (speed) parts.push(speed);

		return `${icon} ${theme.fg("dim", name)}${modelLabel}${modeTag} ${theme.fg("dim", "·")} ${theme.fg("dim", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${statusText}`;
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
				a.completedAt != null &&
				this.shouldShowFinished(a.status, a.completedAt),
		);

		if (running.length === 0 && queued.length === 0 && finished.length === 0)
			return [];

		const w = tui.terminal.columns;
		const truncate = (line: string) => truncateToWidth(line, w);
		const hasActive = running.length > 0 || queued.length > 0;
		const headingColor = hasActive ? "accent" : "dim";
		// ○ hollow = incomplete (still running), ● filled disk = complete (all done).
		const headingIcon = hasActive ? "○" : "●";
		const frame = SPINNER[this.widgetFrame % SPINNER.length] ?? "";

		const finishedLines: string[] = [];
		for (const a of finished) {
			finishedLines.push(
				truncate(
					`${theme.fg("dim", "├─")} ${this.renderFinishedLine(a, theme)}`,
				),
			);
		}

		const runningLines: string[] = [];
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
			if (bg && bg.turnCount > 0)
				parts.push(formatTurns(bg.turnCount, bg.maxTurns));
			if (toolUses > 0)
				parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
			if (tokenText) parts.push(tokenText);
			parts.push(elapsed);
			const liveSpeed = formatSpeed(
				bg?.lifetimeUsage.output ?? 0,
				bg?.streamingMs ?? 0,
			);
			if (liveSpeed) parts.push(liveSpeed);
			const statsText = parts.join(" · ");

			// Activity trails at the end (after stats) so its variable width
			// doesn't cause the static identity + stats to bounce around.
			const activity = bg
				? describeActivity(bg.activeTools, bg.responseText)
				: "thinking…";

			runningLines.push(
				truncate(
					theme.fg("dim", "├─") +
						` ${theme.fg("accent", frame)} ${theme.fg("toolTitle", theme.bold(name))}${modelLabel}${modeTag} ${theme.fg("dim", "·")} ${theme.fg("muted", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", statsText)} ${theme.fg("dim", "·")} ${theme.fg("dim", activity)}`,
				),
			);
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
			finishedLines.length + runningLines.length + (queuedLine ? 1 : 0);

		const lines: string[] = [
			truncate(
				theme.fg(headingColor, headingIcon) +
					" " +
					theme.fg(headingColor, "Agents"),
			),
		];

		if (totalBody <= maxBody) {
			lines.push(...finishedLines);
			lines.push(...runningLines);
			if (queuedLine) lines.push(queuedLine);

			// Fix last connector ├─ → └─
			if (lines.length > 1) {
				const last = lines.length - 1;
				lines[last] = (lines[last] ?? "").replace("├─", "└─");
			}
		} else {
			let budget = maxBody - 1;
			let hiddenRunning = 0;
			let hiddenFinished = 0;

			for (const line of runningLines) {
				if (budget >= 1) {
					lines.push(line);
					budget--;
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
			else if (
				a.completedAt != null &&
				this.shouldShowFinished(a.status, a.completedAt)
			)
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
			this.clearTimers();
			return;
		}

		// When only lingering finished agents remain (no active spinner to animate),
		// drop the 80ms polling interval and schedule a one-shot timeout for the
		// earliest linger expiry. This avoids ~12 wasted ticks/s during the 5–15s
		// finished-linger window. ensureTimer() re-arms the fast interval when a
		// new agent starts during the linger window.
		if (!hasActive && hasFinished) {
			if (this.widgetInterval) {
				clearInterval(this.widgetInterval);
				this.widgetInterval = undefined;
			}
			if (!this.lingerTimeout) {
				// Find earliest linger expiry across all finished agents
				let earliest = Number.POSITIVE_INFINITY;
				for (const a of allAgents) {
					if (a.status === "running" || a.status === "queued") continue;
					if (a.completedAt == null) continue;
					const linger = ERROR_STATUSES.has(a.status)
						? AgentWidget.ERROR_LINGER_MS
						: AgentWidget.FINISHED_LINGER_MS;
					const expiry = a.completedAt + linger;
					if (expiry < earliest) earliest = expiry;
				}
				const delay = Math.max(50, earliest - Date.now() + 50); // +50ms epsilon
				this.lingerTimeout = setTimeout(() => {
					this.lingerTimeout = undefined;
					this.update();
				}, delay);
			}
		}

		let newStatusText: string | undefined;
		if (hasActive) {
			const r = runningCount > 0 ? `${runningCount}` : "";
			const q = queuedCount > 0 ? `+${queuedCount}` : "";
			newStatusText = `${icon("agent")} ${this.uiCtx.theme.fg("dim", `${r}${q}`)}`;
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

	private clearTimers() {
		if (this.widgetInterval) {
			clearInterval(this.widgetInterval);
			this.widgetInterval = undefined;
		}
		if (this.lingerTimeout) {
			clearTimeout(this.lingerTimeout);
			this.lingerTimeout = undefined;
		}
	}

	dispose() {
		this.clearTimers();
		if (this.uiCtx) {
			this.uiCtx.setWidget("agents", undefined);
			this.uiCtx.setStatus("subagents", undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
		this.lastStatusText = undefined;
	}
}
