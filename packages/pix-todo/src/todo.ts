/**
 * todo.ts — durable execution checklist tool
 *
 * Extracted from the plan extension: the checklist is BUILD-phase execution
 * state that survives context compaction and session restore (persisted via
 * appendEntry("todo-state")). It is universal — other tools and workflow
 * extensions (like plan) drive it — so it lives in pix-core and registers the
 * `todo` tool. State, persistence, and restore are owned end to end here; the
 * checklist is seeded by the model via the tool's `set` action.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { once } from "./once.ts";

/** Seconds before a todo card collapses to a one-line dim summary. */
const COLLAPSE_AFTER_SEC = 10;

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export interface TodoItem {
	id: number;
	text: string;
	status: TodoStatus;
}

const TODO_GLYPH: Record<TodoStatus, string> = {
	pending: "○",
	in_progress: "◐",
	done: "●",
	blocked: "⊘",
};

/** Theme color key per status — drives both glyph and (for active) row tint. */
const TODO_COLOR: Record<TodoStatus, string> = {
	pending: "muted",
	in_progress: "accent",
	done: "success",
	blocked: "error",
};

export type TodoTheme = {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
};

/** One-line dim summary used once a card has collapsed. */
export function renderTodoSummaryLine(
	items: TodoItem[],
	theme: TodoTheme,
): string {
	if (!items.length) return theme.fg("muted", "(no todos)");
	const done = items.filter((t) => t.status === "done").length;
	return theme.fg("muted", `Todos ${done}/${items.length} done ✓`);
}

/** Colored checklist for the TUI: glyphs tinted by status, active row bold. */
export function renderTodoLines(items: TodoItem[], theme: TodoTheme): string {
	if (!items.length) return theme.fg("muted", "(no todos)");
	const done = items.filter((t) => t.status === "done").length;
	const head = theme.fg("muted", `Todos ${done}/${items.length} done:`);
	const lines = items.map((t) => {
		const color = TODO_COLOR[t.status];
		const glyph = theme.fg(color, TODO_GLYPH[t.status]);
		const body = `${t.id}. ${t.text}`;
		// Highlight the in-flight task so the eye lands on it first.
		const label =
			t.status === "in_progress"
				? theme.bold(theme.fg("accent", body))
				: theme.fg(t.status === "done" ? "muted" : "text", body);
		return `${glyph} ${label}`;
	});
	return `${head}\n${lines.join("\n")}`;
}

const parseItems = (raw: string): string[] =>
	raw
		.split("\n")
		.map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
		.filter(Boolean);

