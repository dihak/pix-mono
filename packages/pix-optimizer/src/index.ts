/**
 * pix-optimizer — token-optimization suite for Pi Coding Agent.
 *
 * Four tools, combined into one extension + one command:
 *   - caveman:  terse-output system prompt
 *   - rtk:      prefixes shell commands with `rtk` + injects RTK prompt
 *   - toon:     jq + TOON guidance for dense JSON (+ bundled skill)
 *   - ponytail: lazy-senior-dev system prompt (minimal code, YAGNI)
 *
 * They share ONE status-bar cell (󰜐 󰓥 󰗀 󰆐, all four always shown — dimmed when off, accented when on) and ONE
 * command (/optimizer — an interactive overlay). index.ts wires lifecycle hooks
 * via each module, then registers the overlay command from their handles.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { caveman } from "./caveman.ts";
import { json } from "./json.ts";
import { registerOptCommand } from "./opt.ts";
import { ponytail } from "./ponytail.ts";
import { rtk } from "./rtk.ts";
import {
	type OptimizerHandle,
	OptimizerStatus,
	type OptimizerTool,
} from "./status.ts";
import { filterModelWarnings } from "./tool-result-filter.ts";

export default function optimizer(pi: ExtensionAPI) {
	const status = new OptimizerStatus();

	// Each module registers its own lifecycle hooks and returns a handle the
	// /optimizer overlay renders + drives.
	const handles: Record<OptimizerTool, OptimizerHandle> = {
		caveman: caveman(pi, status),
		rtk: rtk(pi, status),
		toon: json(pi, status),
		ponytail: ponytail(pi, status),
	};

	registerOptCommand(pi, handles, status);

	// Strip model-guidance warnings injected by pi-lens into tool_result content.
	// These strings (BLIND WRITE, THRASHING) are directives for the LLM, not
	// information for the user — filtering them here hides them from the TUI
	// without affecting the model (it already acted on the write/edit result).
	pi.on("tool_result", async (event) => {
		const filtered = filterModelWarnings(event.content);
		if (filtered === event.content) return undefined;
		return { content: filtered };
	});
}
