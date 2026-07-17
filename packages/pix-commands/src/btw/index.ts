import type {
	AgentSession,
	ExtensionAPI,
	ExtensionCommandContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { type BtwMessageDetails, registerBtwRenderer } from "./render.ts";
import { runBtw, snapshotMainSettings } from "./session.ts";

const STATUS_KEY = "pix-btw";
const WIDGET_KEY = "pix-btw-live";

interface BtwJob {
	id: number;
	question: string;
	model: string;
	startedAt: number;
	status: "running" | "completed" | "error" | "stopped";
	text: string;
	activeTools: Set<string>;
	toolUses: number;
	session?: AgentSession;
	error?: string;
}

export function shortModelName(model: { name?: string; id: string }): string {
	return model.name?.trim() || model.id;
}

export function summarizeLiveText(text: string, max = 100): string {
	const first = text.replace(/\s+/g, " ").trim();
	if (!first) return "thinking…";
	return first.length > max ? `${first.slice(0, Math.max(1, max - 1))}…` : first;
}

/** Keep rendered BTW cards out of every agent's LLM conversation context. */
export function filterBtwMessages<T>(messages: T[]): T[] {
	return messages.filter((message) => {
		const candidate = message as { role?: string; customType?: string };
		return !(candidate.role === "custom" && candidate.customType === "pix-btw-answer");
	});
}

export function registerBtw(pi: ExtensionAPI): void {
	registerBtwRenderer(pi);

	const jobs = new Map<number, BtwJob>();
	let nextId = 1;
	let latestUi: ExtensionCommandContext["ui"] | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;

	const renderJobs = (theme: Theme): string[] => {
		const running = [...jobs.values()].filter((job) => job.status === "running");
		if (running.length === 0) return [];
		const lines = [theme.fg("accent", `○ BTW (${running.length})`)];
		for (const job of running.slice(-4)) {
			const elapsed = ((Date.now() - job.startedAt) / 1_000).toFixed(1);
			const activity =
				job.activeTools.size > 0
					? [...job.activeTools].map((name) => `using ${name}`).join(", ")
					: summarizeLiveText(job.text);
			lines.push(theme.fg("dim", `└─ #${job.id} [${job.model}] · ${elapsed}s · ${activity}`));
		}
		return lines;
	};

	const updateUi = () => {
		if (!latestUi) return;
		const running = [...jobs.values()].filter((job) => job.status === "running");
		if (running.length === 0) {
			latestUi.setStatus(STATUS_KEY, undefined);
			latestUi.setWidget(WIDGET_KEY, undefined);
			if (refreshTimer) clearInterval(refreshTimer);
			refreshTimer = undefined;
			return;
		}
		latestUi.setStatus(STATUS_KEY, `BTW ${running.length}`);
		latestUi.setWidget(
			WIDGET_KEY,
			(tui: TUI, theme: Theme) => {
				const text = new Text("", 0, 0);
				return {
					render: (width: number) => {
						text.setText(renderJobs(theme).join("\n"));
						return text.render(width || tui.terminal.columns);
					},
					invalidate: () => text.invalidate(),
				};
			},
			{ placement: "aboveEditor" },
		);
		refreshTimer ??= setInterval(updateUi, 100);
	};

	const publish = async (job: BtwJob, details: BtwMessageDetails, ctx: ExtensionCommandContext) => {
		job.session?.dispose();
		job.session = undefined;
		updateUi();

		// Sending a custom message while the main agent streams would enqueue it
		// as a steer and leak the side answer into the in-flight task. Surface the
		// result immediately as a UI notification, then wait to append the durable
		// rendered transcript card until the main agent is idle.
		if (!ctx.isIdle()) {
			ctx.ui.notify(
				details.error
					? `BTW #${job.id} failed: ${details.error}`
					: `BTW #${job.id} complete\n\n${details.answer}`,
				details.error ? "error" : "info",
			);
			await ctx.waitForIdle();
		}

		pi.sendMessage<BtwMessageDetails>({
			customType: "pix-btw-answer",
			content: details.error
				? `BTW question failed: ${details.error}`
				: `BTW answer to “${details.question}”:\n\n${details.answer}`,
			display: true,
			details,
		});
	};

	pi.on("context", (event) => ({ messages: filterBtwMessages(event.messages) }));

	pi.registerCommand("btw", {
		description: "Ask an isolated side question without interrupting the main agent",
		handler: async (rawArgs, ctx) => {
			const question = rawArgs.trim();
			latestUi = ctx.ui;
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}

			let snapshot: ReturnType<typeof snapshotMainSettings>;
			try {
				snapshot = snapshotMainSettings(ctx, pi.getThinkingLevel(), pi.getActiveTools());
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			const id = nextId++;
			const job: BtwJob = {
				id,
				question,
				model: shortModelName(snapshot.model),
				startedAt: Date.now(),
				status: "running",
				text: "",
				activeTools: new Set(),
				toolUses: 0,
			};
			jobs.set(id, job);
			updateUi();
			ctx.ui.notify(`BTW #${id} started — the main agent will keep running.`, "info");

			void runBtw({
				question,
				snapshot,
				ctx,
				onSession: (session) => {
					job.session = session;
				},
				onTextDelta: (_delta, fullText) => {
					job.text = fullText;
				},
				onToolStart: (name) => {
					job.activeTools.add(name);
				},
				onToolEnd: (name) => {
					job.activeTools.delete(name);
					job.toolUses++;
				},
			})
				.then(({ text, session }) => {
					job.status = "completed";
					job.text = text;
					job.session = session;
					void publish(
						job,
						{
							question,
							answer: text || "No answer returned.",
							model: job.model,
							thinkingLevel: snapshot.thinkingLevel,
							durationMs: Date.now() - job.startedAt,
							toolUses: job.toolUses,
						},
						ctx,
					).catch(() => {});
				})
				.catch((error) => {
					job.status = "error";
					job.error = error instanceof Error ? error.message : String(error);
					void publish(
						job,
						{
							question,
							answer: "",
							model: job.model,
							thinkingLevel: snapshot.thinkingLevel,
							durationMs: Date.now() - job.startedAt,
							toolUses: job.toolUses,
							error: job.error,
						},
						ctx,
					).catch(() => {});
				});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		latestUi = ctx.ui;
		updateUi();
	});

	pi.on("session_shutdown", () => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		latestUi?.setStatus(STATUS_KEY, undefined);
		latestUi?.setWidget(WIDGET_KEY, undefined);
		for (const job of jobs.values()) {
			if (job.status === "running") {
				job.status = "stopped";
				void job.session?.abort();
			}
			job.session?.dispose();
		}
		jobs.clear();
	});
}
