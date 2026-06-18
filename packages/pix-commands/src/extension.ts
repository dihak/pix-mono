import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerClear from "./clear.ts";
import registerDiff from "./diff.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once("pix-commands", () => {
		registerDiff(pi);
		registerClear(pi);
	});
}
