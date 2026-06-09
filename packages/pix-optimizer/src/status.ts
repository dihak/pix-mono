/**
 * status.ts — shared status-bar indicator for the optimizer suite.
 *
 * caveman / rtk / json each toggle independently, but they're all the same
 * class of thing (token-optimization tools), so they share ONE status cell
 * instead of three. Each tool reports its on/off state into a single registry;
 * the cell renders only the icons whose tool is currently enabled, in a fixed
 * order, accent-colored. When everything is off the cell is empty.
 *
 *   all on:        ⛏ ⚔ ✂
 *   caveman off:   ⚔ ✂
 *   all off:       (empty)
 */

import type {
	ExtensionCommandContext,
	ExtensionContext,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";

/** Argument-completion item shape used by the merged /opt command. */
export interface CompletionItem {
	value: string;
	label: string;
	description: string;
}

/**
 * Each optimizer tool (caveman/rtk/json) exposes a handle so the single `/opt`
 * router can dispatch subcommands to it without knowing its internals.
 */
export interface OptimizerHandle {
	/** Subcommand name, e.g. "caveman" / "rtk" / "toon". */
	name: OptimizerTool;
	/** One-line help shown by `/opt` with no args. */
	help: string;
	/** Handle `/opt <name> <args>`. `args` is everything after the name. */
	run(args: string, ctx: ExtensionCommandContext): Promise<void> | void;
	/** Completions for the second token (`/opt <name> <prefix>`). */
	complete(prefix: string): CompletionItem[] | null;
}

/** Stable status-bar key shared by every optimizer tool. */
export const STATUS_KEY = "pix-optimizer";

/** Tools that participate in the shared indicator, in render order. */
export type OptimizerTool = "caveman" | "rtk" | "toon";

export const TOOL_ICONS: Record<OptimizerTool, string> = {
	caveman: "⛏",
	rtk: "⚔",
	toon: "✂",
};

/** Fixed left-to-right order of icons in the cell. */
export const TOOL_ORDER: readonly OptimizerTool[] = ["caveman", "rtk", "toon"];

/** Theme color for enabled icons. */
export const ENABLED_COLOR: ThemeColor = "accent";
/** Theme color for disabled icons. */
export const DISABLED_COLOR: ThemeColor = "dim";

/** Colorizer: maps a (theme color, text) pair to a rendered string. */
export type Colorize = (color: ThemeColor, text: string) => string;

/**
 * Build the colored status string for a set of tool states. ALL tool icons are
 * always shown, in TOOL_ORDER; each is accent-colored when its tool is enabled
 * and dim when disabled. `color` applies the theme color (e.g. theme.fg).
 *
 * Pure + exported for tests (pass a tagging colorizer to assert per-icon color).
 * A trailing space separates the cell from the next status segment.
 */
export function renderStatus(
	states: Partial<Record<OptimizerTool, boolean>>,
	color: Colorize,
): string {
	return `${TOOL_ORDER.map((t) =>
		color(states[t] === true ? ENABLED_COLOR : DISABLED_COLOR, TOOL_ICONS[t]),
	).join("  ")} `;
}

/**
 * Shared registry: each tool calls `set(tool, enabled)` whenever its state
 * changes, then the combined cell is re-rendered. A single registry instance
 * is created per extension load and passed to caveman/rtk/json.
 */
export class OptimizerStatus {
	private states: Partial<Record<OptimizerTool, boolean>> = {};

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
		const text = renderStatus(this.states, (c, t) => ctx.ui.theme.fg(c, t));
		ctx.ui.setStatus(STATUS_KEY, text);
	}
}
