/**
 * hotkeys.ts — enhanced /hotkeys overlay.
 *
 * Replaces Pi's built-in /hotkeys (a static markdown dump into chat) with an
 * interactive, grouped, scrollable modal overlay in the same visual language as
 * the model picker: rounded frame, accent header + icon, muted separators, a
 * footer hint line.
 *
 * Key displays and extension shortcuts come from the host internals stashed on
 * globalThis by the /hotkeys submit-intercept patch (see patch-builtin.ts). If
 * the stash is missing (e.g. read-only host install where the patch couldn't
 * apply), we fall back to the pi-tui global keybindings manager for core keys
 * and simply omit the Extensions section.
 */

import { icon } from "@dihak/pix-pretty/icon-catalog";
import { frameLines, modalWidth } from "@dihak/pix-pretty/modal-frame";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { HOTKEYS_STASH_KEY } from "./patch-builtin.ts";

// ─── Key display formatting (replicates host keybinding-hints.formatKeyText) ──

/**
 * Capitalize a single key part, mapping alt→option on macOS to match the host.
 * "ctrl" → "Ctrl", "alt" → "Option" (darwin) / "Alt" (else).
 */
export function formatKeyPart(part: string, platform: string = process.platform): string {
	const display = platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part;
	return display.charAt(0).toUpperCase() + display.slice(1);
}

/**
 * Format a keybinding string for display: capitalize each part, keep `+`
 * chords and `/` alternates intact. "ctrl+l" → "Ctrl+L", "up/ctrl+p" →
 * "Up/Ctrl+P". Empty input → "" (caller decides how to render an unbound key).
 */
export function formatKeyText(key: string, platform: string = process.platform): string {
	if (!key) return "";
	return key
		.split("/")
		.map((chord) =>
			chord
				.split("+")
				.map((part) => formatKeyPart(part, platform))
				.join("+"),
		)
		.join("/");
}

// ─── Keybinding source ────────────────────────────────────────────────────────

/** Minimal shape we need from a keybindings manager: id → display keys. */
export interface KeyLookup {
	getKeys(id: string): string[];
}

interface HotkeysStash {
	extensionRunner?: {
		getShortcuts(resolved: unknown): Map<string, { description?: string; extensionPath: string }>;
	};
	keybindings?: KeyLookup & { getEffectiveConfig?(): unknown };
}

/** Read the host internals the patch stashed on globalThis (may be absent). */
function readStash(): HotkeysStash {
	const g = globalThis as Record<string, unknown>;
	const stash = g[HOTKEYS_STASH_KEY];
	return (stash as HotkeysStash) ?? {};
}

/** Display keys for an action, formatted; "" when unbound. */
function keyDisplay(lookup: KeyLookup, id: string): string {
	const keys = lookup.getKeys(id) ?? [];
	return formatKeyText(keys.join("/"));
}

// ─── Row model (pure, exported for tests) ─────────────────────────────────────

export interface HotkeyRow {
	/** Formatted key display, e.g. "Ctrl+L". Empty string when unbound. */
	keys: string;
	/** Human action description. */
	action: string;
}

export interface HotkeySection {
	title: string;
	rows: HotkeyRow[];
}

/** Editor/app action ids grouped exactly like the host's built-in /hotkeys. */
const NAVIGATION: Array<[string, string]> = [
	["tui.editor.cursorUp", "Move cursor up / history"],
	["tui.editor.cursorDown", "Move cursor down / history"],
	["tui.editor.cursorLeft", "Move cursor left"],
	["tui.editor.cursorRight", "Move cursor right"],
	["tui.editor.cursorWordLeft", "Move by word left"],
	["tui.editor.cursorWordRight", "Move by word right"],
	["tui.editor.cursorLineStart", "Start of line"],
	["tui.editor.cursorLineEnd", "End of line"],
	["tui.editor.jumpForward", "Jump forward to character"],
	["tui.editor.jumpBackward", "Jump backward to character"],
	["tui.editor.pageUp", "Scroll page up"],
	["tui.editor.pageDown", "Scroll page down"],
];

