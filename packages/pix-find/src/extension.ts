import { CursorStore, fffState } from "@xynogen/pix-pretty/fff";
import type {
	PiPrettyApi,
	PiPrettySdk,
	TextComponentCtor,
} from "@xynogen/pix-pretty/types";
import { shortPath } from "@xynogen/pix-pretty/utils";
import { registerFindTool } from "./find.js";
import { once } from "./once.ts";

export default function pixFindExtension(pi: PiPrettyApi): void {
	once("pix-find", () => {
		let sdk: PiPrettySdk;
		try {
			sdk = require("@earendil-works/pi-coding-agent");
		} catch {
			return;
		}

		const createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
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
