/**
 * pix-core — aggregator extension.
 *
 * Pi activates extensions per installed package via its `pi.extensions`
 * manifest; it does NOT walk npm dependencies. So a meta-package can only
 * activate its members by importing each one's extension factory and invoking
 * it against the same `pi` host.
 *
 * Every member ships a default-exported `(pi) => void` factory. We resolve them
 * by subpath import (members have no `exports` map, so the full package dir is
 * importable). One `pi install npm:@xynogen/pix-core` then boots all of them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerAsk from "@xynogen/pix-ask/src/index.ts";
import registerBash from "@xynogen/pix-bash/src/extension.ts";
import registerCommands from "@xynogen/pix-commands/src/extension.ts";
import registerData from "@xynogen/pix-data/src/index.ts";
import registerDiagnostics from "@xynogen/pix-diagnostics/src/extension.ts";
import registerDisplay from "@xynogen/pix-display/src/index.ts";
import registerEdit from "@xynogen/pix-edit/src/extension.ts";
import registerFind from "@xynogen/pix-find/src/extension.ts";
import registerFooter from "@xynogen/pix-footer/src/extension.ts";
import registerGate from "@xynogen/pix-gate/src/index.ts";
import registerGrep from "@xynogen/pix-grep/src/extension.ts";
import registerLs from "@xynogen/pix-ls/src/extension.ts";
import registerModels from "@xynogen/pix-models/src/extension.ts";
import registerNudge from "@xynogen/pix-nudge/src/extension.ts";
import registerOptimizer from "@xynogen/pix-optimizer/src/index.ts";
import registerPrompts from "@xynogen/pix-prompts/src/extension.ts";
import registerRead from "@xynogen/pix-read/src/extension.ts";
import registerSkills from "@xynogen/pix-skills/src/index.ts";
import registerSubagent from "@xynogen/pix-subagent/src/extension.ts";
import registerTodo from "@xynogen/pix-todo/src/index.ts";
import registerUpdate from "@xynogen/pix-update/src/extension.ts";
import registerWelcome from "@xynogen/pix-welcome/src/extension.ts";
import registerWrite from "@xynogen/pix-write/src/extension.ts";

// Members accept either the full `ExtensionAPI` or pix-pretty's looser
// `PiPrettyApi` view of it. `ExtensionAPI` satisfies both, so we erase the
// param type at registration and pass the real host through unchanged.
type Factory = (pi: never) => void;

const MEMBERS: Factory[] = [
	registerData,
	registerWelcome,
	registerFooter,
	registerModels,
	registerUpdate,
	registerCommands,
	registerNudge,
	registerDiagnostics,
	registerDisplay,
	registerPrompts,
	registerSkills,
	registerRead,
	registerWrite,
	registerEdit,
	registerFind,
	registerGrep,
	registerLs,
	registerBash,
	registerTodo,
	registerAsk,
	registerOptimizer,
	registerGate,
	registerSubagent,
];

export default function (pi: ExtensionAPI): void {
	for (const register of MEMBERS) {
		(register as (pi: ExtensionAPI) => void)(pi);
	}
}
