/**
 * pix-command.ts — the `/pix` command: unified settings overlay for pix.json.
 *
 * Opens an interactive overlay that surfaces every section of
 * `~/.pi/agent/pix.json` as a browsable, editable settings panel. Each setting
 * is a row with ←→ to cycle its value. Sections are separated by headers.
 *
 * Headless hosts get a notify summary instead.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type PixConfig, pixConfig, savePixConfig } from "./pix-config.js";

// ── Setting descriptors ──────────────────────────────────────────────────────

interface SettingRow {
	/** Section header — only the first row per section renders a header. */
	section: string;
	/** Display label. */
	label: string;
	/** The pix.json path: top-level key. */
	configSection: keyof PixConfig;
	/** The field name within the section. */
	configKey: string;
	/** Allowed values to cycle through. */
	values: readonly string[];
	/** Read the current value from config. */
	read: (cfg: PixConfig) => string;
}

const SETTINGS: SettingRow[] = [
	// ── Pretty ──────────────────────────────────────────────────────────────
	{
		section: "Pretty",
		label: "icons",
		configSection: "pretty",
		configKey: "icons",
		values: ["nerd", "unicode", "ascii"],
		read: (c) => c.pretty.icons,
	},
	{
		section: "Pretty",
		label: "ls style",
		configSection: "pretty",
		configKey: "lsStyle",
		values: ["grid", "tree"],
		read: (c) => c.pretty.lsStyle,
	},
	// ── Collapse ─────────────────────────────────────────────────────────────
	{
		section: "Collapse",
		label: "enabled",
		configSection: "collapse",
		configKey: "enabled",
		values: ["true", "false"],
		read: (c) => String(c.collapse.enabled),
	},
	{
		section: "Collapse",
		label: "delay (sec)",
		configSection: "collapse",
		configKey: "delaySec",
		values: ["5", "10", "15", "20", "30", "60"],
		read: (c) => String(c.collapse.delaySec),
	},
	// ── Optimizer ─────────────────────────────────────────────────────────────
	{
		section: "Optimizer",
		label: "caveman",
		configSection: "optimizer",
		configKey: "caveman",
		values: ["off", "lite", "full", "ultra", "micro"],
		read: (c) => c.optimizer.caveman,
	},
	{
		section: "Optimizer",
		label: "rtk",
		configSection: "optimizer",
		configKey: "rtk",
		values: ["off", "on"],
		read: (c) => c.optimizer.rtk,
	},
	{
		section: "Optimizer",
		label: "toon",
		configSection: "optimizer",
		configKey: "toon",
		values: ["off", "on"],
		read: (c) => c.optimizer.toon,
	},
	{
		section: "Optimizer",
		label: "ponytail",
		configSection: "optimizer",
		configKey: "ponytail",
		values: ["off", "lite", "full", "ultra"],
		read: (c) => c.optimizer.ponytail,
	},
	// ── Gate ──────────────────────────────────────────────────────────────────
	{
		section: "Gate",
		label: "disable defaults",
		configSection: "gate",
		configKey: "disableDefaults",
		values: ["false", "true"],
		read: (c) => String(c.gate.disableDefaults),
	},
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce string values back to proper JSON types for saving. */
function coerce(value: string): string | number | boolean {
	if (value === "true") return true as unknown as string;
	if (value === "false") return false as unknown as string;
	const n = Number(value);
	if (Number.isFinite(n) && String(n) === value) return n as unknown as string;
	return value;
}

/** Build a plain text summary for headless hosts. */
function buildSummary(): string {
	const cfg = pixConfig();
	const lines = ["pix settings (~/.pi/agent/pix.json)", ""];
	let lastSection = "";
	for (const row of SETTINGS) {
		if (row.section !== lastSection) {
			if (lastSection) lines.push("");
			lines.push(`[${row.section}]`);
			lastSection = row.section;
		}
		lines.push(`  ${row.label}: ${row.read(cfg)}`);
	}
	return lines.join("\n");
}

// ── Command registration ─────────────────────────────────────────────────────

export function registerPixCommand(pi: ExtensionAPI): void {
	pi.registerCommand("pix", {
		description: "pix: open settings (edit ~/.pi/agent/pix.json)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const ui = ctx.ui as unknown as {
				theme: {
					fg(c: string, t: string): string;
					bg(c: string, t: string): string;
					bold(t: string): string;
				};
				custom?: <T>(
					f: unknown,
					opts?: {
						overlay?: boolean;
						overlayOptions?: {
							anchor?: string;
							width?: number;
							maxHeight?: string;
						};
					},
				) => Promise<T>;
				notify(m: string, t?: "info" | "warning" | "error"): void;
			};

			// Headless fallback.
			if (typeof ui.custom !== "function") {
				ui.notify(buildSummary(), "info");
				return;
			}

			const boxW = 52;

			await ui.custom<null>(
				(
					tui: { requestRender(): void },
					theme: typeof ui.theme,
					_kb: unknown,
					done: (v: null) => void,
				) => {
					let selected = 0;
					let cfg = pixConfig();

					/** Cycle the selected setting's value. */
					const cycle = (direction: -1 | 1) => {
						const row = SETTINGS[selected];
						if (!row) return;
						const vals = row.values;
						const cur = vals.indexOf(row.read(cfg));
						const next = (cur + direction + vals.length) % vals.length;
						const val = vals[next];
						if (val === undefined) return;

						// Persist to pix.json.
						cfg = savePixConfig({
							[row.configSection]: { [row.configKey]: coerce(val) },
						});
					};

					const move = (direction: -1 | 1) => {
						selected = (selected + direction + SETTINGS.length) % SETTINGS.length;
					};

					return {
						render: () => {
							const labelW = Math.max(...SETTINGS.map((r) => r.label.length));
							const lines: string[] = [theme.fg("accent", theme.bold("  pix settings")), ""];

							let lastSection = "";
							for (let i = 0; i < SETTINGS.length; i++) {
								const row = SETTINGS[i]!;
								// Section header.
								if (row.section !== lastSection) {
									if (lastSection) lines.push("");
									lines.push(theme.fg("dim", `  ${row.section}`));
									lastSection = row.section;
								}

								const sel = i === selected;
								const cursor = sel ? theme.fg("accent", "→") : " ";
								const label = theme.fg(sel ? "accent" : "text", row.label.padEnd(labelW));
								const val = row.read(cfg);
								const isDefault = val === row.values[0];
								const value = theme.fg(isDefault ? "dim" : "success", val);
								lines.push(`${cursor} ${label}  ${value}`);
							}

							lines.push("");
							lines.push(theme.fg("dim", "←→ change · ↑↓ move · esc close"));

							return frameLines({
								width: boxW,
								lines,
								color: (s: string) => theme.fg("accent", s),
								bg: (s: string) => theme.bg("customMessageBg", s),
							});
						},
						invalidate: () => {},
						handleInput: (data: string) => {
							if (data === "k" || data === "\u001b[A") move(-1);
							else if (data === "j" || data === "\u001b[B") move(1);
							else if (data === "h" || data === "\u001b[D") cycle(-1);
							else if (data === "l" || data === "\u001b[C" || data === " " || data === "\r")
								cycle(1);
							else if (data === "\u001b" || data === "q") {
								done(null);
								return;
							} else return;
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: boxW, maxHeight: "80%" },
				},
			);
		},
	});
}

