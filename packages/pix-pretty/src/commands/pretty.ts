/**
 * pretty.ts — the `/pretty` command: switch the global icon mode.
 *
 * Treats icons like an l10n locale: one global mode (nerd/unicode/ascii)
 * governs every pix-* package that renders via the icon catalog. This command
 * is the single switch — an overlay that previews each mode's glyphs live and
 * persists the choice to ~/.pi/agent/pretty.json. Headless hosts get a notify
 * fallback that cycles the mode without UI.
 */

import {
	getIconMode,
	ICON_MODES,
	type IconKey,
	type IconMode,
	icon,
	setIconMode,
} from "../icon-catalog.js";
import { saveIconMode } from "../icon-persist.js";
import { frameLines } from "../modal-frame.js";
import type { CommandContextLike, PiPrettyApi } from "../types.js";

/** Sample keys shown in the preview, one row per representative role. */
const PREVIEW: { key: IconKey; label: string }[] = [
	{ key: "model", label: "model" },
	{ key: "cwd", label: "cwd" },
	{ key: "lsp", label: "lsp" },
	{ key: "paste.image", label: "paste" },
	{ key: "opt.caveman", label: "optimizer" },
];

/** Apply + persist a mode in one step. */
function applyMode(mode: IconMode): void {
	setIconMode(mode);
	saveIconMode(mode);
}

export function registerPrettyCommand(pi: PiPrettyApi): void {
	pi.registerCommand("pretty", {
		description: "pix-pretty: switch icon style (nerd / unicode / ascii)",
		handler: async (_args: string, ctx: CommandContextLike) => {
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

			// Headless / no custom-UI host: cycle to the next mode + notify.
			if (typeof ui.custom !== "function") {
				const cur = ICON_MODES.indexOf(getIconMode());
				const next = ICON_MODES[(cur + 1) % ICON_MODES.length] ?? "nerd";
				applyMode(next);
				ui.notify(`pix-pretty icons: ${next}`, "info");
				return;
			}

			const boxW = 40;

			await ui.custom<null>(
				(
					tui: { requestRender(): void },
					theme: typeof ui.theme,
					_kb: unknown,
					done: (v: null) => void,
				) => {
					let selected = ICON_MODES.indexOf(getIconMode());
					if (selected < 0) selected = 0;

					const choose = (i: number) => {
						selected = (i + ICON_MODES.length) % ICON_MODES.length;
						applyMode(ICON_MODES[selected] ?? "nerd");
					};

					return {
						render: () => {
							const rows = ICON_MODES.map((mode, i) => {
								const sel = i === selected;
								const cursor = sel ? theme.fg("accent", "→") : " ";
								const name = theme.fg(sel ? "accent" : "text", mode.padEnd(8));
								// Live preview: render the sample glyphs in THIS mode.
								const prev = ICON_MODES[i] === getIconMode();
								const samples = prev ? PREVIEW.map((p) => icon(p.key)).join(" ") : "";
								return `${cursor} ${name} ${theme.fg("dim", samples)}`;
							});
							const lines = [
								theme.fg("accent", theme.bold("  Icon style")),
								"",
								...rows,
								"",
								theme.fg("dim", "↑↓ select · esc close"),
							];
							return frameLines({
								width: boxW,
								lines,
								color: (s) => theme.fg("accent", s),
								bg: (s) => theme.bg("customMessageBg", s),
							});
						},
						invalidate: () => {},
						handleInput: (data: string) => {
							if (data === "k" || data === "\u001b[A") choose(selected - 1);
							else if (data === "j" || data === "\u001b[B") choose(selected + 1);
							else if (data === "\u001b" || data === "q" || data === "\r") {
								done(null);
								return;
							} else return;
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: boxW, maxHeight: "60%" },
				},
			);
		},
	});
}
