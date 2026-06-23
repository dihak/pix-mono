/**
 * pix-pretty/gate-overlay — shared permission dialog component.
 *
 * One component, two modes:
 *   "confirm" — SelectList only. Used by pix-gate for command gating.
 *   "sudo"    — SelectList → masked password input. Used by pix-sudo.
 *
 * Both modes share: rounded modal frame (╭─╮╰─╯), solid bg, accent border,
 * title, body lines, optional countdown. Same visual style as pix-ask.
 *
 * Design goals:
 *   - Pure function — no side effects, no global state.
 *   - Fully unit-testable: inject a mock `ui` to drive inputs deterministically.
 *   - Single source of truth for the overlay look across pix-gate and pix-sudo.
 */

import { Input, type SelectItem, SelectList } from "@earendil-works/pi-tui";
import { frameLines, modalWidth, selectListTheme } from "./modal-frame.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OverlayAction = "approved" | "denied" | "timeout"; // ponytail: timeout kept for back-compat; never emitted now

export interface OverlayResult {
	action: OverlayAction;
	/** Only present when action === "approved" and mode === "sudo". */
	password?: string;
}

export interface OverlayChoice {
	value: string;
	label: string;
	description: string;
}

interface BaseConfig {
	/** Accent colour token (e.g. "error", "warning", "accent"). Default "accent". */
	accent?: string;
	/** Title shown bold at the top. */
	title: string;
	/** Optional body lines under the title. */
	body?: string[];
	/** @deprecated No-op — timeout removed. Dialog waits indefinitely for user input. */
	timeoutMs?: number;
	/**
	 * Choices shown in the SelectList.
	 * The choice whose value === approveValue counts as approval.
	 * Default: [{ value:"yes", label:"Allow" }, { value:"no", label:"Deny" }]
	 */
	choices?: OverlayChoice[];
	/** Which choice value means "approved". Default "yes". */
	approveValue?: string;
}

export interface ConfirmConfig extends BaseConfig {
	mode: "confirm";
}

export interface SudoConfig extends BaseConfig {
	mode: "sudo";
	/** Label for the password input hint. Default "Sudo password:" */
	passwordLabel?: string;
}

export type OverlayConfig = ConfirmConfig | SudoConfig;

// Minimal structural types — no hard dep on a specific Pi context shape.
interface OverlayTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

interface OverlayTui {
	requestRender(): void;
}

interface OverlayComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
	focused?: boolean;
}

