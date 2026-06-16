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
 *   Stage 2 — password
 *     Inline masked input (● per char) inside the same overlay.
 *     Enter submits, Esc cancels, 30 s inactivity auto-cancels.
 *
 * Security notes:
 *   - Password never leaves JS memory; never written to disk.
 *   - `-k` invalidates cached sudo ticket — PAM always re-checks.
 *   - No UI (RPC / JSON mode) = blocked with isError immediately.
 *   - Output truncated to 50 KB / 2000 lines.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Box,
	Input,
	type SelectItem,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	detectAuthFailure,
	MAX_OUTPUT_BYTES,
	MAX_OUTPUT_LINES,
	runWithSudo,
	truncate,
} from "./lib.ts";

const PROMPT_TIMEOUT_MS = 30_000;

// ── Masked input wrapper ─────────────────────────────────────────────────────
// Delegates everything to Input but replaces visible chars with ● in render().

class MaskedInput extends Input {
	override render(width: number): string[] {
		// Temporarily swap value for masked version, render, restore.
		const real = this.getValue();
		const masked = "●".repeat(real.length);
		this.setValue(masked);
		const lines = super.render(width);
		this.setValue(real);
		return lines;
	}
}

// ── Main overlay builder ──────────────────────────────────────────────────────

interface OverlayResult {
	choice: "allow" | "deny" | "timeout";
	password?: string;
}

/**
 * Show a single overlay that walks through two stages:
 *   1. confirm (SelectList)
 *   2. password (MaskedInput)
 *
 * Returns the user's final decision + password (if allowed).
 */
