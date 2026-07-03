import {
	createFindToolDefinition,
	createFindTool as createFindToolFallback,
	type FindToolInput,
} from "@earendil-works/pi-coding-agent";
import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type { PiPrettyApi, TextComponentCtor, ToolFactory } from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerFindTool } from "./find.js";
import { once } from "./once.ts";

export default function pixFindExtension(pi: PiPrettyApi): void {
	once(pi, "pix-find", () => {
		const createFindTool = (createFindToolDefinition ??
			createFindToolFallback) as unknown as ToolFactory<FindToolInput>;
		if (!createFindTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		registerFindTool(pi, createFindTool, {
			cwd,
			sp: (p: string) => shortPath(cwd, home, p),
			TextComponent,
			fffState,
			cursorStore: new CursorStore(),
		});
	});
}
