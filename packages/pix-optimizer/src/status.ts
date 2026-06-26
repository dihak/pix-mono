/**
 * status.ts — shared status-bar indicator for the optimizer suite.
 *
 * caveman / rtk / toon / ponytail each toggle independently, but they're all the same
 * class of thing (token-optimization tools), so they share ONE status cell
 * instead of three. Each tool reports its on/off state into a single registry;
 * the cell renders ALL four icons in a fixed order — accent-colored when the
 * tool is enabled, dim when disabled. The cell is never empty.
 *
 *   all on:        all four accent
 *   caveman off:   caveman dim, rest accent
 *   all off:       all four dim
 */

import type {
	ExtensionCommandContext,
	ExtensionContext,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";

/**
 * Each optimizer tool (caveman/rtk/toon/ponytail) exposes a handle so the
 * single `/optimizer` overlay can render one row per tool and apply value
 * changes without knowing the tool's internals.
 */
export interface OptimizerHandle {
	/** Tool name, e.g. "caveman" / "rtk" / "toon". */
	name: OptimizerTool;
	/** One-line summary shown in the overlay row. */
	help: string;
	/** Cyclable values for this tool's overlay row, in display order. */
	values: readonly string[];
	/** Current value string (must be one of `values`). */
	current(): string;
	/** Apply a chosen value (persists + repaints status). `value` is one of `values`. */
	run(value: string, ctx: ExtensionCommandContext): Promise<void> | void;
}

/** Stable status-bar key shared by every optimizer tool. */
export const STATUS_KEY = "pix-optimizer";

/** Tools that participate in the shared indicator, in render order. */
export type OptimizerTool = "caveman" | "rtk" | "toon" | "ponytail";

/**
 * Icon presentation modes. The optimizer cell defaults to Nerd Font glyphs,
 * which require a patched font (e.g. MesloLGS NF). Terminals without one show
 * missing-glyph tofu, so two font-independent fallbacks are offered:
 *   - `unicode`: outline playing-card suits (standard BMP, ships with virtually
 *     every monospace font) + U+FE0E to force text (non-emoji) presentation.
 *   - `ascii`: two-letter labels, renders on literally any terminal.
 * Mode is chosen via the /optimizer menu (persisted) or the OPTIMIZER_ICONS /
 * PRETTY_ICONS env vars.
 */
export type IconMode = "nerd" | "unicode" | "ascii";

/** All selectable icon modes, in /optimizer cycle order. */
export const ICON_MODES: readonly IconMode[] = ["nerd", "unicode", "ascii"];

/** Force text (non-emoji) presentation for symbols that default to emoji. */
const VS_TEXT = "\uFE0E";

/** Per-mode glyph table for each tool. */
const ICON_SETS: Record<IconMode, Record<OptimizerTool, string>> = {
	nerd: {
		caveman: "󰜐",
		rtk: "󰓥",
		toon: "󰗀",
		ponytail: "󰆐",
	},
	unicode: {
		caveman: `\u2664${VS_TEXT}`, // ♤ white spade
		rtk: `\u2661${VS_TEXT}`, // ♡ white heart
		toon: `\u2662${VS_TEXT}`, // ♢ white diamond
		ponytail: `\u2667${VS_TEXT}`, // ♧ white club
	},
	ascii: {
		caveman: "Cv",
		rtk: "Rk",
		toon: "Tn",
		ponytail: "Pt",
	},
};

/** Resolve the glyph table for a mode. */
export function getIcons(mode: IconMode): Record<OptimizerTool, string> {
	return ICON_SETS[mode] ?? ICON_SETS.nerd;
}

/**
 * Default icon mode from the environment. OPTIMIZER_ICONS takes precedence;
 * PRETTY_ICONS=none|off maps to ascii so one stack-wide var disables glyphs.
 * Anything unrecognized (or unset) falls back to `nerd`. A persisted menu
 * choice overrides this at load time (see persist.loadIconMode).
 */
export function envIconMode(): IconMode {
	const raw = (process.env.OPTIMIZER_ICONS ?? "").toLowerCase();
	if (raw === "nerd" || raw === "unicode" || raw === "ascii") return raw;
	const pretty = (process.env.PRETTY_ICONS ?? "").toLowerCase();
	if (pretty === "none" || pretty === "off") return "ascii";
	return "nerd";
}

/**
 * Default Nerd Font glyph table. Kept as a named export for back-compat with
 * callers/tests that reference the nerd set directly; equivalent to
 * getIcons("nerd").
 */
export const TOOL_ICONS: Record<OptimizerTool, string> = ICON_SETS.nerd;

/** Fixed left-to-right order of icons in the cell. */
const TOOL_ORDER: readonly OptimizerTool[] = [
	"caveman",
	"rtk",
	"toon",
	"ponytail",
];

/** Theme color for enabled icons. */
const ENABLED_COLOR: ThemeColor = "accent";
/** Theme color for disabled icons. */
const DISABLED_COLOR: ThemeColor = "dim";

/** Colorizer: maps a (theme color, text) pair to a rendered string. */
export type Colorize = (color: ThemeColor, text: string) => string;

/**
 * Build the colored status string for a set of tool states. ALL tool icons are
 * always shown, in TOOL_ORDER; each is accent-colored when its tool is enabled
 * and dim when disabled. `color` applies the theme color (e.g. theme.fg).
 * `mode` selects the glyph table (nerd / unicode / ascii); defaults to nerd.
 *
 * Pure + exported for tests (pass a tagging colorizer to assert per-icon color).
 * A trailing space separates the cell from the next status segment.
 */
export function renderStatus(
	states: Partial<Record<OptimizerTool, boolean>>,
	color: Colorize,
	mode: IconMode = "nerd",
): string {
	const icons = getIcons(mode);
	return `${TOOL_ORDER.map((t) =>
		color(states[t] === true ? ENABLED_COLOR : DISABLED_COLOR, icons[t]),
	).join("  ")} `;
}

/**
 * Shared registry: each tool calls `set(tool, enabled)` whenever its state
 * changes, then the combined cell is re-rendered. A single registry instance
 * is created per extension load and passed to caveman/rtk/json.
 */
export class OptimizerStatus {
	private states: Partial<Record<OptimizerTool, boolean>> = {};
	private iconMode: IconMode;

	/** `mode` seeds the icon set (persisted choice or env default). */
	constructor(mode: IconMode = "nerd") {
		this.iconMode = mode;
	}

	/** Current enabled state for one tool (undefined until first set). */
	get(tool: OptimizerTool): boolean | undefined {
		return this.states[tool];
	}

	/** Current icon presentation mode. */
	get mode(): IconMode {
		return this.iconMode;
	}

	/** Switch icon mode and repaint the shared cell. */
	setMode(mode: IconMode, ctx: Pick<ExtensionContext, "ui">): void {
		this.iconMode = mode;
		this.paint(ctx);
	}

	/** Update one tool's enabled state and repaint the shared cell. */
	set(
		tool: OptimizerTool,
		enabled: boolean,
		ctx: Pick<ExtensionContext, "ui">,
	): void {
		this.states[tool] = enabled;
		this.paint(ctx);
	}

	/** Repaint the shared cell from current states. */
	paint(ctx: Pick<ExtensionContext, "ui">): void {
		const text = renderStatus(
			this.states,
			(c, t) => ctx.ui.theme.fg(c, t),
			this.iconMode,
		);
		ctx.ui.setStatus(STATUS_KEY, text);
	}
}
