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

import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerAgentSop from "./commands/agent-sop/agent-sop.ts";
import registerClear from "./commands/clear/clear.ts";
import registerDiff from "./commands/diff/diff.ts";
import registerModels from "./commands/models/models.ts";
import registerUpdate from "./commands/update/update.ts";
import registerNudges from "./nudge/index.ts";
import registerDiagnostics from "./ui/diagnostics.ts";
import registerFooter from "./ui/footer.ts";
import registerWelcome from "./ui/welcome.ts";

const _req = createRequire(import.meta.url);

/** Returns true if a package is resolvable (installed). */
function isInstalled(pkg: string): boolean {
	try { _req.resolve(pkg); return true; } catch { return false; }
}

export default function (pi: ExtensionAPI): void {
	registerAgentSop(pi);
	registerWelcome(pi);
	registerFooter(pi);
	registerDiagnostics(pi);
	registerModels(pi);
	registerUpdate(pi);
	registerDiff(pi);
	registerClear(pi);
	// Only register built-in copies when the standalone packages are NOT installed.
	// When pix-todo/ask/toolbox are installed as separate Pi extensions, Pi loads
	// their own extension entries — pix-core must not register them again.
	if (!isInstalled("@xynogen/pix-todo")) {
		const { default: reg } = _req("./tool/todo/todo.js") as { default: (pi: ExtensionAPI) => void };
		reg(pi);
	}
	if (!isInstalled("@xynogen/pix-ask")) {
		const { default: reg } = _req("./tool/ask/index.js") as { default: (pi: ExtensionAPI) => void };
		reg(pi);
	}
	if (!isInstalled("@xynogen/pix-toolbox")) {
		const { default: reg } = _req("./tool/toolbox/toolbox.js") as { default: (pi: ExtensionAPI) => void };
		reg(pi);
	}
	registerNudges(pi);
}
