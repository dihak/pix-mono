import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { once } from "./once.ts";
import registerPrompts from "./prompts.ts";

export default function (pi: ExtensionAPI): void {
	once("pix-prompts", () => registerPrompts(pi));
}