const EDITING: Array<[string, string]> = [
	["tui.input.submit", "Send message"],
	["tui.input.newLine", "New line"],
	["tui.editor.deleteWordBackward", "Delete word backwards"],
	["tui.editor.deleteWordForward", "Delete word forwards"],
	["tui.editor.deleteToLineStart", "Delete to start of line"],
	["tui.editor.deleteToLineEnd", "Delete to end of line"],
	["tui.editor.yank", "Paste last-deleted text"],
	["tui.editor.yankPop", "Cycle deleted text after paste"],
	["tui.editor.undo", "Undo"],
];

const OTHER: Array<[string, string]> = [
	["tui.input.tab", "Path completion / accept autocomplete"],
	["app.interrupt", "Cancel autocomplete / abort streaming"],
	["app.clear", "Clear editor (first) / exit (second)"],
	["app.exit", "Exit (when editor is empty)"],
	["app.suspend", "Suspend to background"],
	["app.thinking.cycle", "Cycle thinking level"],
	["app.model.cycleForward", "Cycle model forward"],
	["app.model.cycleBackward", "Cycle model backward"],
	["app.model.select", "Open model selector"],
	["app.tools.expand", "Toggle tool output expansion"],
	["app.thinking.toggle", "Toggle thinking block visibility"],
	["app.editor.external", "Edit message in external editor"],
	["app.message.copy", "Copy last assistant message"],
	["app.message.followUp", "Queue follow-up message"],
	["app.message.dequeue", "Restore queued messages"],
	["app.clipboard.pasteImage", "Paste image or text from clipboard"],
];

/** Literal (non-keybound) trigger rows appended to the Other section. */
const LITERAL_OTHER: HotkeyRow[] = [
	{ keys: "/", action: "Slash commands" },
	{ keys: "!", action: "Run bash command" },
	{ keys: "!!", action: "Run bash command (excluded from context)" },
];

/**
 * Build the grouped hotkey sections from a key lookup and optional extension
 * shortcuts. Pure — no globals, no host access — so it is fully unit-testable.
 * Rows whose key is unbound still render (with an em-dash) so the action list
 * stays complete and matches the built-in's coverage.
 */
export function buildHotkeySections(
	lookup: KeyLookup,
	extensionShortcuts?: Map<string, { description?: string; extensionPath: string }>,
): HotkeySection[] {
	const toRows = (pairs: Array<[string, string]>): HotkeyRow[] =>
		pairs.map(([id, action]) => ({ keys: keyDisplay(lookup, id), action }));

	const sections: HotkeySection[] = [
		{ title: "Navigation", rows: toRows(NAVIGATION) },
		{ title: "Editing", rows: toRows(EDITING) },
		{ title: "Other", rows: [...toRows(OTHER), ...LITERAL_OTHER] },
	];

	if (extensionShortcuts && extensionShortcuts.size > 0) {
		const rows: HotkeyRow[] = [];
		for (const [key, shortcut] of extensionShortcuts) {
			rows.push({
				keys: formatKeyText(key),
				action: shortcut.description ?? shortcut.extensionPath,
			});
		}
		sections.push({ title: "Extensions", rows });
	}

	return sections;
}

// ─── Flattened render lines ───────────────────────────────────────────────────

/** One physical line in the scroll viewport: a section header or a key row. */
export type FlatLine =
	| { kind: "header"; title: string }
	| { kind: "row"; keys: string; action: string }
	| { kind: "gap" };

/**
 * Flatten sections into a scrollable line list with blank gaps between groups.
 * A leading gap is never emitted; gaps only separate sections.
 */
export function flattenSections(sections: HotkeySection[]): FlatLine[] {
	const lines: FlatLine[] = [];
	for (const section of sections) {
		if (lines.length > 0) lines.push({ kind: "gap" });
		lines.push({ kind: "header", title: section.title });
		for (const row of section.rows) {
			lines.push({ kind: "row", keys: row.keys, action: row.action });
		}
	}
	return lines;
}

