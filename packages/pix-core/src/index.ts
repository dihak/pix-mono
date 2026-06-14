/**
 * pix-core — Pi extension bundle
 *
 * Layout (grouped by concern):
 *   - ui/       — welcome (π banner + health checks), footer (status bar)
 *   - commands/ — models (/models picker), update (/update self-update),
 *                 diff (/diff)
 *   - tool/     — todo (durable execution checklist),
 *                 toolbox (/toolbox command — user toggles tools on/off),
 *                 lazy (lazy tool exposure — gates schemas out of the prompt)
 *   - nudge/    — model-steering reminders (tools / capability+skills)
 *   - lib/      — shared data layer (models.dev + BenchLM)
 *
 * Depends on pix-data (github.com/xynogen/pix-data) for shared
 * models.dev + BenchLM cache at ~/.cache/pi/.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerAgentSop from "./commands/agent-sop/agent-sop.ts";
import registerClear from "./commands/clear/clear.ts";
import registerDiff from "./commands/diff/diff.ts";
import registerModels from "./commands/models/models.ts";
import registerUpdate from "./commands/update/update.ts";
import registerNudges from "./nudge/index.ts";
import registerAsk from "./tool/ask/index.ts";
import registerTodo from "./tool/todo/todo.ts";
import registerToolbox from "./tool/toolbox/toolbox.ts";
import registerDiagnostics from "./ui/diagnostics.ts";
import registerFooter from "./ui/footer.ts";
import registerWelcome from "./ui/welcome.ts";

export default function (pi: ExtensionAPI): void {
	registerAgentSop(pi);
	registerWelcome(pi);
	registerFooter(pi);
	registerDiagnostics(pi);
	registerModels(pi);
	registerUpdate(pi);
	registerDiff(pi);
	registerClear(pi);
	registerTodo(pi);
	registerAsk(pi);
	registerToolbox(pi);
	registerNudges(pi);
}
