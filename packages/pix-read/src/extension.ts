import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	PiPrettySdk,
	TextComponentCtor,
} from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";

import { once } from "./once.ts";
import { registerReadTool } from "./read.js";

export default function pixReadExtension(pi: PiPrettyApi): void {
	once("pix-read", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
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
