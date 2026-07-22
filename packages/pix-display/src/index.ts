/**
 * pix-display — Pi core extension: paste chips, thinking, and code-block display.
 *
 * Entry point: activates paste-chip, thinking, code-block, and editor UX extensions.
 * Terminal-only rendering behavior stays inactive outside TUI mode.
 *
 * Modules:
 *   paste-chips.ts              ChipEditor overlay, marker restyling, image path collapse
 *   autocomplete-tab-cycle.ts   Tab cycles suggestion highlight (Enter accepts)
 *   thinking.ts                 Leaked reasoning tag → native thinking content blocks
 *   code-blocks.ts              Framed, syntax-highlighted code fences in LLM output
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import autocompleteTabCycleExtension from "./autocomplete-tab-cycle.js";
import codeBlocksExtension from "./code-blocks.js";
import pasteChipsExtension from "./paste-chips.js";
import thinkingExtension from "./thinking.js";

export default function pixDisplayExtension(pi: ExtensionAPI): void {
	// Editor stack: paste-chips installs ChipEditor first; tab-cycle wraps it.
	pasteChipsExtension(pi);
	autocompleteTabCycleExtension(pi);
	thinkingExtension(pi);
	codeBlocksExtension(pi);
}
