import { describe, expect, it } from "bun:test";

import {
	extractDescription,
	extractName,
	formatSkillSummary,
	type ThemeLike,
} from "./index.ts";

// Stub theme tags fragments so assertions verify which color/bold applied
// without depending on real ANSI codes.
const tagTheme: ThemeLike = {
	fg: (key, text) => `[${key}]${text}[/]`,
	bold: (text) => `<b>${text}</b>`,
};

const FRONTMATTER = `---
name: commit
description: Split, write, and maintain commits.
---
# Commit Directive
body...`;

describe("extractName", () => {
	it("reads name from YAML frontmatter", () => {
		expect(extractName(FRONTMATTER)).toBe("commit");
	});

	it("strips surrounding quotes", () => {
		expect(extractName('---\nname: "debug"\n---\n')).toBe("debug");
	});

	it("returns null when no frontmatter", () => {
		expect(extractName("# Just a heading")).toBeNull();
	});

	it("returns null when frontmatter lacks a name", () => {
		expect(extractName("---\ndescription: x\n---\n")).toBeNull();
	});
});

describe("extractDescription", () => {
	it("reads description from frontmatter", () => {
		expect(extractDescription(FRONTMATTER)).toBe(
			"Split, write, and maintain commits.",
		);
	});

	it("returns null when absent", () => {
		expect(extractDescription("---\nname: x\n---\n")).toBeNull();
	});

	it("returns null when no frontmatter", () => {
		expect(extractDescription("plain text")).toBeNull();
	});
});

describe("formatSkillSummary", () => {
	it("renders muted placeholder for empty input", () => {
		expect(formatSkillSummary("", tagTheme)).toBe("[muted]No skills found.[/]");
	});

	it("renders single skill as bold-accent name + muted description", () => {
		const out = formatSkillSummary(FRONTMATTER, tagTheme);
		expect(out).toBe(
			"[accent]<b>commit</b>[/] [muted]Split, write, and maintain commits.[/]",
		);
	});

	it("falls back to (no description) when frontmatter has name only", () => {
		const out = formatSkillSummary("---\nname: solo\n---\n", tagTheme);
		expect(out).toBe("[accent]<b>solo</b>[/] [muted](no description)[/]");
	});

	it("renders a list of 'name: desc' lines, each colored", () => {
		const list = "commit: write commits\ndebug: root cause analysis";
		const out = formatSkillSummary(list, tagTheme);
		const lines = out.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe("[accent]<b>commit</b>[/] [muted]write commits[/]");
		expect(lines[1]).toBe(
			"[accent]<b>debug</b>[/] [muted]root cause analysis[/]",
		);
	});

	it("passes non 'name: desc' lines through as muted", () => {
		const out = formatSkillSummary("Available skills (3):", tagTheme);
		expect(out).toBe("[muted]Available skills (3):[/]");
	});
});
