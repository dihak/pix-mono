/**
 * invocation-config.ts — Resolve per-call agent invocation options.
 *
 * Ported from tintinweb/pi-subagents (MIT). Trimmed: dropped isolation/joinMode.
 */

import type { AgentConfig, ThinkingLevel } from "./types.ts";

interface AgentInvocationParams {
	model?: string;
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	inherit_context?: boolean;
	isolated?: boolean;
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
	// Caller's explicit `params.model` always wins; agentConfig?.model is a
	// caller-overridable default for users who set one in .pi/agents/*.md.
	return {
		modelInput: params.model ?? agentConfig?.model,
		modelFromParams: params.model != null,
		thinking: (agentConfig?.thinking ?? params.thinking) as
			| ThinkingLevel
			| undefined,
		maxTurns: agentConfig?.maxTurns ?? params.max_turns,
		inheritContext:
			agentConfig?.inheritContext ?? params.inherit_context ?? false,
		runInBackground:
			agentConfig?.runInBackground ?? params.run_in_background ?? false,
		isolated: agentConfig?.isolated ?? params.isolated ?? false,
	};
}
