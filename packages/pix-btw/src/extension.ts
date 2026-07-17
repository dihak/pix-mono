import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtw } from "./index.ts";
import { once } from "./once.ts";

export default function pixBtwExtension(pi: ExtensionAPI): void {
	once(pi, "pix-btw", () => registerBtw(pi));
}
