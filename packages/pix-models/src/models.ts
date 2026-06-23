/**
 * models.ts — enhanced /models command with benchlm rank + score
 *
 * Replaces (or supplements) the built-in /model selector by registering
 * /models (plural). Each row shows:
 *   <name>  <provider> · <ctx> · <cost> · 🏅 #rank score
 *
 * Sorted by benchlm rank when available (best first), then alphabetical.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	Input,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	benchScoreColor,
	lookupBenchmark,
	lookupModelsDev,
} from "@xynogen/pix-data";
import { patchOutBuiltinModelCommand } from "./patch-builtin";

// ─── Pure logic (exported for tests) ─────────────────────────────────────────

export function fmtCtx(n: number): string {
	if (!n || n < 1_000) return `${n}`;
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")}M`;
	}
	return `${Math.round(n / 1_000)}k`;
}

export function fmtCost(
	entry: { cost?: { input?: number; output?: number } } | undefined,
): string {
	if (!entry?.cost) return "\u2014";
	const i = entry.cost.input ?? 0;
	const o = entry.cost.output ?? 0;
	if (i === 0 && o === 0) return "free";
	return `${i.toFixed(2)}/${o.toFixed(2)}`;
}

export function benchStars(score: number | null | undefined): {
	filled: number;
	empty: number;
} {
	const total = 5;
	let filled = 1;
	if (typeof score === "number") {
		if (score >= 90) filled = 5;
		else if (score >= 80) filled = 4;
		else if (score >= 70) filled = 3;
		else if (score >= 50) filled = 2;
	}
	return { filled, empty: total - filled };
}

export type SortableModel = {
	provider: string;
	id: string;
	name?: string;
	score?: number | null;
};

export function sortModels<T extends SortableModel>(models: T[]): T[] {
	return [...models].sort((a, b) => {
		const sa = a.score ?? -1;
		const sb = b.score ?? -1;
		if (sa !== sb) return sb - sa;
		return (a.name ?? a.id).localeCompare(b.name ?? b.id);
	});
}

async function showEnhancedPicker(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	// Mirror the built-in /model selector, which calls refresh() then awaits
	// getAvailable() (see model-selector.js). Without refresh(), this extension
	// reads whatever `this.models` was last loaded into — which, depending on
	// extension load order vs oauth/auth resolution, can omit oauth providers
	// whose models were registered as built-ins but resolved after the last
	// load (notably `openai-codex`). 9router survives because it's registered
	// as a custom provider with an env-key apiKey. refresh() rebuilds the model
	// list (resetOAuthProviders → loadModels → re-apply registered providers)
	// so oauth-backed codex models reappear, exactly as the built-in does.
	//
	// The public ExtensionContext type narrows modelRegistry to a sync
	// getAvailable() only; at runtime ctx.modelRegistry is the full
	// ModelRegistry instance (verified in runner.js) with refresh() and an
	// async-capable getAvailable(). Reach through the narrowed type.
	type AvailableModels = ReturnType<typeof ctx.modelRegistry.getAvailable>;
	const registry = ctx.modelRegistry as unknown as {
		refresh?: () => void;
		getAvailable(): AvailableModels | Promise<AvailableModels>;
	};
	registry.refresh?.();
	const available = await registry.getAvailable();
	if (available.length === 0) {
		ctx.ui.notify("No models with configured auth.", "warning");
		return;
	}

	const current = ctx.model;

	// Build items with benchmark data
	type Row = {
		m: (typeof available)[number];
		dev: ReturnType<typeof lookupModelsDev>;
		bench: ReturnType<typeof lookupBenchmark>;
		// Rank among the user's *available* models, not the global catalog.
		localRank: number | null;
	};
	const rows: Row[] = available.map((m) => ({
		m,
		dev: lookupModelsDev(m.provider, m.id),
		bench: lookupBenchmark(m.id),
		localRank: null,
	}));

	// Sort: by score desc (highest first), unscored last alphabetical
	rows.sort((a, b) => {
		const sa = a.bench?.overallScore ?? -1;
		const sb = b.bench?.overallScore ?? -1;
		if (sa !== sb) return sb - sa;
		return (a.m.name ?? a.m.id).localeCompare(b.m.name ?? b.m.id);
	});

	// Local rank = position among scored available models (best pickable = #1).
	let localRank = 0;
	for (const r of rows) if (r.bench) r.localRank = ++localRank;

	// Show all models (no deduplication)
	const dedupedRows = rows;

	// items built inside the custom() factory so we have theme access for colors

	const result = await ctx.ui.custom<string | null>(
		(_tui, theme, _kb, done) => {
			const container = new Container();
			const accent = "accent";

			// Find max rank width across all benchmarked rows for # padding
			const maxRankWidth = Math.max(
				...dedupedRows.map((r) =>
					r.localRank ? String(r.localRank).length : 0,
				),
				1,
			);

			// Mute low-info parts (separators, padding, #, ☆) so the actual values pop.
			const mute = (s: string) => theme.fg("muted", s);
			const sep = mute(" · ");

			// Track rank per item value so fuzzy results can prioritize ranked models.
			const rankByValue = new Map<string, number>();
			for (const { m, localRank } of dedupedRows) {
				if (localRank) rankByValue.set(`${m.provider}/${m.id}`, localRank);
			}

			const items: SelectItem[] = dedupedRows.map(
				({ m, dev, bench, localRank }) => {
					const isCurrent =
						current && m.provider === current.provider && m.id === current.id;

					// Label: marker + muted '#' + bright rank + accent-colored model name
					const marker = isCurrent ? theme.fg(accent, "▶") : " ";
					let rankPrefix: string;
					if (localRank) {
						const rankStr = String(localRank).padEnd(maxRankWidth);
						// Color rank by the model's bench score (same scale as ⚡score),
						// not by list position — keeps the two colors consistent.
						const rankColor = benchScoreColor(bench?.overallScore);
						rankPrefix = mute("#") + theme.fg(rankColor, rankStr);
					} else {
						rankPrefix = " ".repeat(maxRankWidth + 1);
					}
					// Display model id only; m.provider is routing provider, not part of id.
					const idColored = theme.fg(accent, m.id);
					const label = `${marker} ${rankPrefix} ${idColored}`;

					// Description: ctx · cost · score stars
					// Colors: ctx muted · cost success (free muted) · score+stars warning
					const ctxRaw = fmtCtx(dev?.limit?.context ?? 0);
					const ctxStr = mute(ctxRaw.padStart(4));
					const rawCost = fmtCost(dev);
					let costSeg: string;
					if (rawCost === "—") {
						costSeg = theme.fg("dim", "—".padEnd(10));
					} else if (rawCost === "free") {
						costSeg = mute("free".padEnd(10));
					} else {
						costSeg = theme.fg("success", rawCost.padEnd(10));
					}
					let benchSeg = "";
					if (bench) {
						const score = bench.overallScore ?? "?";
						const s = bench.overallScore;
						const scoreColor = benchScoreColor(s);
						let filled = 1;
						if (typeof s === "number") {
							if (s >= 90) filled = 5;
							else if (s >= 80) filled = 4;
							else if (s >= 70) filled = 3;
							else if (s >= 50) filled = 2;
						}
						const starBar =
							theme.fg(scoreColor, "★".repeat(filled)) +
							mute("☆".repeat(5 - filled));
						benchSeg = `⚡${theme.fg(scoreColor, String(score))} ${starBar}`;
					}
					const desc = [ctxStr, costSeg, benchSeg].filter(Boolean).join(sep);

					return {
						value: `${m.provider}/${m.id}`,
						label,
						description: desc,
					};
				},
			);

			const currentIdx = current
				? items.findIndex(
						(it) => it.value === `${current.provider}/${current.id}`,
					)
				: 0;

			container.addChild(new DynamicBorder((s) => theme.fg(accent, s)));
			container.addChild(
				new Text(theme.fg(accent, theme.bold("󰚩  Select model"))),
			);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"context · pricing · coding rank & score from modelgrep.com",
					),
				),
			);

			// Widest label (visible width, ANSI-stripped) so the model name
			// column never truncates to "…". Add gap headroom.
			const widestLabel = items.reduce(
				(w, it) => Math.max(w, visibleWidth(it.label)),
				0,
			);

			const search = new Input();
			const list = new SelectList(
				items,
				Math.min(items.length, 14),
				{
					selectedPrefix: (t) => theme.fg(accent, t),
					selectedText: (t) => theme.fg(accent, t),
					description: (t) => t, // raw — per-segment colors set in items.map
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				},
				{
					minPrimaryColumnWidth: widestLabel + 2,
					maxPrimaryColumnWidth: widestLabel + 2,
				},
			);
			if (currentIdx >= 0) list.setSelectedIndex(currentIdx);

			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
			search.onEscape = () => done(null);

			const applyFuzzy = (query: string) => {
				const internal = list as unknown as {
					items: SelectItem[];
					filteredItems: SelectItem[];
					selectedIndex: number;
					invalidate(): void;
				};
				const q = query.trim();
				let next: SelectItem[];
				if (q.length === 0) {
					next = internal.items;
				} else if (/^\d+$/.test(q)) {
					// Pure number → match by benchlm rank, not name.
					const wanted = Number(q);
					next = internal.items.filter(
						(it) => rankByValue.get(it.value) === wanted,
					);
				} else {
					next = fuzzyFilter(
						internal.items,
						q,
						(it) => `${it.label} ${it.description ?? ""}`,
					);
					// Stable sort: ranked models (by rank asc) before unranked.
					next = next
						.map((it, i) => ({ it, i }))
						.sort((a, b) => {
							const ra = rankByValue.get(a.it.value) ?? Infinity;
							const rb = rankByValue.get(b.it.value) ?? Infinity;
							if (ra !== rb) return ra - rb;
							return a.i - b.i;
						})
						.map(({ it }) => it);
				}
				internal.filteredItems = next;
				internal.selectedIndex = 0;
				internal.invalidate();
			};

			container.addChild(new Text(theme.fg("muted", "Search:")));
			container.addChild(search);
			container.addChild(list);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"fuzzy search · ↑↓ navigate · enter select · esc cancel",
					),
				),
			);
			container.addChild(new DynamicBorder((s) => theme.fg(accent, s)));

			return {
				render(w: number) {
					return container.render(w);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					// Detect keys via pi-tui's own parser — the same recognition
					// SelectList uses. Arrows arrive as named keys ("up"/"down"),
					// not raw escape sequences, so string-equality checks fail.
					const isNav = matchesKey(data, "up") || matchesKey(data, "down");
					if (isNav || matchesKey(data, "enter")) {
						list.handleInput?.(data);
					} else if (matchesKey(data, "escape")) {
						done(null);
					} else {
						search.handleInput?.(data);
						applyFuzzy(search.getValue?.() ?? "");
					}
					container.invalidate();
				},
			};
		},
	);

	if (!result) return;

	// Apply selection
	const [provider, ...rest] = result.split("/");
	const id = rest.join("/");
	const picked = available.find((m) => m.provider === provider && m.id === id);
	if (!picked) {
		ctx.ui.notify(`Model not found: ${result}`, "error");
		return;
	}
	const ok = await pi.setModel(picked);
	if (ok) ctx.ui.notify(`Switched to ${picked.name ?? picked.id}`, "info");
	else ctx.ui.notify(`Failed to switch to ${picked.id}`, "error");
}

export default function modelPickerExtension(pi: ExtensionAPI) {
	// Remove Pi's built-in /model so only the enhanced /models picker remains.
	// Self-healing: re-applies on every load, so a Pi upgrade can't restore it.
	patchOutBuiltinModelCommand();

	const handler = async (_args: unknown, ctx: ExtensionContext) => {
		await showEnhancedPicker(pi, ctx);
	};
	pi.registerCommand("models", {
		description: "Enhanced model picker — shows benchlm rank + score",
		handler,
	});
}
