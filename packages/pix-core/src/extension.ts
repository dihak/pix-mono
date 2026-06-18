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
import registerCommands from "@xynogen/pix-commands/src/extension.ts";
import registerDiagnostics from "@xynogen/pix-diagnostics/src/extension.ts";
import registerFooter from "@xynogen/pix-footer/src/extension.ts";
import registerModels from "@xynogen/pix-models/src/extension.ts";
import registerNudge from "@xynogen/pix-nudge/src/extension.ts";
import registerPrompts from "@xynogen/pix-prompts/src/extension.ts";
import registerSkills from "@xynogen/pix-skills/src/index.ts";
import registerUpdate from "@xynogen/pix-update/src/extension.ts";
import registerWelcome from "@xynogen/pix-welcome/src/extension.ts";

type Factory = (pi: ExtensionAPI) => void;

const MEMBERS: Factory[] = [
	registerWelcome,
	registerFooter,
	registerModels,
	registerUpdate,
	registerCommands,
	registerNudge,
	registerDiagnostics,
	registerPrompts,
	registerSkills,
];

export default function (pi: ExtensionAPI): void {
	for (const register of MEMBERS) {
		register(pi);
	}
}