export default function registerTodo(pi: ExtensionAPI): void {
	once(pi, "pix-todo", () => {
		let todos: TodoItem[] = [];
		let nextTodoId = 1;

		function persistTodos() {
			pi.appendEntry("todo-state", { todos, nextTodoId });
		}

		function todoSummary(): string {
			if (!todos.length) return "(no todos)";
			const done = todos.filter((t) => t.status === "done").length;
			const lines = todos.map(
				(t) => `${TODO_GLYPH[t.status]} ${t.id}. ${t.text}`,
			);
			return `Todos ${done}/${todos.length} done:\n${lines.join("\n")}`;
		}

		// Durable execution checklist for BUILD mode. Survives context compaction
		// and session restore. Workflows like plan instruct the model to seed it
		// from a plan's "Implementation Phases" so it stays anchored to plan.md.
		pi.registerTool({
			name: "todo",
			label: "Todo",
			description:
				"Track BUILD-phase execution progress. Durable across context compaction. Actions: list, set (replace all items from newline/numbered text), add, update (change one item's status), clear.",
			promptSnippet:
				"todo(action, items?, id?, status?, text?) — action: list|set|add|update|clear. Use to track implementation progress, especially when executing a plan.",
			promptGuidelines: [
				"When you start executing a multi-step plan in BUILD mode, seed the todo list with `todo(action:'set', items: <plan Implementation Phases>)`.",
				"Mark each item in_progress before working it via `todo(action:'update', id, status)`; opening one auto-closes the previous in_progress item, so just open the next.",
				"Call `todo(action:'list')` to recover your place after long runs or context compaction.",
			],
			parameters: Type.Object({
				action: Type.Union(
					[
						Type.Literal("list"),
						Type.Literal("set"),
						Type.Literal("add"),
						Type.Literal("update"),
						Type.Literal("clear"),
					],
					{ description: "Operation to perform" },
				),
				items: Type.Optional(
					Type.String({
						description:
							"For set/add: newline-separated or numbered list of todo texts.",
					}),
				),
				id: Type.Optional(
					Type.Number({ description: "For update: target todo id." }),
				),
				status: Type.Optional(
					Type.Union(
						[
							Type.Literal("pending"),
							Type.Literal("in_progress"),
							Type.Literal("done"),
							Type.Literal("blocked"),
						],
						{ description: "For update: new status." },
					),
				),
				text: Type.Optional(
					Type.String({
						description: "For update: replacement text (optional).",
					}),
				),
			}),
			renderResult(_result, _options, theme, context) {
				// Snapshot this row's todos once (live `todos` mutate across calls;
				// a card should keep the state it was created with).
				const state = context.state as {
					snapshot?: TodoItem[];
					collapsed?: boolean;
					timer?: ReturnType<typeof setTimeout>;
				};
				if (!state.snapshot) state.snapshot = todos.map((t) => ({ ...t }));
				// Start the collapse timer once per row; invalidate() triggers rerender.
				if (!state.collapsed && !state.timer) {
					state.timer = setTimeout(() => {
						state.collapsed = true;
						context.invalidate();
					}, COLLAPSE_AFTER_SEC * 1000);
				}
				const render = state.collapsed
					? renderTodoSummaryLine
					: renderTodoLines;
				return new Text(render(state.snapshot, theme as TodoTheme), 0, 0);
			},

			async execute(_id, params) {
				// AgentToolResult now requires a `details` field. These todo results have
				// no structured details, so emit `undefined` via small local helpers.
				const ok = (text: string) => ({
					content: [{ type: "text" as const, text }],
					details: undefined,
				});
				const fail = (text: string) => ({
					content: [{ type: "text" as const, text }],
					details: undefined,
					isError: true,
				});
				switch (params.action) {
					case "list":
						return ok(todoSummary());

					case "set": {
						const texts = parseItems(params.items ?? "");
						if (!texts.length) return fail("set requires non-empty `items`.");
						nextTodoId = 1;
						todos = texts.map((text) => ({
							id: nextTodoId++,
							text,
							status: "pending" as TodoStatus,
						}));
						persistTodos();
						return ok(todoSummary());
					}

					case "add": {
						const texts = parseItems(params.items ?? "");
						if (!texts.length) return fail("add requires non-empty `items`.");
						for (const text of texts)
							todos.push({ id: nextTodoId++, text, status: "pending" });
						persistTodos();
						return ok(todoSummary());
					}

					case "update": {
						const t = todos.find((x) => x.id === params.id);
						if (!t) return fail(`No todo with id ${params.id}.`);
						if (params.status) {
							// Single-active invariant: opening a new task closes any other
							// in_progress one, so the checklist always shows one focus.
							if (params.status === "in_progress")
								for (const other of todos)
									if (other.id !== t.id && other.status === "in_progress")
										other.status = "done";
							t.status = params.status;
						}
						if (params.text) t.text = params.text;
						persistTodos();
						return ok(todoSummary());
					}

					case "clear":
						todos = [];
						nextTodoId = 1;
						persistTodos();
						return ok("Todos cleared.");

					default:
						return fail(`Unknown action: ${String(params.action)}`);
				}
			},
		});

		// Restore the checklist from session entries so it survives restart.
		pi.on("session_start", async (_event, ctx) => {
			const entries = ctx.sessionManager.getEntries() as Array<{
				type: string;
				customType?: string;
				data?: { todos?: TodoItem[]; nextTodoId?: number };
			}>;
			const lastTodo = entries
				.filter((e) => e.type === "custom" && e.customType === "todo-state")
				.pop();
			if (Array.isArray(lastTodo?.data?.todos)) {
				todos = lastTodo.data.todos;
				nextTodoId =
					lastTodo.data.nextTodoId ??
					todos.reduce((m, t) => Math.max(m, t.id + 1), 1);
			}
		});
	});
}
