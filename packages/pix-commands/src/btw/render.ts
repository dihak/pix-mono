import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

export interface BtwMessageDetails {
	question: string;
	answer: string;
	model: string;
	thinkingLevel: string;
	durationMs: number;
	toolUses: number;
	error?: string;
}

export function formatDuration(ms: number): string {
	if (ms < 1_000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function registerBtwRenderer(
	pi: Pick<import("@earendil-works/pi-coding-agent").ExtensionAPI, "registerMessageRenderer">,
): void {
	pi.registerMessageRenderer<BtwMessageDetails>("pix-btw-answer", (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const failed = Boolean(details.error);
		const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const meta = [details.model, details.thinkingLevel, formatDuration(details.durationMs)];
		if (details.toolUses > 0) meta.push(`${details.toolUses} tools`);

		// A custom renderer bypasses Pi's default custom-message box, so provide
		// our own card. Use selectedBg rather than the generic custom-message
		// background: it is intentionally more prominent across Pi themes, which
		// keeps this isolated side thread visually distinct from the main thread.
		// Keep chrome as Text and render only the answer as Markdown; ANSI-styled
		// header text embedded inside Markdown can confuse wrapping and parsing.
		const card = new Box(1, 1, (text) => theme.bg("selectedBg", text));
		card.addChild(
			new Text(`${icon} ${theme.bold("BTW")} ${theme.fg("dim", `· ${meta.join(" · ")}`)}`, 0, 0),
		);
		card.addChild(
			new Text(`${theme.fg("accent", "▐")} ${theme.fg("muted", details.question)}`, 0, 0),
		);
		card.addChild(new Spacer(1));

		if (failed) {
			card.addChild(new Text(theme.fg("error", details.error ?? "Unknown error"), 0, 0));
			return card;
		}

		try {
			card.addChild(
				new Markdown(details.answer, 0, 0, getMarkdownTheme(), {
					color: (text) => theme.fg("customMessageText", text),
				}),
			);
		} catch {
			card.addChild(new Text(theme.fg("customMessageText", details.answer), 0, 0));
		}
		return card;
	});
}