async function showSudoOverlay(
	ctx: {
		ui: {
			custom: <T>(
				cb: (
					tui: { requestRender(): void },
					theme: {
						fg(c: string, t: string): string;
						bg(c: string, t: string): string;
						bold(t: string): string;
					},
					kb: unknown,
					done: (v: T) => void,
				) => {
					render(w: number): string[];
					invalidate(): void;
					handleInput(d: string): void;
					focused?: boolean;
				},
				opts?: { overlay?: boolean },
			) => Promise<T | undefined>;
		};
	},
	command: string,
	reason: string | undefined,
): Promise<OverlayResult> {
	return new Promise((resolve) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);

		ctx.ui
			.custom<OverlayResult>(
				(tui, theme, _kb, done) => {
					// ── state ──────────────────────────────────────────────────
					type Stage = "confirm" | "password";
					let stage: Stage = "confirm";
					const deadlineMs = Date.now() + PROMPT_TIMEOUT_MS;
					let ticker: ReturnType<typeof setInterval> | undefined;

					// ── components that are swapped between stages ─────────────
					const confirmChoices: SelectItem[] = [
						{
							value: "allow",
							label: "Allow — enter password",
							description: "Proceed to password prompt",
						},
						{
							value: "deny",
							label: "Deny — block command",
							description: "Prevent this command from running",
						},
					];

					const selectList = new SelectList(
						confirmChoices,
						confirmChoices.length,
						{
							selectedPrefix: (t) => theme.fg("error", t),
							selectedText: (t) => theme.fg("error", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					);

					const passwordInput = new MaskedInput();
					const passwordHint = new Text("", 1, 0);

					// ── static rows ────────────────────────────────────────────
					const container = new Box(0, 0, (s) =>
						theme.bg("customMessageBg", s),
					);

					container.addChild(
						new DynamicBorder((s: string) => theme.fg("error", s)),
					);
					container.addChild(
						new Text(
							`🔐 ${theme.fg("error", theme.bold("ROOT COMMAND REQUEST"))}`,
							1,
							0,
						),
					);

					// AI intent
					const intentText = reason?.trim()
						? `${theme.fg("muted", "Intent: ")}${theme.fg("text", reason.trim())}`
						: theme.fg("dim", "No reason provided by AI");
					container.addChild(new Text(intentText, 1, 0));

					// Command label + command
					container.addChild(new Text(theme.fg("muted", "Command:"), 1, 0));
					container.addChild(new Text(theme.fg("toolOutput", command), 2, 0));

					// Live countdown
					const countdownText = new Text("", 1, 0);
					const updateCountdown = () => {
						const remaining = Math.max(
							0,
							Math.ceil((deadlineMs - Date.now()) / 1000),
						);
						countdownText.setText(
							theme.fg("dim", "Auto-deny in ") +
								theme.fg(remaining <= 5 ? "error" : "muted", `${remaining}s`),
						);
					};
					updateCountdown();
					ticker = setInterval(() => {
						updateCountdown();
						tui.requestRender();
					}, 1000);
					container.addChild(countdownText);

					// ── stage-specific slot ────────────────────────────────────
					// Start with the SelectList; swap in password input on Allow.
					container.addChild(selectList);

					// Help row (updated per stage)
					const helpText = new Text(
						theme.fg("dim", "↑↓ navigate • enter select • esc deny"),
						1,
						0,
					);
					container.addChild(helpText);
					container.addChild(
						new DynamicBorder((s: string) => theme.fg("error", s)),
					);

					// ── stage transitions ──────────────────────────────────────
					const switchToPassword = () => {
						stage = "password";

						// Replace SelectList with password label + masked input
						container.removeChild(selectList);
						container.removeChild(helpText);

						// Remove old bottom border too (will re-add at end)
						// Actually easier: just insert before the bottom border
						// Re-add in correct order
						passwordHint.setText(
							`${theme.fg("muted", "🔑 ")}${theme.fg("text", "Sudo password:")}`,
						);
						container.addChild(passwordHint);
						container.addChild(passwordInput);
						container.addChild(
							new Text(theme.fg("dim", "enter confirm • esc cancel"), 1, 0),
						);

						tui.requestRender();
					};

					// ── event wiring ───────────────────────────────────────────
					const finish = (result: OverlayResult) => {
						clearTimeout(timer);
						if (ticker !== undefined) clearInterval(ticker);
						done(result);
					};

					selectList.onSelect = (item) => {
						if (item.value === "deny") {
							finish({ choice: "deny" });
						} else {
							switchToPassword();
						}
					};
					selectList.onCancel = () => finish({ choice: "deny" });

					passwordInput.onSubmit = (pw) =>
						finish({ choice: "allow", password: pw });
					passwordInput.onEscape = () => finish({ choice: "deny" });

					// Timeout auto-deny
					controller.signal.addEventListener("abort", () =>
						finish({ choice: "timeout" }),
					);

					// ── component interface ────────────────────────────────────
					return {
						render: (w: number) => container.render(w),
						invalidate: () => container.invalidate(),
						handleInput: (data: string) => {
							if (stage === "confirm") {
								selectList.handleInput(data);
							} else {
								passwordInput.handleInput(data);
							}
							tui.requestRender();
						},
					};
				},
				{ overlay: true },
			)
			.then((result) => {
				clearTimeout(timer);
				resolve(result ?? { choice: "timeout" });
			});
	});
}

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

			// ── Steps 1+2: single overlay (confirm → password) ─────────────────
			const overlayResult = await showSudoOverlay(ctx, command, reason);

			if (overlayResult.choice !== "allow" || !overlayResult.password?.trim()) {
				const msg =
					overlayResult.choice === "timeout"
						? "Timed out — auto-denied."
						: overlayResult.choice === "deny"
							? "Denied by user."
							: "Cancelled — no password entered.";
				ctx.ui.notify(`🔐 ${msg}`, "warning");
				return {
					content: [{ type: "text", text: `Cancelled — ${msg}` }],
					details: { code: -1, stdout: "", stderr: "" },
				};
			}

			const password = overlayResult.password;

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
				},
				isError: result.code !== 0,
			};
		},
	});
}
