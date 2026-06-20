import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerDiagnostics from "./diagnostics.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once(pi, "pix-diagnostics", () => registerDiagnostics(pi));
}
