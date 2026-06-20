import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerCapabilityNudge from "./capability.ts";
import { once } from "./once.ts";
import registerToolsNudge from "./tools.ts";

export default function (pi: ExtensionAPI): void {
	once(pi, "pix-nudge", () => {
		registerToolsNudge(pi);
		registerCapabilityNudge(pi);
	});
}
