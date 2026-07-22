import { describe, expect, it } from "bun:test";
import {
	buildHotkeySections,
	flattenSections,
	formatKeyPart,
	formatKeyText,
	type KeyLookup,
	keyColumnWidth,
} from "./hotkeys.ts";

/** Fake keybindings manager backed by a plain id→keys map. */
function lookupFrom(map: Record<string, string[]>): KeyLookup {
	return { getKeys: (id) => map[id] ?? [] };
}

describe("formatKeyPart", () => {
	it("capitalizes a part", () => {
		expect(formatKeyPart("ctrl")).toBe("Ctrl");
		expect(formatKeyPart("l")).toBe("L");
	});

	it("maps alt→Option on darwin only", () => {
		expect(formatKeyPart("alt", "darwin")).toBe("Option");
		expect(formatKeyPart("alt", "linux")).toBe("Alt");
	});
});

describe("formatKeyText", () => {
	it("capitalizes chord parts and keeps + / intact", () => {
		expect(formatKeyText("ctrl+l", "linux")).toBe("Ctrl+L");
		expect(formatKeyText("up/ctrl+p", "linux")).toBe("Up/Ctrl+P");
	});

	it("returns empty string for an unbound key", () => {
		expect(formatKeyText("", "linux")).toBe("");
	});
});

describe("buildHotkeySections", () => {
	const lookup = lookupFrom({
		"tui.editor.cursorUp": ["up"],
		"app.model.select": ["ctrl+l"],
		"tui.input.submit": ["enter"],
	});

	it("produces Navigation, Editing, Other in order", () => {
		const sections = buildHotkeySections(lookup);
		expect(sections.map((s) => s.title)).toEqual(["Navigation", "Editing", "Other"]);
	});

	it("formats bound keys and blanks unbound ones", () => {
		const sections = buildHotkeySections(lookup);
		const nav = sections.find((s) => s.title === "Navigation")!;
		const up = nav.rows.find((r) => r.action.startsWith("Move cursor up"))!;
		expect(up.keys).toBe("Up");
		// An action with no binding in the fake lookup renders empty keys.
		const left = nav.rows.find((r) => r.action === "Move cursor left")!;
		expect(left.keys).toBe("");
	});

	it("includes literal trigger rows in Other", () => {
		const sections = buildHotkeySections(lookup);
		const other = sections.find((s) => s.title === "Other")!;
		expect(other.rows.some((r) => r.keys === "/" && r.action === "Slash commands")).toBe(true);
		expect(other.rows.some((r) => r.keys === "!!")).toBe(true);
	});

	it("omits the Extensions section when there are no shortcuts", () => {
		expect(buildHotkeySections(lookup).some((s) => s.title === "Extensions")).toBe(false);
		expect(buildHotkeySections(lookup, new Map()).some((s) => s.title === "Extensions")).toBe(
			false,
		);
	});

	it("adds an Extensions section from shortcuts, using description then path", () => {
		const shortcuts = new Map([
			["alt+m", { description: "Send intercom message", extensionPath: "/x/intercom" }],
			["ctrl+g", { extensionPath: "/x/gate" }],
		]);
		const sections = buildHotkeySections(lookup, shortcuts);
		const ext = sections.find((s) => s.title === "Extensions")!;
		expect(ext.rows).toEqual([
			{ keys: "Alt+M", action: "Send intercom message" },
			{ keys: "Ctrl+G", action: "/x/gate" },
		]);
	});
});

describe("flattenSections", () => {
	it("emits header + rows with gaps between groups, no leading gap", () => {
		const flat = flattenSections([
			{ title: "A", rows: [{ keys: "X", action: "ax" }] },
			{ title: "B", rows: [{ keys: "Y", action: "by" }] },
		]);
		expect(flat).toEqual([
			{ kind: "header", title: "A" },
			{ kind: "row", keys: "X", action: "ax" },
			{ kind: "gap" },
			{ kind: "header", title: "B" },
			{ kind: "row", keys: "Y", action: "by" },
		]);
	});
});

describe("keyColumnWidth", () => {
	it("returns the widest key cell width, treating unbound as em-dash width 1", () => {
		const flat = flattenSections([
			{
				title: "A",
				rows: [
					{ keys: "Ctrl+L", action: "a" },
					{ keys: "", action: "b" },
				],
			},
		]);
		expect(keyColumnWidth(flat)).toBe("Ctrl+L".length);
	});
});
