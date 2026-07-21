import { CursorStore, fffState } from "@dihak/pix-pretty/fff";
import { attachResizeListener, trackInvalidator } from "@dihak/pix-pretty/resize";
import type { PiPrettyApi, TextComponentCtor, ToolFactory } from "@dihak/pix-pretty/types";
import { shortPath } from "@dihak/pix-pretty/utils";
import {
	createEditToolDefinition,
	createEditTool as createEditToolFallback,
	type EditToolInput,
} from "@earendil-works/pi-coding-agent";
import { registerEditTool } from "./edit.js";
import { once } from "./once.ts";

export default function pixEditExtension(pi: PiPrettyApi): void {
	once(pi, "pix-edit", () => {
		const createEditTool = (createEditToolDefinition ??
			createEditToolFallback) as unknown as ToolFactory<EditToolInput>;
		if (!createEditTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		attachResizeListener();

		registerEditTool(
			pi,
			createEditTool,
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
