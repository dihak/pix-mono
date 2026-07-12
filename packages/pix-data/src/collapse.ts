/**
 * collapse.ts — auto-collapse helper for tool renderResult cards.
 *
 * Provides a timer-based collapse mechanism: show full output for N seconds,
 * then collapse to a one-line dim summary. Each tool call gets its own card
 * with its own timer, so the latest call stays expanded while older ones fold.
 *
 * Configuration is read from ~/.pi/agent/pix.json via pix-config.
 */

import { collapseDelayMs, shouldCollapse } from "./pix-config.js";

export interface CollapseState {
	collapsed?: boolean;
	timer?: ReturnType<typeof setTimeout>;
}

/**
 * Run the collapse timer for a tool card. Call this inside `renderResult`.
 *
 * @param toolName — the tool name (e.g. "bash", "read") for per-tool config
 * @param state    — the render context's `state` bag (mutable, per-card)
 * @param invalidate — `context.invalidate()` to trigger re-render
 * @returns `true` if the card is currently collapsed
 */
export function tickCollapse(
	toolName: string,
	state: CollapseState,
	invalidate: () => void,
): boolean {
	if (!shouldCollapse(toolName)) return false;
	if (state.collapsed) return true;
	if (!state.timer) {
		state.timer = setTimeout(() => {
			state.collapsed = true;
			invalidate();
		}, collapseDelayMs());
	}
	return false;
}
