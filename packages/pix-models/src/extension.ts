import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import modelPickerExtension from "./models.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once("pix-models", () => modelPickerExtension(pi));
}
