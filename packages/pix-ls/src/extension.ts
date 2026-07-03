import {
	createLsToolDefinition,
	createLsTool as createLsToolFallback,
	type LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type { PiPrettyApi, TextComponentCtor, ToolFactory } from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerLsTool } from "./ls.js";
import { once } from "./once.ts";

export default function pixLsExtension(pi: PiPrettyApi): void {
	once(pi, "pix-ls", () => {
		const createLsTool = (createLsToolDefinition ??
			createLsToolFallback) as unknown as ToolFactory<LsToolInput>;
		if (!createLsTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		registerLsTool(pi, createLsTool, {
			cwd,
			sp: (p: string) => shortPath(cwd, home, p),
			TextComponent,
			fffState,
			cursorStore: new CursorStore(),
		});
	});
}
