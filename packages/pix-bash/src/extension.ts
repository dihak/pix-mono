import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	PiPrettySdk,
	TextComponentCtor,
} from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerBashTool } from "./bash.js";
import { once } from "./once.ts";

export default function pixBashExtension(pi: PiPrettyApi): void {
	once("pix-bash", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
		if (!createBashTool) return;

		let TextComponent: TextComponentCtor;
		try {
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		registerBashTool(pi, createBashTool, {
			cwd,
			sp: (p: string) => shortPath(cwd, home, p),
			TextComponent,
			fffState,
			cursorStore: new CursorStore(),
		});
	});
}
