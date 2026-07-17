/**
 * pix-display — Pi core extension: paste chips, thinking, and code-block display.
 *
 * Entry point: activates paste-chip, thinking, and code-block extensions.
 * Terminal-only rendering behavior stays inactive outside TUI mode.
 *
 * Modules:
 *   paste-chips.ts   ChipEditor overlay, marker restyling, image path collapse
 *   thinking.ts      Leaked reasoning tag → native thinking content blocks
 *   code-blocks.ts   Framed, syntax-highlighted code fences in LLM output
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import codeBlocksExtension from "./code-blocks.js";
import pasteChipsExtension from "./paste-chips.js";
import thinkingExtension from "./thinking.js";

export default function pixDisplayExtension(pi: ExtensionAPI): void {
	pasteChipsExtension(pi);
	thinkingExtension(pi);
	codeBlocksExtension(pi);
}
