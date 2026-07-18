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
 * @param expanded — whether the host currently requests the detailed view
 * @returns `true` if the card is currently collapsed and not expanded
 */
export function tickCollapse(
	toolName: string,
	state: CollapseState,
	invalidate: () => void,
	expanded = false,
): boolean {
	if (!shouldCollapse(toolName)) return false;
	if (!state.timer && !state.collapsed) {
		state.timer = setTimeout(() => {
			state.collapsed = true;
			invalidate();
		}, collapseDelayMs());
	}
	return state.collapsed === true && !expanded;
}
