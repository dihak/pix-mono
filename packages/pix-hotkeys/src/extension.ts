import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import hotkeysExtension from "./hotkeys.ts";
import { once } from "./once.ts";
import { patchOutBuiltinHotkeysCommand } from "./patch-builtin.ts";

export default function (pi: ExtensionAPI): void {
	once(pi, "pix-hotkeys", () => {
		// Strip the built-in /hotkeys and redirect its submit intercept to our
		// command. Self-healing: re-applies on every load, so a Pi upgrade can't
		// restore the stock behavior.
		patchOutBuiltinHotkeysCommand();
		hotkeysExtension(pi);
	});
}