/** Widest formatted key cell across all row lines (for column alignment). */
export function keyColumnWidth(lines: FlatLine[]): number {
	let w = 0;
	for (const l of lines) {
		if (l.kind === "row") w = Math.max(w, visibleWidth(l.keys || "—"));
	}
	return w;
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

async function showHotkeysOverlay(ctx: ExtensionContext): Promise<void> {
	const stash = readStash();
	// Prefer the host's stashed keybindings manager (honors user remaps loaded
	// by the running session); fall back to the pi-tui global singleton.
	const lookup: KeyLookup = stash.keybindings ?? getKeybindings();

	let extensionShortcuts: Map<string, { description?: string; extensionPath: string }> | undefined;
	try {
		if (stash.extensionRunner && stash.keybindings?.getEffectiveConfig) {
			extensionShortcuts = stash.extensionRunner.getShortcuts(
				stash.keybindings.getEffectiveConfig(),
			);
		}
	} catch {
		// getShortcuts can throw on a stale runner after reload — skip the section.
		extensionShortcuts = undefined;
	}

	const sections = buildHotkeySections(lookup, extensionShortcuts);
	const flat = flattenSections(sections);
	const keyW = keyColumnWidth(flat);

	await ctx.ui.custom<null>(
		(tui, theme, _kb, done) => {
			const accent = "accent";
			const mute = (s: string) => theme.fg("muted", s);

			// Scroll state over the flattened lines.
			let top = 0;

			// Render one flat line into a styled string for the given inner width.
			const renderLine = (line: FlatLine): string => {
				if (line.kind === "gap") return "";
				if (line.kind === "header") {
					return theme.fg(accent, theme.bold(line.title));
				}
				const rawKeys = line.keys || "—";
				const keyCell = line.keys
					? theme.fg("success", rawKeys.padEnd(keyW))
					: theme.fg("dim", "—".padEnd(keyW));
				return `  ${keyCell}${mute("  ")}${theme.fg("text", line.action)}`;
			};

			return {
				render(w: number) {
					const mw = modalWidth(w);
					const inner = mw - 4; // 2 border + 2 padding
					// Reserve header (2), footer (1) inside the frame; rest is the viewport.
					const viewport = Math.max(4, Math.min(flat.length, 16));
					const maxTop = Math.max(0, flat.length - viewport);
					if (top > maxTop) top = maxTop;

					const visible = flat.slice(top, top + viewport);
					const body = visible.map(renderLine);

					const scrollHint =
						flat.length > viewport
							? theme.fg("dim", `  ${top + 1}\u2013${top + viewport} of ${flat.length}`)
							: "";

					const lines: string[] = [
						theme.fg(accent, theme.bold(`${icon("picker.hotkeys")}  Keyboard shortcuts`)),
						theme.fg("dim", "grouped bindings \u00b7 honors your keybindings.json remaps"),
						...body,
					];
					if (scrollHint) lines.push(scrollHint);
					lines.push(theme.fg("dim", "\u2191\u2193 scroll \u00b7 pgup/pgdn page \u00b7 esc close"));

					// Fix inner width so the frame doesn't jitter as content scrolls.
					void inner;
					return frameLines({
						width: mw,
						lines,
						color: (s) => theme.fg(accent, s),
						bg: (s) => theme.bg("customMessageBg", s),
					});
				},
				invalidate() {},
				handleInput(data: string) {
					const viewport = Math.max(4, Math.min(flat.length, 16));
					const maxTop = Math.max(0, flat.length - viewport);
					if (matchesKey(data, "up")) {
						top = Math.max(0, top - 1);
					} else if (matchesKey(data, "down")) {
						top = Math.min(maxTop, top + 1);
					} else if (matchesKey(data, Key.pageUp)) {
						top = Math.max(0, top - viewport);
					} else if (matchesKey(data, Key.pageDown)) {
						top = Math.min(maxTop, top + viewport);
					} else if (matchesKey(data, "home")) {
						top = 0;
					} else if (matchesKey(data, "end")) {
						top = maxTop;
					} else if (
						matchesKey(data, "escape") ||
						matchesKey(data, "enter") ||
						matchesKey(data, "q")
					) {
						done(null);
						return;
					}
					tui.requestRender();
				},
			};
		},
		{ overlay: true },
	);
}

// ─── Registration ─────────────────────────────────────────────────────────────

export default function hotkeysExtension(pi: ExtensionAPI): void {
	const handler = async (_args: unknown, ctx: ExtensionContext) => {
		await showHotkeysOverlay(ctx);
	};
	pi.registerCommand("hotkeys", {
		description: "Show all keyboard shortcuts",
		handler: handler as Parameters<ExtensionAPI["registerCommand"]>[1]["handler"],
	});
}
