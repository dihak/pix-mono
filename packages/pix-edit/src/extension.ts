import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import {
	attachResizeListener,
	trackInvalidator,
} from "@xynogen/pix-pretty/resize";
import type {
	PiPrettyApi,
	PiPrettySdk,
	TextComponentCtor,
} from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerEditTool } from "./edit.js";
import { once } from "./once.ts";

export default function pixEditExtension(pi: PiPrettyApi): void {
	once("pix-edit", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createEditTool = sdk.createEditToolDefinition ?? sdk.createEditTool;
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
