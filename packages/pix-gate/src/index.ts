/**
 * pix-gate — Pi extension
 *
 * Intercepts bash `tool_call` events and gates dangerous commands behind a
 * TUI confirmation dialog before they run.
 *
 * Severity tiers:
 *   critical  — blocked outright in non-interactive mode; hard deny-first in UI
 *   dangerous — 30 s auto-deny dialog; sudo fast-blocked with redirect to sudo_run
 *   risky     — 60 s allow-first dialog; silently passes in non-interactive mode
 *
 * Config: ~/.pi/agent/pix-gate.json
 *   disableDefaults: true          — replace built-in rules entirely
 *   extraRules: [{ pattern, flags?, severity?, reason? }]  — append extra rules
 *   autoApprove: ["regex"]         — bypass gate for matching commands
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Box, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { buildRules, classify, isSudoCommand, loadUserConfig } from "./lib.ts";

export default function (pi: ExtensionAPI): void {
	const { rules, autoApprove } = buildRules(loadUserConfig());

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String(event.input.command ?? "");
		if (!command.trim()) return undefined;

		if (autoApprove.some((re) => re.test(command))) return undefined;

		const hit = classify(command, rules);
		if (!hit) return undefined;

		// sudo: fast-block with redirect to sudo_run — no dialog needed.
		if (isSudoCommand(command)) {
			ctx.ui.notify(
				`⚠️  ${ctx.ui.theme.fg("warning", "DANGEROUS")} — privilege escalation blocked\n` +
					`${ctx.ui.theme.fg("dim", "Use")} ${ctx.ui.theme.fg("accent", "sudo_run")} ` +
					`${ctx.ui.theme.fg("dim", "tool instead — handles auth securely")}`,
				"warning",
			);
			return {
				block: true,
				reason:
					"[DANGEROUS] privilege escalation — use sudo_run tool instead, it handles authentication securely.",
			};
		}

		const icon =
			hit.severity === "critical"
				? "🛑"
				: hit.severity === "dangerous"
					? "⚠️ "
					: "❓";
		const label = hit.severity.toUpperCase();

		// Non-interactive: block critical + dangerous outright; allow risky silently.
		if (!ctx.hasUI) {
			if (hit.severity === "critical") {
				return {
					block: true,
					reason: `[${label}] ${hit.reason} (no UI, auto-blocked)`,
				};
			}
			if (hit.severity === "dangerous") {
				return {
					block: true,
					reason: `[${label}] ${hit.reason} (no UI for confirmation)`,
				};
			}
			return undefined;
		}

		const timeoutMs =
			hit.severity === "critical"
				? 15_000
				: hit.severity === "dangerous"
					? 30_000
					: 60_000;

		const severityColor =
			hit.severity === "critical"
				? "error"
				: hit.severity === "dangerous"
					? "warning"
					: "accent";

		// Critical: deny-first; dangerous/risky: allow-first.
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

		const choice = await ctx.ui.custom<string | null>(
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

				// Live countdown
				const deadlineMs = Date.now() + timeoutMs;
				const countdownText = new Text("", 1, 0);
				const updateCountdown = () => {
					const remaining = Math.max(
						0,
						Math.ceil((deadlineMs - Date.now()) / 1000),
					);
					countdownText.setText(
						theme.fg("dim", "Auto-deny in ") +
							theme.fg(
								remaining <= 5 ? severityColor : "muted",
								`${remaining}s`,
							),
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
		if (!approved) {
			const reason = controller.signal.aborted
				? "Timed out"
				: "Blocked by user";
			ctx.ui.notify(`${icon} ${reason}: ${hit.reason}`, "warning");
			return { block: true, reason: `[${label}] ${reason}` };
		}

		ctx.ui.notify(
			`${icon} ` +
				ctx.ui.theme.fg(
					severityColor,
					`Approved ${label.toLowerCase()} command`,
				),
			"info",
		);
		return undefined;
	});
}
