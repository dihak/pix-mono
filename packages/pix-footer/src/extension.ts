import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFooter from "./footer.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once("pix-footer", () => registerFooter(pi));
}
