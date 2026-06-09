/**
 * pix-data — Pi extension
 *
 * Warms the shared model data cache on session start so other extensions
 * (pix-9router, models picker, footer) can read from ~/.cache/pi/* synchronously.
 *
 * Fetches in parallel, non-blocking — Pi session starts immediately.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { benchmark, modelsDev } from "./data.ts";

export default function (_pi: ExtensionAPI): void {
	void modelsDev.get();
	void benchmark.get();
}
