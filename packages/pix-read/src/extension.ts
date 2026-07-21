import { CursorStore, fffState } from "@dihak/pix-pretty/fff";
import type { PiPrettyApi, TextComponentCtor, ToolFactory } from "@dihak/pix-pretty/types";
import { shortPath } from "@dihak/pix-pretty/utils";
import {
	createReadToolDefinition,
	createReadTool as createReadToolFallback,
	type ReadToolInput,
} from "@earendil-works/pi-coding-agent";

import { once } from "./once.ts";
import { registerReadTool } from "./read.js";

export default function pixReadExtension(pi: PiPrettyApi): void {
	once(pi, "pix-read", () => {
		const createReadTool = (createReadToolDefinition ??
			createReadToolFallback) as unknown as ToolFactory<ReadToolInput>;
		if (!createReadTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		registerReadTool(pi, createReadTool, {
			cwd,
			sp: (p: string) => shortPath(cwd, home, p),
			TextComponent,
			fffState,
			cursorStore: new CursorStore(),
		});
	});
}
