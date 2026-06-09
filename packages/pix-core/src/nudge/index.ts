/**
 * nudge/ — model-steering reminders, wired by one registerNudges(pi).
 *
 *   - tools      — block raw bash that stands in for a native tool (reactive,
 *                  per tool_call, once per category). See tools.ts.
 *   - capability — full-toolbelt one-liner + dynamic skill-name list on every
 *                  prompt (one hidden message). See capability.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerCapabilityNudge from "./capability.ts";
import registerToolsNudge from "./tools.ts";

export default function registerNudges(pi: ExtensionAPI): void {
	registerToolsNudge(pi);
	registerCapabilityNudge(pi);
}
