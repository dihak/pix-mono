import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { once } from "./once.ts";
import registerWelcome from "./welcome.ts";

export default function (pi: ExtensionAPI): void {
	once("pix-welcome", () => registerWelcome(pi));
}
