import { CursorStore, fffState } from "@dihak/pix-pretty/fff";
import { attachResizeListener, trackInvalidator } from "@dihak/pix-pretty/resize";
import type { PiPrettyApi, TextComponentCtor, ToolFactory } from "@dihak/pix-pretty/types";
import { shortPath } from "@dihak/pix-pretty/utils";
import {
	createWriteToolDefinition,
	createWriteTool as createWriteToolFallback,
	type WriteToolInput,
} from "@earendil-works/pi-coding-agent";

import { once } from "./once.ts";
import { registerWriteTool } from "./write.js";

export default function pixWriteExtension(pi: PiPrettyApi): void {
	once(pi, "pix-write", () => {
		const createWriteTool = (createWriteToolDefinition ??
			createWriteToolFallback) as unknown as ToolFactory<WriteToolInput>;
		if (!createWriteTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		attachResizeListener();

		registerWriteTool(
			pi,
			createWriteTool,
			{
				cwd,
				sp: (p: string) => shortPath(cwd, home, p),
				TextComponent,
				fffState,
				cursorStore: new CursorStore(),
			},
			trackInvalidator,
		);
	});
}
