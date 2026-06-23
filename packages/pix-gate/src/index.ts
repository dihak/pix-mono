/**
 * pix-gate — Pi extension
 *
 * Intercepts bash `tool_call` events and gates dangerous commands behind a
 * TUI confirmation dialog before they run.
 *
 * Severity tiers (user always has final say via dialog):
 *   critical  — red, deny-first dialog
 *   dangerous — yellow, deny-first dialog
 *   risky     — allow-first dialog
 *   sudo      — hard block, must use sudo_run tool instead (no bypass)
 *   No-UI fallback: critical/dangerous auto-block (can't show dialog)
 *
 * Config: ~/.pi/agent/pix-gate.json
 *   disableDefaults: true          — replace built-in rules entirely
 *   extraRules: [{ pattern, flags?, severity?, reason? }]  — append extra rules
 *   autoApprove: ["regex"]         — bypass gate for matching commands
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildRules,
	classify,
	classifyPath,
	extractPathsFromBash,
	isSudoCommand,
	loadUserConfig,
} from "./lib.ts";
import {
	PATH_SEVERITY_ICON,
	promptGateDecision,
	promptPathDecision,
	SEVERITY_ICON,
} from "./prompt.ts";

export default function (pi: ExtensionAPI): void {
	const { rules, autoApprove, pathRules } = buildRules(loadUserConfig());

	// ── Path protection ──────────────────────────────────────────────────────
	pi.on("tool_call", async (event, ctx) => {
		const tool = String(event.toolName);
		const input = event.input as Record<string, unknown>;
		let path: string | undefined;
		let op: "read" | "write";

		if (tool === "read") {
			path = String(input.path ?? "");
			op = "read";
		} else if (tool === "write" || tool === "edit") {
			path = String(input.path ?? "");
			op = "write";
		} else if (tool === "bash") {
			const cmd = String(input.command ?? "");
			const candidates = extractPathsFromBash(cmd);
			for (const p of candidates) {
				const hit = classifyPath(p, "read", pathRules);
				if (!hit) continue;
				if (hit.severity === "info") {
					ctx.ui.notify(
						`${PATH_SEVERITY_ICON.info} ${hit.reason}: ${p}`,
						"info",
					);
					continue;
				}
				if (!ctx.hasUI)
					return {
						block: true,
						reason: `[PATH:${hit.severity.toUpperCase()}] ${hit.reason} (no UI)`,
					};
				const decision = await promptPathDecision(ctx.ui, hit, "bash read", p);
				if (!decision.approved)
					return {
						block: true,
						reason: `[PATH] ${decision.reason}: ${hit.reason}`,
					};
			}
			return undefined;
		} else {
			return undefined;
		}

		if (!path) return undefined;
		const hit = classifyPath(path, op, pathRules);
		if (!hit) return undefined;

		if (hit.severity === "info") {
			ctx.ui.notify(
				`${PATH_SEVERITY_ICON.info} ${hit.reason}: ${path}`,
				"info",
			);
			return undefined;
		}

		if (!ctx.hasUI)
			return {
				block: true,
				reason: `[PATH:${hit.severity.toUpperCase()}] ${hit.reason} (no UI)`,
			};

		const decision = await promptPathDecision(ctx.ui, hit, op, path);
		if (!decision.approved)
			return {
				block: true,
				reason: `[PATH] ${decision.reason}: ${hit.reason}`,
			};
		return undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String(event.input.command ?? "");
		if (!command.trim()) return undefined;

		if (autoApprove.some((re) => re.test(command))) return undefined;

		const hit = classify(command, rules);
		if (!hit) return undefined;

		const icon = SEVERITY_ICON[hit.severity];
		const label = hit.severity.toUpperCase();

		// No UI: can't show dialog — auto-block critical/dangerous, pass risky.
		if (!ctx.hasUI) {
			if (hit.severity === "risky") return undefined;
			return {
				block: true,
				reason: `[${label}] ${hit.reason} (no UI, auto-blocked)`,
			};
		}

		// sudo: hard redirect to sudo_run — no prompt, no bypass.
		if (isSudoCommand(command)) {
			ctx.ui.notify(
				`⚠️  ${ctx.ui.theme.fg("warning", "DANGEROUS")} — use sudo_run tool instead (handles auth securely)`,
				"warning",
			);
			return {
				block: true,
				reason:
					"[DANGEROUS] privilege escalation — use sudo_run tool, it handles authentication securely.",
			};
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