export interface OverlayUI {
	custom<T>(
		cb: (
			tui: OverlayTui,
			theme: OverlayTheme,
			kb: unknown,
			done: (v: T) => void,
		) => OverlayComponent,
		opts?: { overlay?: boolean },
	): Promise<T | undefined>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CHOICES: OverlayChoice[] = [
	{ value: "yes", label: "Allow", description: "Proceed" },
	{ value: "no", label: "Deny", description: "Block" },
];

// ── Masked input (● per char) ─────────────────────────────────────────────────

class MaskedInput extends Input {
	override render(width: number): string[] {
		const real = this.getValue();
		this.setValue("●".repeat(real.length));
		const lines = super.render(width);
		this.setValue(real);
		return lines;
	}
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/** Build body lines for the current stage, rendered into frameLines. */
function buildLines(opts: {
	theme: OverlayTheme;
	accent: string;
	config: OverlayConfig;
	stage: "select" | "password";
	selectList: SelectList;
	maskedInput: MaskedInput;
	countdownLine: string | undefined;
	width: number;
}): string[] {
	const {
		theme,
		accent,
		config,
		stage,
		selectList,
		maskedInput,
		countdownLine,
		width,
	} = opts;
	const inner = width - 4; // CHROME = 2 border + 2 padding
	const lines: string[] = [];

	// Title
	lines.push(theme.fg(accent, theme.bold(config.title)));

	// Body
	for (const line of config.body ?? []) {
		lines.push(theme.fg("text", line));
	}

	// Divider after title/body
	lines.push(theme.fg("dim", "─".repeat(inner)));

	// Countdown
	if (countdownLine !== undefined) lines.push(countdownLine);

	// Select or password stage
	if (stage === "select") {
		const listLines = selectList.render(inner);
		for (const l of listLines) lines.push(l);
		lines.push("");
		lines.push(theme.fg("dim", "↑↓ navigate • enter select • esc deny"));
	} else {
		const label =
			config.mode === "sudo"
				? (config.passwordLabel ?? "Sudo password:")
				: "Password:";
		lines.push(theme.fg("muted", label));
		const inputLines = maskedInput.render(inner);
		for (const l of inputLines) lines.push(l);
		lines.push("");
		lines.push(theme.fg("dim", "enter confirm • esc cancel"));
	}

	return lines;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Show a permission overlay and resolve the user's decision.
 *
 * @example — gate confirm
 * ```ts
 * const result = await showOverlay(ui, {
 *   mode: "confirm",
 *   title: "⚠️  DANGEROUS",
 *   body: ["rm -rf /tmp/work"],
 *   accent: "warning",
 *   timeoutMs: 30_000,
 *   choices: [
 *     { value: "yes", label: "Allow", description: "Run the command" },
 *     { value: "no",  label: "Deny",  description: "Block it"        },
 *   ],
 * });
 * ```
 *
 * @example — sudo prompt
 * ```ts
 * const result = await showOverlay(ui, {
 *   mode: "sudo",
 *   title: "🔐 ROOT COMMAND REQUEST",
 *   body: ["Intent: install package", "Command: apt install foo"],
 *   accent: "error",
 * });
 * if (result.action === "approved") runWithSudo(cmd, result.password!);
 * ```
 */
export function showOverlay(
	ui: OverlayUI,
	config: OverlayConfig,
): Promise<OverlayResult> {
	const accent = config.accent ?? "accent";
	const choices = config.choices ?? DEFAULT_CHOICES;
	const approveVal = config.approveValue ?? "yes";

	return new Promise((resolve) => {
		ui.custom<OverlayResult>(
			(tui, theme, _kb, done) => {
				type Stage = "select" | "password";
				let stage: Stage = "select";
				let countdownLine: string | undefined;

				// ── components ──────────────────────────────────────────────────
				const selectItems: SelectItem[] = choices.map((c) => ({
					value: c.value,
					label: c.label,
					description: c.description,
				}));

				const selectList = new SelectList(
					selectItems,
					selectItems.length,
					selectListTheme(theme, accent),
				);
				const maskedInput = new MaskedInput();

				// ── finish ───────────────────────────────────────────────────────
				const finish = (result: OverlayResult) => done(result);

				// ── event wiring ─────────────────────────────────────────────────
				selectList.onSelect = (item) => {
					if (item.value !== approveVal) {
						finish({ action: "denied" });
					} else if (config.mode === "sudo") {
						stage = "password";
						tui.requestRender();
					} else {
						finish({ action: "approved" });
					}
				};
				selectList.onCancel = () => finish({ action: "denied" });

				maskedInput.onSubmit = (pw) =>
					finish({ action: "approved", password: pw });
				maskedInput.onEscape = () => finish({ action: "denied" });

				// ── component interface ──────────────────────────────────────────
				return {
					render: (w) => {
						const mw = modalWidth(w);
						const lines = buildLines({
							theme,
							accent,
							config,
							stage,
							selectList,
							maskedInput,
							countdownLine,
							width: mw,
						});
						return frameLines({
							width: mw,
							lines,
							color: (s) => theme.fg(accent, s),
							bg: (s) => theme.bg("customMessageBg", s),
						});
					},
					invalidate: () => {},
					handleInput: (data) => {
						if (stage === "select") selectList.handleInput(data);
						else maskedInput.handleInput(data);
						tui.requestRender();
					},
				};
			},
			{ overlay: true },
		).then((result) => {
			resolve(result ?? { action: "denied" });
		});
	});
}
