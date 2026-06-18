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

import { once } from "./once.ts";
import { registerWriteTool } from "./write.js";

export default function pixWriteExtension(pi: PiPrettyApi): void {
	once("pix-write", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createWriteTool =
			sdk.createWriteToolDefinition ?? sdk.createWriteTool;
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