// ── Inline frameLines (avoid cross-package dep on pix-pretty) ────────────────

interface FrameOptions {
	width: number;
	lines: string[];
	color: (s: string) => string;
	bg?: (s: string) => string;
}

function visibleWidth(s: string): number {
	// Strip ANSI escape sequences for width calculation.
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function frameLines(opts: FrameOptions): string[] {
	const { width, lines, color } = opts;
	const bg = opts.bg ?? ((s: string) => s);
	const inner = Math.max(1, width - 4); // 2 border + 2 padding
	const dashes = "─".repeat(width - 2);

	const SENTINEL = "\x00";
	const bgOpen = bg(SENTINEL).split(SENTINEL)[0] ?? "";
	const reassert = (s: string): string =>
		bgOpen
			? s.replace(/\x1b\[([0-9;]*)m/g, (seq, p: string) =>
					p === "0" || p.split(";").includes("49") ? `${seq}${bgOpen}` : seq,
				)
			: s;

	const row = (content: string): string => {
		const pad = inner - visibleWidth(content);
		const padded = pad > 0 ? content + " ".repeat(pad) : content.slice(0, inner);
		return bg(`${color("│")} ${reassert(padded)} ${color("│")}`);
	};

	const out: string[] = [bg(color(`╭${dashes}╮`))];
	for (const line of lines) out.push(row(line));
	out.push(bg(color(`╰${dashes}╯`)));
	return out;
}
