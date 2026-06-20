/**
 * pix-gate — Part 2: the prompt.
 *
 * The interactive confirm/deny dialog, decoupled from the rule engine (lib.ts).
 * Returns a pure decision; the caller maps it to a tool-call result and emits
 * any notifications. This lets the rule engine be reused without the TUI dep.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Box, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import type { Rule } from "./lib.ts";

export interface GateDecision {
	approved: boolean;
	/** "Approved" | "Blocked by user" | "Timed out" */
	reason: string;
}

/** The UI surface the dialog needs — the extension context's `ui`. */
export type GatePromptUI = ExtensionContext["ui"];

const TIMEOUT_MS: Record<Rule["severity"], number> = {
	critical: 15_000,
	dangerous: 30_000,
	risky: 60_000,
};

const SEVERITY_COLOR = {
	critical: "error",
	dangerous: "warning",
	risky: "accent",
} as const satisfies Record<Rule["severity"], string>;

const SEVERITY_ICON: Record<Rule["severity"], string> = {
	critical: "🛑",
	dangerous: "⚠️ ",
	risky: "❓",
};

/**
 * Show the confirm/deny dialog for a matched command and resolve the decision.
 * Critical defaults to deny-first; dangerous/risky default to allow-first.
 * Times out to a denial after a severity-scaled deadline.
 */
export async function promptGateDecision(
	ui: GatePromptUI,
	hit: Rule,
	command: string,
): Promise<GateDecision> {
	const timeoutMs = TIMEOUT_MS[hit.severity];
	const severityColor = SEVERITY_COLOR[hit.severity];
	const icon = SEVERITY_ICON[hit.severity];
	const label = hit.severity.toUpperCase();

	const choices: SelectItem[] =
		hit.severity === "critical"
			? [
					{
						value: "no",
						label: "No, block it",
						description: "Prevent this command from running",
					},
					{
						value: "yes",
						label: "Yes, I understand the risk",
						description: "Allow once",
					},
				]
			: [
					{
						value: "yes",
						label: "Yes, allow",
						description: "Run the command",
					},
					{
						value: "no",
						label: "No, block it",
						description: "Prevent this command from running",
					},
				];

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	const choice = await ui.custom<string | null>(
		(tui, theme, _kb, done) => {
			const container = new Box(0, 0, (s) => theme.bg("customMessageBg", s));

			container.addChild(
				new DynamicBorder((s: string) => theme.fg(severityColor, s)),
			);

			container.addChild(
				new Text(
					`${icon} ` +
						theme.fg(severityColor, theme.bold(label)) +
						theme.fg("muted", ` — ${hit.reason}`),
					1,
					0,
				),
			);

			container.addChild(new Text(theme.fg("toolOutput", command), 2, 0));

			const deadlineMs = Date.now() + timeoutMs;
			const countdownText = new Text("", 1, 0);
			const updateCountdown = () => {
				const remaining = Math.max(
					0,
					Math.ceil((deadlineMs - Date.now()) / 1000),
				);
				countdownText.setText(
					theme.fg("dim", "Auto-deny in ") +
						theme.fg(remaining <= 5 ? severityColor : "muted", `${remaining}s`),
				);
			};
			updateCountdown();
			const ticker = setInterval(() => {
				updateCountdown();
				tui.requestRender();
			}, 1000);
			container.addChild(countdownText);

			const list = new SelectList(choices, choices.length, {
				selectedPrefix: (t) => theme.fg(severityColor, t),
				selectedText: (t) => theme.fg(severityColor, t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});
			const finish = (v: string | null) => {
				clearInterval(ticker);
				done(v);
			};
			list.onSelect = (item) => finish(item.value);
			list.onCancel = () => finish(null);
			container.addChild(list);

			container.addChild(
				new Text(
					theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
					1,
					0,
				),
			);

			container.addChild(
				new DynamicBorder((s: string) => theme.fg(severityColor, s)),
			);

			controller.signal.addEventListener("abort", () => finish(null));

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					list.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true },
	);

	clearTimeout(timeoutId);

	const approved = choice === "yes";
	if (approved) return { approved: true, reason: "Approved" };
	return {
		approved: false,
		reason: controller.signal.aborted ? "Timed out" : "Blocked by user",
	};
}

export { SEVERITY_ICON };
