/**
 * ui/notification.ts — subagent-notification custom message renderer.
 *
 * Renders background agent completion notifications as compact themed boxes:
 *   ✓ Explore [haiku]  scout auth flow  ↻5 · 3 tool uses · 12.4k · 8.3s
 *     ⎿  Found 3 references in src/middleware/…
 *
 * Pix twist: model name always in the stats line (even when same as parent).
 * Ported from tintinweb/pi-subagents (MIT), individual-nudge path only
 * (group-join deferred to v2).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatMs, formatTokens, formatTurns } from "../tools.ts";
import type { NotificationDetails } from "../types.ts";

/**
 * Register the subagent-notification message renderer on the pi instance.
 * Called once from index.ts during extension setup.
 */
export function registerNotificationRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<NotificationDetails>(
		"subagent-notification",
		(message, { expanded }, theme) => {
			const d = message.details;
			if (!d) return undefined;

			const isError =
				d.status === "error" ||
				d.status === "stopped" ||
				d.status === "aborted";
			const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const statusText = isError
				? d.status
				: d.status === "steered"
					? "completed (steered)"
					: "completed";

			// Line 1: icon + description + status
			let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

			// Line 2: stats — model always first (the pix twist)
			const parts: string[] = [];
			if (d.modelName) parts.push(theme.fg("muted", `[${d.modelName}]`));
			if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
			if (d.toolUses > 0)
				parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
			if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
			if (d.durationMs > 0) parts.push(formatMs(d.durationMs));
			if (parts.length) {
				line +=
					"\n  " +
					parts
						.map((p) => theme.fg("dim", p))
						.join(` ${theme.fg("dim", "·")} `);
			}

			// Line 3: result preview
			if (expanded) {
				const lines = d.resultPreview.split("\n").slice(0, 30);
				for (const l of lines) line += `\n${theme.fg("dim", `  ${l}`)}`;
			} else {
				const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
				line += `\n  ${theme.fg("dim", `⎿  ${preview}`)}`;
			}

			if (d.error && isError) {
				line += `\n  ${theme.fg("error", `⎿  ${d.error.slice(0, 100)}`)}`;
			}

			return new Text(line, 0, 0);
		},
	);
}
