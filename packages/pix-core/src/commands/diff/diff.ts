/**
 * /diff — explain unstaged git diff with per-file +/- counts.
 *
 * The agent runs `git status` + `git diff`, then replies with:
 *   1. 1–2 sentence explanation of what changed
 *   2. Per-file +/- line counts
 *   3. Total +/- line count
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIFF_PROMPT = `Run git status and inspect the unstaged git diff, then respond with only:

1. A short 1-2 sentence explanation of what changed and why it matters.
2. A list of changed unstaged files with their +/- line counts.
3. A total +/- line count at the bottom.

Keep it concise. Use git commands to calculate the line counts. Base the summary on the actual diff, not only filenames. Do not include staged changes unless they also have unstaged modifications.`;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("diff", {
		description: "Explain unstaged git diff with per-file +/- counts",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				pi.sendUserMessage(DIFF_PROMPT, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /diff after the current turn finishes.", "info");
				return;
			}
			pi.sendUserMessage(DIFF_PROMPT);
		},
	});
}
