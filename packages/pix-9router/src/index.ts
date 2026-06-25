/**
 * pix-9router — Pi extension bundle
 *
 * Registers:
 *   - 9router provider  (model list from self-hosted router API)
 *   - fetch tool        (web page fetch via exa through router)
 *   - search tool       (web/news search via exa through router)
 *   - transcribe tool   (speech-to-text via audio transcription API)
 *
 * Environment:
 *   ROUTER_API_BASE  — override base URL  (default: https://9router.example.com/v1)
 *   ROUTER_API_KEY   — bearer token       (required for provider + tools)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFetch from "./fetch.js";
import registerProvider from "./provider.js";
import registerSearch from "./search.js";
import registerTranscribe from "./transcribe.js";

export default async function (pi: ExtensionAPI): Promise<void> {
	await registerProvider(pi);
	registerFetch(pi);
	registerSearch(pi);
	registerTranscribe(pi);
}
