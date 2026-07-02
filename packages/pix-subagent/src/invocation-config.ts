/**
 * invocation-config.ts — Resolve per-call agent invocation options.
 *
 * Precedence is uniform across ALL fields:
 *   explicit call param  >  agent config default  >  global default
 *
 * Ported from tintinweb/pi-subagents (MIT). Trimmed: dropped isolation/joinMode.
 */

import type { AgentConfig, ThinkingLevel } from "./types.ts";

interface AgentInvocationParams {
	model?: string;
	thinking?: string;
	/** Max turns — new short key. */
	turns?: number;
	/** Background flag — new short key. */
	background?: boolean;
	inherit_context?: boolean;
	isolated?: boolean;
	// Legacy spellings — kept so older callers / persisted invocations still resolve.
	max_turns?: number;
	run_in_background?: boolean;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	modelInput?: string;
	modelFromParams: boolean;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	inheritContext: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	// Uniform precedence: caller params always win, config values are defaults.
	// The tool schema advertises these params unconditionally, so the LLM's
	// explicit choices must never be silently overridden by config.
	return {
		modelInput: params.model ?? agentConfig?.model,
		modelFromParams: params.model != null,
		thinking: (params.thinking ?? agentConfig?.thinking) as
			| ThinkingLevel
			| undefined,
		maxTurns: params.turns ?? params.max_turns ?? agentConfig?.maxTurns,
		inheritContext:
			params.inherit_context ?? agentConfig?.inheritContext ?? false,
		runInBackground:
			params.background ??
			params.run_in_background ??
			agentConfig?.runInBackground ??
			false,
		isolated: params.isolated ?? agentConfig?.isolated ?? false,
	};
}
