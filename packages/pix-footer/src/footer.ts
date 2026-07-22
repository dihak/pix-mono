/**
 * Footer extension — pure-prompt style.
 *
 * Layout:
 *   [MODE] | ~/cwd (branch *±⇡n⇣n) | ⇡in ⇣out [Rcache] [ctx%/ctxk] [$cost] | model [· thinking] [· ctxK · $in/$out] [| status…] [| N t/s]
 *
 * - Branch shown with zsh-style dirty/ahead/behind markers.
 * - TPS: live during stream; decays to 0 while waiting on tools; freezes on agent_end.
 * - Model spec (ctx · cost) sourced from ~/.cache/pi/models-dev.json.
 * - Extension statuses surfaced via footerData.getExtensionStatuses();
 *   "plan" is rendered as the leftmost segment, others appended after model.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModelsDevModel } from "@dihak/pix-data";
import { benchScoreColor, lookupBenchmark, lookupModelsDev } from "@dihak/pix-data";
import { icon } from "@dihak/pix-pretty/icon-catalog";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Tween } from "./tween.ts";

// ─── Pure formatting helpers ─────────────────────────────────────────

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type Theme = {
	fg(color: string, text: string): string;
	getThinkingBorderColor(level: ThinkingLevel): (text: string) => string;
};

const THINKING_LEVELS = new Set<string>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export function renderThinkingLevel(theme: Theme, level: string, text: string): string {
	if (!THINKING_LEVELS.has(level)) return theme.fg("muted", text);
	return theme.getThinkingBorderColor(level as ThinkingLevel)(text);
}

const execFileAsync = promisify(execFile);
const GIT_POLL_MS = 2_000;

/** Compact token formatter for cumulative session totals. */
const fmtToken = (n: number): string =>
	n < 1_000
		? `${n}`
		: n < 1_000_000
			? `${(n / 1_000).toFixed(1)}K`
			: `${(n / 1_000_000).toFixed(2)}M`;

const shortCwd = (cwd: string): string => {
	const base = cwd.split("/").filter(Boolean).pop();
	return base ?? cwd;
};

function fmtCost(entry: ModelsDevModel | undefined): string {
	const costIn = entry?.cost?.input ?? 0;
	const costOut = entry?.cost?.output ?? 0;
	if (costIn === 0 && costOut === 0) return "free";
	const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.?0+$/, ""));
	return `$ ${fmt(costIn)}/${fmt(costOut)}`;
}

// ────────────────────────────────────────────────────────────────────

interface GitStatus {
	dirty: boolean;
	staged: number;
	untracked: number;
	unstaged: number;
	ahead: number;
	behind: number;
}

async function getGitStatus(cwd: string): Promise<GitStatus | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
			{ cwd, timeout: 2_000, maxBuffer: 1024 * 1024 },
		);
		let staged = 0,
			unstaged = 0,
			untracked = 0,
			ahead = 0,
			behind = 0;
		for (const line of stdout.split("\n")) {
			if (!line) continue;
			if (line.startsWith("## ")) {
				const m = line.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/);
				if (m) {
					if (m[1]) ahead = parseInt(m[1], 10);
					if (m[2]) behind = parseInt(m[2], 10);
					if (m[3]) behind = parseInt(m[3], 10);
				}
				continue;
			}
			if (line.startsWith("??")) {
				untracked += 1;
				continue;
			}
			const idx = line[0],
				wt = line[1];
			if (idx && idx !== " " && idx !== "?") staged += 1;
			if (wt && wt !== " " && wt !== "?") unstaged += 1;
		}
		return {
			dirty: unstaged + untracked > 0,
			staged,
			untracked,
			unstaged,
			ahead,
			behind,
		};
	} catch {
		return null;
	}
}

// ─── Footer segment builders ─────────────────────────────────────────

interface SessionTotals {
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
}

function computeSessionTotals(entries: Iterable<unknown>): SessionTotals {
	let input = 0,
		output = 0,
		cacheRead = 0,
		cost = 0;
	for (const e of entries as Iterable<{
		type: string;
		message?: { role: string; usage?: AssistantMessage["usage"] };
	}>) {
		if (e.type === "message" && e.message?.role === "assistant" && e.message.usage) {
			const u = e.message.usage;
			input += u.input;
			output += u.output;
			cacheRead += u.cacheRead;
			cost += u.cost.total;
		}
	}
	return { input, output, cacheRead, cost };
}

