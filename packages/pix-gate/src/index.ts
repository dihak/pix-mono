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
import { buildRules, classify, isSudoCommand, loadUserConfig } from "./lib.ts";
import { promptGateDecision, SEVERITY_ICON } from "./prompt.ts";

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

		const icon = SEVERITY_ICON[hit.severity];
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

		const decision = await promptGateDecision(ctx.ui, hit, command);

		if (!decision.approved) {
			ctx.ui.notify(`${icon} ${decision.reason}: ${hit.reason}`, "warning");
			return { block: true, reason: `[${label}] ${decision.reason}` };
		}

		const severityColor =
			hit.severity === "critical"
				? "error"
				: hit.severity === "dangerous"
					? "warning"
					: "accent";
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
