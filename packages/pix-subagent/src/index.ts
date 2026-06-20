/**
 * index.ts — pix-subagent extension entry point.
 *
 * Registers 3 LLM-callable tools (agent, agent_result, agent_steer),
 * a live above-editor widget (model shown inline), and a themed
 * subagent-notification renderer.
 *
 * Best-of-both:
 *   - tintinweb/pi-subagents spawn engine (MIT) — battle-tested createAgentSession path
 *   - nicobailon/pi-subagents explicit work-splitting (allowed_tools[], model param)
 *   - pix twist: model name ALWAYS visible in widget + notification
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCustomAgents } from "./custom-agents.ts";
import { registerAgents } from "./agent-types.ts";
import { AgentManager } from "./agent-manager.ts";
import { listAvailable } from "./model-resolver.ts";
import {
	createAgentTool,
	createAgentResultTool,
	createAgentSteerTool,
	type AgentActivity,
} from "./tools.ts";
import { AgentWidget } from "./ui/widget.ts";
import { registerNotificationRenderer } from "./ui/notification.ts";
import { getLifetimeTotal } from "./usage.ts";
import type { NotificationDetails } from "./types.ts";

const EXTENSION_KEY = "pix-subagent";

// Reload guard key — stored on globalThis so a dev-reload cleans up stale state
const CLEANUP_KEY = `__${EXTENSION_KEY}Cleanup`;

export default function registerPixSubagent(pi: ExtensionAPI): void {
	// ── Cleanup stale timers from a prior reload ───────────────────────────────
	const g = globalThis as Record<string, unknown>;
	const prevCleanup = g[CLEANUP_KEY];
	if (typeof prevCleanup === "function") {
		try { (prevCleanup as () => void)(); } catch { /* best effort */ }
	}

	// ── Agent registry ─────────────────────────────────────────────────────────
	const reloadCustomAgents = () => {
		const userAgents = loadCustomAgents(process.cwd());
		registerAgents(userAgents);
	};
	reloadCustomAgents();

	// ── State ──────────────────────────────────────────────────────────────────
	const agentActivity = new Map<string, AgentActivity>();

	// Debounce: brief hold so agent_result can cancel a notification it just consumed
	const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
	const NUDGE_HOLD_MS = 200;

	function scheduleNudge(key: string, send: () => void) {
		cancelNudge(key);
		pendingNudges.set(key, setTimeout(() => {
			pendingNudges.delete(key);
			try { send(); } catch { /* ignore stale context errors */ }
		}, NUDGE_HOLD_MS));
	}

	function cancelNudge(key: string) {
		const t = pendingNudges.get(key);
		if (t != null) { clearTimeout(t); pendingNudges.delete(key); }
	}

	// ── AgentManager ──────────────────────────────────────────────────────────
	const manager = new AgentManager(
		// onComplete — fire subagent-notification nudge for each finished bg agent
		(record) => {
			agentActivity.delete(record.id);
			widget.markFinished(record.id);

			if (record.resultConsumed) {
				widget.update();
				return;
			}

			const totalTokens = getLifetimeTotal(record.lifetimeUsage);
			const activity = agentActivity.get(record.id);
			const resultPreview = record.result
				? record.result.length > 500 ? record.result.slice(0, 500) + "…" : record.result
				: "No output.";

			const details: NotificationDetails = {
				id: record.id,
				description: record.description,
				status: record.status,
				modelName: record.invocation?.modelName,
				toolUses: record.toolUses,
				turnCount: activity?.turnCount ?? 0,
				maxTurns: activity?.maxTurns,
				totalTokens,
				durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
				error: record.error,
				resultPreview,
			};

			scheduleNudge(record.id, () => {
				if (record.resultConsumed) { widget.update(); return; }
				pi.sendMessage<NotificationDetails>(
					{
						customType: "subagent-notification",
						content: `Agent "${record.description}" ${record.status}.`,
						display: true,
						details,
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			});

			widget.update();
		},
		4, // maxConcurrent
		// onStart
		(_record) => { widget.update(); },
	);

	// ── Widget ─────────────────────────────────────────────────────────────────
	const widget = new AgentWidget(manager, agentActivity);

	// ── Register renderers ─────────────────────────────────────────────────────
	registerNotificationRenderer(pi);

	// ── Build initial tool description with model list ─────────────────────────
	// Model list is empty until session_start provides a modelRegistry.
	// Tools are registered once; the description is rebuilt on session_start via
	// re-registering (pi.registerTool replaces by name — verify this at smoke test).
	// ponytail: if re-register isn't supported mid-session, the list stays empty
	// first session; acceptable until we find a hook to refresh.
	let currentModelList: string[] = [];

	function registerTools() {
		pi.registerTool(
			createAgentTool(pi as Parameters<typeof manager.spawnAndWait>[0], manager, agentActivity, reloadCustomAgents, currentModelList),
		);
		pi.registerTool(createAgentResultTool(manager, agentActivity));
		pi.registerTool(createAgentSteerTool(manager));
	}

	registerTools();

	// ── Lifecycle ──────────────────────────────────────────────────────────────
	pi.on("session_start", (_event, ctx) => {
		manager.clearCompleted();
		agentActivity.clear();

		// Refresh model list from live registry
		const newList = listAvailable(ctx.modelRegistry);
		if (newList.join(",") !== currentModelList.join(",")) {
			currentModelList = newList;
			// Re-register tools with fresh description
			// ponytail: if pi throws on duplicate tool names, skip the re-register
			try { registerTools(); } catch { /* description may be stale; non-fatal */ }
		}
	});

	pi.on("tool_execution_start", (_event, ctx) => {
		widget.setUICtx(ctx.ui as Parameters<typeof widget.setUICtx>[0]);
		widget.onTurnStart();
		widget.ensureTimer();
	});

	pi.on("session_shutdown", () => {
		for (const t of pendingNudges.values()) clearTimeout(t);
		pendingNudges.clear();
		manager.abortAll();
		manager.dispose();
		widget.dispose();
		agentActivity.clear();
		if (g[CLEANUP_KEY] === runtimeCleanup) delete g[CLEANUP_KEY];
	});

	const runtimeCleanup = () => {
		for (const t of pendingNudges.values()) clearTimeout(t);
		pendingNudges.clear();
		widget.dispose();
	};
	g[CLEANUP_KEY] = runtimeCleanup;
}
