/** usage.ts — Token usage: shapes, accumulator operators, session-stats readers. */

/**
 * Lifetime usage components, accumulated via `message_end` events. Survives
 * compaction (which replaces session.state.messages and would reset any
 * stats-derived sum). cacheRead is excluded because each turn's cacheRead is
 * the cumulative cached prefix re-read on that one call — summing across
 * turns counts the prefix N times. See issue #38.
 */
export type LifetimeUsage = {
	input: number;
	output: number;
	cacheWrite: number;
};

/** Sum of lifetime usage components, or 0 if undefined. */
export function getLifetimeTotal(u?: LifetimeUsage): number {
	return u ? u.input + u.output + u.cacheWrite : 0;
}

/** Add a usage delta into a target accumulator (mutates target). */
export function addUsage(into: LifetimeUsage, delta: LifetimeUsage): void {
	into.input += delta.input;
	into.output += delta.output;
	into.cacheWrite += delta.cacheWrite;
}

/** Minimal shape we read from upstream `getSessionStats()`. */
export type SessionStatsLike = {
	tokens: { input: number; output: number; cacheWrite: number };
	contextUsage?: { tokens?: number | null; contextWindow?: number; percent: number | null };
};
export type SessionLike = { getSessionStats(): SessionStatsLike };

/** Context usage snapshot: estimated used tokens, window size, percent. */
export type ContextUsageLike = {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
};

/** Full context usage, or null when unavailable. */
export function getSessionContextUsage(session: SessionLike | undefined): ContextUsageLike | null {
	if (!session) return null;
	try {
		const cu = session.getSessionStats().contextUsage;
		if (!cu) return null;
		return {
			tokens: cu.tokens ?? null,
			contextWindow: cu.contextWindow ?? null,
			percent: cu.percent ?? null,
		};
	} catch {
		return null;
	}
}

/**
 * Context-window utilization (0–100), or null when unavailable
 * (no model contextWindow, or post-compaction before the next response).
 */
export function getSessionContextPercent(session: SessionLike | undefined): number | null {
	return getSessionContextUsage(session)?.percent ?? null;
}
