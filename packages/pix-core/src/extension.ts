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
 * importable). One `pi install npm:@dihak/pix-core` then boots all of them.
 */

import registerAsk from "@dihak/pix-ask/src/index.ts";
import registerBash from "@dihak/pix-bash/src/extension.ts";
import registerCommands from "@dihak/pix-commands/src/extension.ts";
import registerData from "@dihak/pix-data/src/index.ts";
import registerDiagnostics from "@dihak/pix-diagnostics/src/extension.ts";
import registerDisplay from "@dihak/pix-display/src/index.ts";
import registerEdit from "@dihak/pix-edit/src/extension.ts";
import registerFind from "@dihak/pix-find/src/extension.ts";
import registerFooter from "@dihak/pix-footer/src/extension.ts";
import registerGate from "@dihak/pix-gate/src/index.ts";
import registerGrep from "@dihak/pix-grep/src/extension.ts";
import registerLs from "@dihak/pix-ls/src/extension.ts";
import registerModels from "@dihak/pix-models/src/extension.ts";
import registerNudge from "@dihak/pix-nudge/src/extension.ts";
import registerOptimizer from "@dihak/pix-optimizer/src/index.ts";
import registerPretty from "@dihak/pix-pretty";
import registerPrompts from "@dihak/pix-prompts/src/extension.ts";
import registerRead from "@dihak/pix-read/src/extension.ts";
import registerSkills from "@dihak/pix-skills/src/index.ts";
import registerSubagent from "@dihak/pix-subagent/src/extension.ts";
import registerTodo from "@dihak/pix-todo/src/index.ts";
import registerTodoAuto from "@dihak/pix-todo-auto/src/index.ts";
import registerUpdate from "@dihak/pix-update/src/extension.ts";
import registerWelcome from "@dihak/pix-welcome/src/extension.ts";
import registerWrite from "@dihak/pix-write/src/extension.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Members accept either the full `ExtensionAPI` or pix-pretty's looser
// `PiPrettyApi` view of it. `ExtensionAPI` satisfies both, so we erase the
// param type at registration and pass the real host through unchanged.
type Factory = (pi: never) => void;

const MEMBERS: Factory[] = [
	// pix-data warms model caches and registers the /pix settings command.
	registerData,
	// pix-pretty seeds the global icon mode (initIconMode) and registers
	// FFF commands. It must run before icon() consumers (footer,
	// display, models, welcome, optimizer) so the mode is set when they paint.
	registerPretty,
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
	registerTodoAuto,
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