/** Tokens block (in/out). Values pre-tweened by caller. Cost rendered separately. */
function renderTokens(input: number, output: number, theme: Theme, dim = false): string {
	const s = `${icon("net.in")} ${fmtToken(input)} ${icon("net.out")} ${fmtToken(output)}`;
	return theme.fg(dim ? "dim" : "muted", s);
}

/** Cost total — always shown when > 0, independent of token-block decay. */
function renderCost(cost: number, theme: Theme): string {
	if (cost <= 0) return "";
	return theme.fg("success", `$${cost.toFixed(3)}`);
}

/** Context usage block: "used/total (pct%)". Always shown when available. */
function renderCtxUsage(
	usage: { percent?: number | null; contextWindow?: number } | undefined,
	theme: Theme,
): string {
	if (usage?.percent == null || !usage?.contextWindow) return "";
	const pct = Math.round(usage.percent);
	const used = Math.round((usage.percent / 100) * usage.contextWindow);
	const pctColor = pct >= 80 ? "error" : pct >= 50 ? "warning" : "success";
	return (
		theme.fg("muted", `${icon("tokens")}  `) +
		theme.fg("success", fmtToken(used)) +
		theme.fg("muted", `/${fmtToken(usage.contextWindow)} `) +
		theme.fg(pctColor, `(${pct}%)`)
	);
}

/** Branch + dirty/ahead/behind markers. */
function renderBranch(
	branch: string | null,
	gs: GitStatus | null,
	theme: Theme,
): { branchSeg: string; markersSeg: string } {
	if (!branch) return { branchSeg: "", markersSeg: "" };
	const dirty = gs?.dirty ?? false;
	const branchSeg = ` ${theme.fg("muted", branch) + (dirty ? theme.fg("error", "*") : "")}`;
	const markers: string[] = [];
	if (gs) {
		if (gs.staged > 0) markers.push(theme.fg("success", `+${gs.staged}`));
		if (gs.unstaged > 0) markers.push(theme.fg("error", `${icon("git.unstaged")}${gs.unstaged}`));
		if (gs.untracked > 0) markers.push(theme.fg("warning", `?${gs.untracked}`));
		if (gs.ahead > 0) markers.push(theme.fg("accent", `${icon("git.ahead")}${gs.ahead}`));
		if (gs.behind > 0) markers.push(theme.fg("accent", `${icon("git.behind")}${gs.behind}`));
	}
	return { branchSeg, markersSeg: markers.join(" ") };
}

