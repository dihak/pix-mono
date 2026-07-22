/**
 * Unit tests for Tab → next suggestion (no accept) helpers.
 */

import { describe, expect, it, mock } from "bun:test";
import {
	CSI_ARROW_DOWN,
	CSI_ARROW_UP,
	cycleAutocompleteKey,
	tryCycleAutocomplete,
} from "../src/autocomplete-tab-cycle.js";

describe("cycleAutocompleteKey", () => {
	it("maps next to CSI down", () => {
		expect(cycleAutocompleteKey("next")).toBe(CSI_ARROW_DOWN);
		expect(CSI_ARROW_DOWN).toBe("\x1b[B");
	});

	it("maps prev to CSI up", () => {
		expect(cycleAutocompleteKey("prev")).toBe(CSI_ARROW_UP);
		expect(CSI_ARROW_UP).toBe("\x1b[A");
	});
});

describe("tryCycleAutocomplete", () => {
	function makeEditor(opts: { open: boolean; list?: { handleInput: ReturnType<typeof mock> } }) {
		const list = opts.list ?? { handleInput: mock(() => {}) };
		return {
			editor: {
				isShowingAutocomplete: () => opts.open,
				handleInput: mock(() => {}),
				autocompleteList: opts.open ? list : undefined,
			},
			list,
		};
	}

	it("returns false when menu closed", () => {
		const { editor, list } = makeEditor({ open: false });
		expect(tryCycleAutocomplete(editor, "\t")).toBe(false);
		expect(list.handleInput).not.toHaveBeenCalled();
	});

	it("returns false when list missing", () => {
		const editor = {
			isShowingAutocomplete: () => true,
			handleInput: mock(() => {}),
			autocompleteList: undefined,
		};
		expect(tryCycleAutocomplete(editor, "\t")).toBe(false);
	});

	it("Tab cycles next via CSI down", () => {
		const { editor, list } = makeEditor({ open: true });
		expect(tryCycleAutocomplete(editor, "\t")).toBe(true);
		expect(list.handleInput).toHaveBeenCalledTimes(1);
		expect(list.handleInput).toHaveBeenCalledWith(CSI_ARROW_DOWN);
	});

	it("Shift+Tab cycles prev via CSI up", () => {
		const { editor, list } = makeEditor({ open: true });
		// Legacy shift+tab sequence used by matchesKey("shift+tab")
		expect(tryCycleAutocomplete(editor, "\x1b[Z")).toBe(true);
		expect(list.handleInput).toHaveBeenCalledWith(CSI_ARROW_UP);
	});

	it("ignores unrelated keys while open", () => {
		const { editor, list } = makeEditor({ open: true });
		expect(tryCycleAutocomplete(editor, "a")).toBe(false);
		expect(list.handleInput).not.toHaveBeenCalled();
	});
});
