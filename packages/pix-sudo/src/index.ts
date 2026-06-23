/**
 * pix-sudo — Pi extension
 *
 * Registers a `sudo_run` tool. Before execution the user sees ONE coloured
 * overlay with two stages:
 *
 *   Stage 1 — confirm
 *     Shows command + AI intent.  User picks Allow or Deny via SelectList.
 *     Auto-denies after 30 s.
 *
 *   Stage 2 — password (skipped when a valid PAM ticket already exists)
 *     Inline masked input (● per char) inside the same overlay.
 *     Enter submits, Esc cancels, 30 s inactivity auto-cancels.
 *
 * Security notes:
 *   - Password never leaves JS memory; never written to disk.
 *   - Every command still requires explicit per-call confirmation in the UI.
 *   - PAM timestamp cache is honoured (no `-k`): within the system sudoers
 *     timeout a repeat call skips the password prompt but NOT the confirm.
 *   - No UI (RPC / JSON mode) = blocked with isError immediately.
 *   - Output truncated to 50 KB / 2000 lines.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { FG_DIM, RST } from "@xynogen/pix-pretty/ansi";
import { MAX_PREVIEW_LINES } from "@xynogen/pix-pretty/config";
import { showOverlay } from "@xynogen/pix-pretty/gate-overlay";
import { renderBashOutput } from "@xynogen/pix-pretty/renderers";
import type {
	RenderContextLike,
	ThemeLike,
	ToolResultLike,
} from "@xynogen/pix-pretty/types";
import {
	fillToolBackground,
	getTextContent,
	normalizeLineEndings,
	renderToolError,
	rule,
	termW,
} from "@xynogen/pix-pretty/utils";
import { Type } from "typebox";
import {
	detectAuthFailure,
	hasValidTicket,
	MAX_OUTPUT_BYTES,
	MAX_OUTPUT_LINES,
	runWithSudo,
	truncate,
} from "./lib.ts";

// ── Extension entry point ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "sudo_run",
		label: "Run as root",
		description:
			"Execute a shell command with root (sudo) privileges. " +
			"Always shows the user a confirmation dialog before running — " +
			"the command is NEVER executed without explicit approval and password. " +
			"Use only when the task genuinely requires elevated permissions " +
			"(e.g. writing to /etc, managing system services, installing packages system-wide). " +
			"You MUST provide a clear `reason` explaining why root is needed.",
		promptSnippet:
			"Execute a shell command as root after user sees intent + password prompt",
		promptGuidelines: [
			"Use sudo_run only when root privileges are strictly required — prefer plain bash for everything else. " +
				"Always set `reason` to a short plain-English sentence explaining why root is needed " +
				'(e.g. "Installing a system package to /usr/local/bin").',
		],

		// Full-width framing (rules + bg fill) baked at termW(), like pix-bash.
		renderShell: "self",

		parameters: Type.Object({
			command: Type.String({
				description: "Shell command to run as root (passed to `sh -c`).",
			}),
			reason: Type.Optional(
				Type.String({
					description:
						"Short plain-English explanation of why root is needed. " +
						"Shown to the user so they can make an informed decision.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { command, reason } = params;

			// ── No UI: block immediately ───────────────────────────────────────
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "sudo_run requires an interactive session (no UI available).",
						},
					],
					details: { code: -1, stdout: "", stderr: "" },
					isError: true,
				};
			}

			// A valid PAM ticket lets us skip the password stage (confirm only).
			const cached = await hasValidTicket();

			const body = [
				reason?.trim()
					? `Intent: ${reason.trim()}`
					: "No reason provided by AI",
				`Command: ${command}`,
			];

			// ── Confirm (+ password unless a ticket is already cached) ─────────
			const overlayResult = cached
				? await showOverlay(ctx.ui, {
						mode: "confirm",
						title: "🔐 ROOT COMMAND REQUEST",
						body: [...body, "(sudo session active — no password needed)"],
						accent: "error",
						choices: [
							{ value: "yes", label: "Allow", description: "Run the command" },
							{ value: "no", label: "Deny", description: "Block the command" },
						],
					})
				: await showOverlay(ctx.ui, {
						mode: "sudo",
						title: "🔐 ROOT COMMAND REQUEST",
						body,
						accent: "error",
						choices: [
							{
								value: "yes",
								label: "Allow — enter password",
								description: "Proceed to password prompt",
							},
							{
								value: "no",
								label: "Deny — block command",
								description: "Prevent this command from running",
							},
						],
					});

			// Cached ticket needs no password; otherwise a blank password is a cancel.
			const missingPassword = !cached && !overlayResult.password?.trim();
			if (overlayResult.action !== "approved" || missingPassword) {
				const msg =
					overlayResult.action === "timeout"
						? "Timed out — auto-denied."
						: overlayResult.action === "denied"
							? "Denied by user."
							: "Cancelled — no password entered.";
				ctx.ui.notify(`🔐 ${msg}`, "warning");
				return {
					content: [{ type: "text", text: `Cancelled — ${msg}` }],
					details: { code: -1, stdout: "", stderr: "" },
				};
			}

			// Empty string when relying on the cached ticket (sudo -S reads nothing).
			const password = overlayResult.password ?? "";

			// ── Step 3: Execute via sudo -S ────────────────────────────────────
			let result: { stdout: string; stderr: string; code: number };
			try {
				result = await runWithSudo(command, password, signal);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`sudo_run failed: ${msg}`);
			}

			// ── Step 4: Auth-failure check ─────────────────────────────────────
			if (detectAuthFailure(result.code, result.stderr)) {
				ctx.ui.notify(
					"🔐 sudo authentication failed — wrong password",
					"error",
				);
				return {
					content: [
						{
							type: "text",
							text: "sudo authentication failed — wrong password.",
						},
					],
					details: { code: result.code, stdout: "", stderr: result.stderr },
					isError: true,
				};
			}

			// ── Step 5: Truncate + return ──────────────────────────────────────
			const combined = [
				result.stdout && `[stdout]\n${result.stdout}`,
				result.stderr && `[stderr]\n${result.stderr}`,
			]
				.filter(Boolean)
				.join("\n");

			const { text: truncatedText, truncated } = truncate(
				combined || "(no output)",
			);

			const suffix = truncated
				? `\n\n[Output truncated to ${MAX_OUTPUT_LINES} lines / ${MAX_OUTPUT_BYTES / 1024}KB]`
				: "";

			const combinedOut =
				[result.stdout, result.stderr].filter(Boolean).join("\n") ||
				"(no output)";

			return {
				content: [
					{
						type: "text",
						text: `Exit code: ${result.code}\n\n${truncatedText}${suffix}`,
					},
				],
				details: {
					code: result.code,
					stdout: result.stdout,
					stderr: result.stderr,
					truncated,
					_render: normalizeLineEndings(combinedOut)
						.replace(/\n{3,}/g, "\n\n")
						.replace(/^\n+|\n+$/g, ""),
				},
				isError: result.code !== 0,
			};
		},

		renderResult: ((
			result: ToolResultLike,
			_opt: unknown,
			theme: ThemeLike,
			renderCtx: RenderContextLike,
		) => {
			const text = renderCtx.lastComponent ?? new Text("", 0, 0);

			if (renderCtx.isError && !result.details) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const d = result.details as Record<string, unknown> | undefined;
			const code = typeof d?.code === "number" ? d.code : null;
			const rendered = typeof d?._render === "string" ? d._render : "";
			const { summary } = renderBashOutput(rendered, code);

			const lines = rendered ? rendered.split("\n") : [];
			const lineCount = lines.length;
			const lineInfo =
				lineCount > 1 ? `  ${FG_DIM}(${lineCount} lines)${RST}` : "";
			const header = `  ${summary}${lineInfo}`;

			if (!rendered) {
				text.setText(fillToolBackground(header));
				return text;
			}

			const maxShow = renderCtx.expanded ? lineCount : MAX_PREVIEW_LINES;
			const show = lines.slice(0, maxShow);
			const tw = termW();
			const out: string[] = [header, rule(tw)];
			for (const line of show) out.push(`  ${line}`);
			out.push(rule(tw));
			if (lineCount > maxShow) {
				out.push(`${FG_DIM}  … ${lineCount - maxShow} more lines${RST}`);
			}
			text.setText(fillToolBackground(out.join("\n")));
			return text;
		}) as never,
	});
}