/** "<modelId> [· thinking] [· ctxK · $in/$out]" */
function renderModel(
	model: { id?: string; provider?: string; name?: string } | undefined,
	thinking: string,
	theme: Theme,
): string {
	const rawId = model?.id ?? "?";
	const id = rawId.replace(/^[a-z]+\//i, "");
	const provider = model?.provider ?? "";
	let out = theme.fg("muted", `${icon("model")}  `) + theme.fg("accent", id);
	const THINK_ABBR: Record<string, string> = {
		minimal: "min",
		low: "low",
		medium: "med",
		high: "high",
		xhigh: "xhigh",
		off: "off",
	};
	if (thinking) {
		const abbr = THINK_ABBR[thinking] ?? thinking.slice(0, 3);
		out += theme.fg("muted", " · ") + renderThinkingLevel(theme, thinking, abbr);
	}
	if (provider && id !== "?") {
		const dev = lookupModelsDev(provider, id);
		const costStr = fmtCost(dev);
		// color the $ and numbers green, separator muted
		out += theme.fg("muted", " · ") + theme.fg("success", costStr);
	}
	const bench = lookupBenchmark(id);
	if (bench) {
		const score = bench.overallScore ?? "?";
		const scoreColor = benchScoreColor(bench.overallScore);
		out += theme.fg("muted", " · ") + theme.fg(scoreColor, `${icon("score")}${score}`);
	}
	return out;
}

/** Strip ANSI to inspect raw text, keep original colored string for output. */
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Replace verbose status text with icon + value. */
export function compactStatus(key: string, value: string, theme: Theme): string {
	const raw = stripAnsi(value);
	switch (key) {
		case "pi-lens-lsp": {
			const legacyCount = raw.match(/LSP Active \((\d+)\)/)?.[1];
			const activeList = raw.match(/LSP Active:\s*([^·]+)/)?.[1];
			const failedList = raw.match(/LSP Failed:\s*([^·]+)/)?.[1];
			const count = (list: string | undefined) =>
				list ? list.split(",").filter((id) => id.trim().length > 0).length : 0;
			const activeCount = legacyCount ? Number(legacyCount) : count(activeList);
			const failedCount = count(failedList);
			if (activeCount > 0)
				return theme.fg(
					"success",
					`${icon("lsp")}  ${activeCount}${failedCount > 0 ? ` !${failedCount}` : ""}`,
				);
			if (failedCount > 0) return theme.fg("error", `${icon("lsp")}  !${failedCount}`);
			if (/LSP Inactive/.test(raw)) return theme.fg("dim", `${icon("lsp")}  off`);
			return value;
		}
		case "mcp": {
			const m = raw.match(/(\d+)\/(\d+)\s+servers/);
			if (m) return theme.fg("muted", `${icon("mcp")} ${m[1]}/${m[2]}`);
			return value;
		}
		case "caveman": {
			const m = raw.match(/caveman level:\s*(\S+)/);
			if (m) return theme.fg("muted", `🪨 ${m[1]}`);
			return value;
		}
		default:
			return value;
	}
}

/** Pull mode out of extension statuses; return (modePart, otherParts joined). */
function renderStatuses(
	statuses: ReadonlyMap<string, string>,
	sep: string,
	theme: Theme,
): { modePart: string; otherPart: string } {
	const mode = statuses.get("plan") ?? statuses.get("phase");
	const ORDER = ["mcp", "pi-lens-lsp", "caveman"];
	const seen = new Set<string>(["plan", "phase"]);
	const others: string[] = [];
	for (const k of ORDER) {
		const v = statuses.get(k);
		seen.add(k);
		if (!v) continue;
		others.push(compactStatus(k, v, theme));
	}
	for (const [k, v] of statuses) {
		if (seen.has(k) || !v) continue;
		others.push(compactStatus(k, v, theme));
	}
	return {
		modePart: mode ? `${mode}${sep}` : "",
		otherPart: others.length ? sep + others.join(sep) : "",
	};
}

// ─── TPS: instantaneous rate + EMA ────────────────────────────────────
// Single-layer smoothing (replaces the old sliding-window + tween stack that
// double-filtered the rate and made the number lag/stick). Each tick computes
// the instantaneous Δtokens/Δt and folds it into one exponential moving
// average — a real-time speedometer with a single tunable knob.

export const TPS_TICK_MS = 100;
// alpha ∈ (0,1]: higher = snappier (twitchy on bursty tool-JSON), lower =
// smoother (more lag). At a 100ms tick, 0.25 → ~63% converge in ~0.5s,
// ~95% in ~1.2s. Flat cursor (tool wait) glides the EMA to 0, no freeze.
export const TPS_EMA_ALPHA = 0.25;

export type TpsState = { lastT: number | null; lastTokens: number; ema: number | null };

export const newTpsState = (): TpsState => ({ lastT: null, lastTokens: 0, ema: null });

/**
 * Feed the monotonic token cursor; return the smoothed rate (tokens/s).
 * Returns null on the priming tick (no prior sample to diff against). Flat
 * token totals (stall / tool wait) push inst=0, decaying the EMA toward 0.
 */
export function stepTps(
	state: TpsState,
	now: number,
	tokens: number,
	alpha: number = TPS_EMA_ALPHA,
): { state: TpsState; tps: number | null } {
	if (state.lastT == null) {
		return { state: { lastT: now, lastTokens: tokens, ema: state.ema }, tps: null };
	}
	const dt = (now - state.lastT) / 1000;
	if (dt <= 0) {
		return { state, tps: state.ema == null ? null : Math.round(state.ema) };
	}
	const inst = Math.max(0, (tokens - state.lastTokens) / dt);
	const ema = state.ema == null ? inst : state.ema + alpha * (inst - state.ema);
	return { state: { lastT: now, lastTokens: tokens, ema }, tps: Math.round(ema) };
}

/**
 * Rebase the baseline to a corrected cursor without emitting a rate.
 * Used at message_end, where the live char-estimate cursor snaps to the
 * exact API token count — that step is a measurement correction, not
 * throughput, so folding it as Δtokens/Δt would fire a huge false spike.
 * Keeps the EMA; the next real tick diffs from the corrected baseline.
 */
export function rebaseTps(state: TpsState, now: number, tokens: number): TpsState {
	return { lastT: now, lastTokens: tokens, ema: state.ema };
}

// ─── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Tokens + TPS stay visible for the whole session (no decay/clear).
	let liveTps: number | null = null;
	let requestRender: (() => void) | null = null;

	// Animated counters: displayed values ease-out toward the latest session totals.
	// Cost is scaled ×1000 into the tween so its duration math matches token units.
	const tw = { input: new Tween(), output: new Tween(), cost: new Tween() };
	let animTimer: ReturnType<typeof setInterval> | null = null;
	const stopAnim = () => {
		if (animTimer) {
			clearInterval(animTimer);
			animTimer = null;
		}
	};
	/** Point the tweens at fresh totals; start the ticker if movement is needed. */
	const animateTo = (t: SessionTotals) => {
		const now = Date.now();
		tw.input.retarget(t.input, now);
		tw.output.retarget(t.output, now);
		tw.cost.retarget(t.cost * 1000, now);
		const settled = tw.input.sample(now) && tw.output.sample(now) && tw.cost.sample(now);
		if (settled || animTimer) return;
		animTimer = setInterval(() => {
			const t2 = Date.now();
			const done = tw.input.sample(t2) && tw.output.sample(t2) && tw.cost.sample(t2);
			requestRender?.();
			if (done) stopAnim();
		}, 50);
	};

	let gitStatus: GitStatus | null = null;
	let gitTimer: ReturnType<typeof setInterval> | null = null;
	let currentCwd = "";

	// ── TPS tracking ──────────────────────────────────────────────

	interface StreamState {
		start: number;
		output: number; // exact token count (only known at message_end)
		chars: number; // streamed content chars — drives the live estimate
	}
	// Rough tokens/char for live estimation before the API reports usage.
	// ~3.7 chars/token for English+code; snapped to exact count at message_end.
	const CHARS_PER_TOKEN = 3.7;
	const liveTokens = (s: StreamState): number =>
		s.output > 0 ? s.output : Math.round(s.chars / CHARS_PER_TOKEN);
	const activeStreams = new Map<string, StreamState>();
	let tpsTicker: ReturnType<typeof setInterval> | null = null;
	// EMA rate via stepTps. Smooths bursty tool-call JSON and decays to 0 during
	// stalls / tool wait. Ticker stays up across message_end; agent_end freezes
	// the last displayed value.
	let tpsState = newTpsState();
	// Tokens from assistant messages already ended this agent turn. Keeps the TPS
	// sample series flat during tool wait (rate → 0) without zeroing the cursor
	// (which would look like a negative spike). Not folded into session totals.
	let completedStreamTokens = 0;

	/** In-flight estimate only — folded into footer token totals. */
	const liveOutput = (): number => {
		let total = 0;
		for (const s of activeStreams.values()) total += liveTokens(s);
		return total;
	};

	/** Monotonic stream progress for TPS (completed + in-flight). */
	const tpsTokenCursor = (): number => completedStreamTokens + liveOutput();

	const recomputeTps = () => {
		const now = Date.now();
		// Tool wait / stall: cursor flat → inst=0 → EMA glides to 0 (not frozen).
		const stepped = stepTps(tpsState, now, tpsTokenCursor());
		tpsState = stepped.state;
		if (stepped.tps == null) return;
		const changed = liveTps !== stepped.tps;
		liveTps = stepped.tps;
		// No tween → paint only when the displayed rate actually moves.
		if (changed) requestRender?.();
	};

	const startTpsTicker = () => {
		if (!tpsTicker) {
			// Fresh baseline only when ticker was stopped (agent_end). Mid-turn
			// restarts (next assistant message after tools) reset lastT so the
			// first tick re-primes, but the EMA carries over for continuity.
			tpsState = { ...newTpsState(), ema: tpsState.ema };
			tpsTicker = setInterval(recomputeTps, TPS_TICK_MS);
		}
	};
	const stopTpsTicker = () => {
		if (tpsTicker) {
			clearInterval(tpsTicker);
			tpsTicker = null;
		}
		tpsState = newTpsState();
	};

	// AssistantMessage.id is not in the published d.ts but exists at runtime;
	// upstream type bug, hence the casts in this section.
	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;
		type RuntimeMsg = typeof event.message & {
			id: string;
			usage?: { output?: number };
		};
		const msg = event.message as unknown as RuntimeMsg;
		activeStreams.set(msg.id, {
			start: Date.now(),
			output: 0,
			chars: 0,
		});
		startTpsTicker();
		requestRender?.();
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant") return;
		type RuntimeMsg = typeof event.message & {
			id: string;
			usage?: { output?: number };
		};
		const msg = event.message as unknown as RuntimeMsg;
		const id = msg.id;
		const s = activeStreams.get(id);
		if (!s) return;
		const ame = event.assistantMessageEvent as AssistantMessageEvent & {
			delta?: string;
			partial?: { usage?: { output?: number } };
		};
		// The API sends no token count mid-stream — accumulate content-delta chars
		// as a live estimate (text/thinking/toolcall deltas all carry `delta`).
		if (typeof ame.delta === "string") s.chars += ame.delta.length;
		const out = ame.partial?.usage?.output ?? msg.usage?.output ?? 0;
		if (out > s.output) s.output = out;
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		type RuntimeMsg = typeof event.message & {
			id: string;
			usage?: { output?: number };
		};
		const msg = event.message as unknown as RuntimeMsg;
		const id = msg.id;
		const s = activeStreams.get(id);
		const finalOut = msg.usage?.output ?? 0;
		if (s && finalOut > s.output) s.output = finalOut;
		// Move this message's tokens into the completed floor before dropping it so
		// tpsTokenCursor stays continuous (flat during tool wait → rate decays to 0).
		const endedTokens = s ? liveTokens(s) : finalOut;
		activeStreams.delete(id);
		completedStreamTokens += endedTokens;
		// The cursor just jumped from the live char-estimate to the exact API
		// count. Rebase the TPS baseline to that corrected value instead of
		// feeding it as Δtokens/Δt — otherwise the correction (est → exact) over a
		// few-ms tick fires a false multi-thousand t/s spike at end of message.
		tpsState = rebaseTps(tpsState, Date.now(), tpsTokenCursor());
		// Ticker keeps running until agent_end so tool-wait samples still tick.
	});

	pi.on("agent_end", () => {
		stopTpsTicker();
		activeStreams.clear();
		completedStreamTokens = 0;
		// Leave the final tokens + TPS on screen; no further decay.
	});

	// ── Git status polling ───────────────────────────────────────

	const refreshGit = async (cwd: string) => {
		const next = await getGitStatus(cwd);
		const changed = JSON.stringify(next) !== JSON.stringify(gitStatus);
		gitStatus = next;
		if (changed) requestRender?.();
	};

	pi.on("tool_execution_end", async (_event, ctx) => {
		await refreshGit(ctx.cwd);
	});

	// ── Footer registration ──────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		currentCwd = ctx.cwd;
		void refreshGit(currentCwd);
		if (gitTimer) clearInterval(gitTimer);
		gitTimer = setInterval(() => {
			// ponytail: currentCwd avoids capturing stale ctx after session replacement
			if (currentCwd) void refreshGit(currentCwd);
		}, GIT_POLL_MS);

		ctx.ui.setFooter((tui, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => {
				void refreshGit(ctx.cwd);
				tui.requestRender();
			});

			return {
				dispose() {
					unsub();
					requestRender = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const sep = theme.fg("muted", " | ");

					const totals = computeSessionTotals(ctx.sessionManager.getBranch());
					// Fold streamed-but-not-yet-committed output so the number moves live.
					totals.output += liveOutput();
					animateTo(totals);
					const tokens = renderTokens(
						Math.round(tw.input.value),
						Math.round(tw.output.value),
						theme,
					);
					const cost = renderCost(tw.cost.value / 1000, theme);
					const ctxUsage = renderCtxUsage(ctx.getContextUsage?.(), theme);
					const model = renderModel(ctx.model, pi.getThinkingLevel?.() ?? "", theme);
					const { branchSeg, markersSeg } = renderBranch(
						footerData.getGitBranch(),
						gitStatus,
						theme,
					);
					const { modePart, otherPart } = renderStatuses(
						footerData.getExtensionStatuses(),
						sep,
						theme,
					);

					const loc =
						theme.fg("muted", `${icon("cwd")}  `) +
						theme.fg("accent", shortCwd(ctx.cwd)) +
						branchSeg;
					const markersPart = markersSeg ? sep + markersSeg : "";
					const tpsPart = liveTps != null ? sep + theme.fg("accent", `${liveTps} t/s`) : "";

					const tokensPart = tokens ? sep + tokens : "";
					const costPart = cost ? sep + cost : "";
					const ctxPart = ctxUsage ? sep + ctxUsage : "";
					const line = `${modePart}${loc}${markersPart}${ctxPart}${sep}${model}${otherPart}${costPart}${tokensPart}${tpsPart}`;
					return [truncateToWidth(line, width)];
				},
			};
		});
	});

	pi.on("session_shutdown", () => {
		if (gitTimer) {
			clearInterval(gitTimer);
			gitTimer = null;
		}
		stopTpsTicker();
		stopAnim();
	});
}
