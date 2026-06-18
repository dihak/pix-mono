import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	PiPrettySdk,
	TextComponentCtor,
} from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerLsTool } from "./ls.js";
import { once } from "./once.ts";

export default function pixLsExtension(pi: PiPrettyApi): void {
	once("pix-ls", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createLsTool = sdk.createLsToolDefinition ?? sdk.createLsTool;
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
