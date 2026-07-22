/**
 * autocomplete-tab-cycle — Tab moves highlight in open suggestion list.
 *
 * Pi default: Tab accepts current item. We want shell-like browse:
 *   Tab        → next item
 *   Shift+Tab  → previous item
 *   Enter      → accept (unchanged base Editor)
 *   Tab (menu closed) → open completion (unchanged)
 *
 * Composes with other editor factories via getEditorComponent wrap.
 * Patches handleInput on the constructed instance (no ChipEditor coupling).
 */

import type { ExtensionAPI, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { getKeybindings, matchesKey } from "@earendil-works/pi-tui";

// Same factory shape as paste-chips / ctx.ui.setEditorComponent.
type EditorFactory = (
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => CustomEditor;

/** CSI sequences SelectList maps via default tui.select.up / tui.select.down. */
export const CSI_ARROW_UP = "\x1b[A";
export const CSI_ARROW_DOWN = "\x1b[B";

export type CycleDirection = "next" | "prev";

/** Map cycle direction → key data SelectList already understands. */
export function cycleAutocompleteKey(dir: CycleDirection): string {
	return dir === "next" ? CSI_ARROW_DOWN : CSI_ARROW_UP;
}

// Editor fields used only at runtime (TS marks them private).
type AutocompleteList = { handleInput(keyData: string): void };
type EditorWithAutocomplete = {
	isShowingAutocomplete(): boolean;
	handleInput(data: string): void;
	autocompleteList?: AutocompleteList;
};

/**
 * If menu open and key is Tab / Shift+Tab, move highlight and return true.
 * Pure decision surface for tests + handleInput patch.
 */
export function tryCycleAutocomplete(editor: EditorWithAutocomplete, data: string): boolean {
	if (!editor.isShowingAutocomplete()) return false;

	const list = editor.autocompleteList;
	if (!list) return false;

	const kb = getKeybindings();
	if (kb.matches(data, "tui.input.tab")) {
		list.handleInput(cycleAutocompleteKey("next"));
		return true;
	}
	if (matchesKey(data, "shift+tab")) {
		list.handleInput(cycleAutocompleteKey("prev"));
		return true;
	}
	return false;
}

/** Wrap editor so open-menu Tab cycles instead of accepting. */
export function enableTabCycleAutocomplete(editor: CustomEditor): CustomEditor {
	const target = editor as unknown as EditorWithAutocomplete;
	const baseHandleInput = target.handleInput.bind(target);

	target.handleInput = (data: string) => {
		if (tryCycleAutocomplete(target, data)) return;
		baseHandleInput(data);
	};

	return editor;
}

export default function autocompleteTabCycleExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Wrap whatever factory is already installed (e.g. ChipEditor).
		const previous = ctx.ui.getEditorComponent() as EditorFactory | undefined;

		const factory: EditorFactory = (tui, theme, keybindings) => {
			const editor = previous
				? previous(tui, theme, keybindings)
				: new CustomEditor(tui, theme, keybindings);
			return enableTabCycleAutocomplete(editor);
		};

		ctx.ui.setEditorComponent(factory);
	});

	// Leave restore to packages that own a full editor swap; clearing here would
	// race with paste-chips shutdown and drop ChipEditor mid-session end.
	// session_shutdown on paste-chips restores default for both.
}
