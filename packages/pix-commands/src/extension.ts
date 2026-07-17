import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtw } from "./btw/index.ts";
import registerClear from "./clear.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once(pi, "pix-commands", () => {
		registerClear(pi);
		registerBtw(pi);
	});
}
