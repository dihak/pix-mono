// pix-todo-auto — nudge the agent to continue while pix-todo items remain
// unfinished. Reuses pix-todo's persisted "todo-state" (no new tool).
// Toggle with /todo-auto.

import type { TodoItem } from "@dihak/pix-todo";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_STALLED_CONTINUES = 3;

export type AutoDecision =
	| { action: "continue"; remaining: TodoItem[] }
	| { action: "stop"; reason: "empty" | "done" | "blocked" | "stall" };

export function decideAutoContinue(
	todos: TodoItem[],
	prevSig: string | undefined,
	stalled: number,
	max = MAX_STALLED_CONTINUES,
): { decision: AutoDecision; sig: string; stalled: number } {
	const sig = todos.map((t) => `${t.id}:${t.status}`).join(",");
	if (todos.length === 0) return { decision: { action: "stop", reason: "empty" }, sig, stalled: 0 };
	if (todos.some((t) => t.status === "blocked"))
		return { decision: { action: "stop", reason: "blocked" }, sig, stalled: 0 };
	const remaining = todos.filter((t) => t.status === "pending" || t.status === "in_progress");
	if (remaining.length === 0)
		return { decision: { action: "stop", reason: "done" }, sig, stalled: 0 };
	const nextStalled = prevSig !== undefined && sig === prevSig ? stalled + 1 : 0;
	if (nextStalled >= max)
		return { decision: { action: "stop", reason: "stall" }, sig, stalled: nextStalled };
	return { decision: { action: "continue", remaining }, sig, stalled: nextStalled };
}

// Esc sets stopReason "aborted" on the last assistant message.
export function wasUserAborted(messages: unknown): boolean {
	if (!Array.isArray(messages)) return false;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; stopReason?: string } | undefined;
		if (m?.role === "assistant") return m.stopReason === "aborted";
	}
	return false;
}

export default function register(pi: ExtensionAPI): void {
	let autoEnabled = true;
	let stalled = 0;
	let lastSig: string | undefined;
	let userAborted = false;

	pi.on("agent_end", (event) => {
		if (wasUserAborted((event as { messages?: unknown })?.messages)) userAborted = true;
	});

	// "agent_settled" fires once Pi will not continue on its own. It is missing
	// from ExtensionAPI's event union in older Pi typings, so register via a cast.
	type SettledCtx = {
		hasUI?: boolean;
		isIdle?: () => boolean;
		hasPendingMessages?: () => boolean;
		sessionManager?: { getEntries?: () => unknown[] };
		ui: { notify: (msg: string, level: string) => void };
	};
	(pi.on as (event: string, cb: (e: unknown, ctx: SettledCtx) => void) => void)(
		"agent_settled",
		async (_event, ctx) => {
			if (!autoEnabled) return;
			if (!ctx.hasUI) return;
			if (!ctx.isIdle?.()) return;
			if (ctx.hasPendingMessages?.()) return;

			if (userAborted) {
				userAborted = false;
				return;
			}

			const entries = (ctx.sessionManager?.getEntries?.() ?? []) as Array<{
				type: string;
				customType?: string;
				data?: { todos?: TodoItem[] };
			}>;
			const last = entries
				.filter((e) => e.type === "custom" && e.customType === "todo-state")
				.pop();
			const todos = Array.isArray(last?.data?.todos) ? last.data.todos : [];

			const { decision, sig, stalled: nextStalled } = decideAutoContinue(todos, lastSig, stalled);
			stalled = nextStalled;

			if (decision.action === "stop") {
				if (decision.reason === "blocked") {
					const b = todos.filter((t) => t.status === "blocked").map((t) => t.text);
					ctx.ui.notify(`Todo blocked: ${b.join("; ")}`, "warning");
				} else if (decision.reason === "stall") {
					ctx.ui.notify(
						`Todo auto-continue paused: no progress after ${MAX_STALLED_CONTINUES} tries. Type to resume.`,
						"warning",
					);
				}
				return;
			}

			lastSig = sig;
			const list = decision.remaining.map((t) => `- ${t.id}: ${t.text} (${t.status})`).join("\n");
			pi.sendUserMessage(
				"You stopped with unfinished todos:\n" +
					`${list}\n\n` +
					"Continue with the next pending item. Update statuses with `todo(action:'update', id, status)` as you go. " +
					"Mark an item done only after its work is verified. When all items are done, stop. " +
					"If you cannot proceed, mark the item blocked with `todo(action:'update', id, status:'blocked')`.",
			);
		},
	);

	pi.registerCommand("todo-auto", {
		description: "Toggle todo auto-continue on/off",
		handler: async (_args, ctx) => {
			autoEnabled = !autoEnabled;
			stalled = 0;
			lastSig = undefined;
			ctx.ui.notify(`Todo auto-continue ${autoEnabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
