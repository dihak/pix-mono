import { describe, expect, test } from "bun:test";
import {
	buildOrientation,
	CAPABILITY_REMINDER,
	countInvocableSkills,
	partitionTools,
} from "./capability.ts";

// Minimal Skill-shaped fixtures (only fields the builder reads).
const skill = (
	name: string,
	description: string,
	disableModelInvocation = false,
) =>
	({
		name,
		description,
		disableModelInvocation,
		filePath: "",
		baseDir: "",
		sourceInfo: {} as never,
	}) as never;

// Minimal ToolInfo-shaped fixture.
const tool = (name: string, source: string) =>
	({
		name,
		description: `${name} desc.`,
		parameters: {},
		sourceInfo: { source, path: "", scope: "user", origin: "package" },
	}) as never;

describe("CAPABILITY_REMINDER", () => {
	test("is terse — fires every turn, must stay cheap", () => {
		expect(CAPABILITY_REMINDER.split(/\s+/).length).toBeLessThanOrEqual(28);
	});

	test("names the core capability surfaces", () => {
		for (const cap of ["skill", "tool", "MCP", "web", "user"]) {
			expect(CAPABILITY_REMINDER).toContain(cap);
		}
	});

	test("steers away from improvising", () => {
		expect(CAPABILITY_REMINDER.toLowerCase()).toContain("improvis");
	});

	test("points at the toolbox tool for discovery", () => {
		expect(CAPABILITY_REMINDER).toContain("toolbox");
		expect(CAPABILITY_REMINDER).toContain("function definitions");
	});
});

describe("countInvocableSkills", () => {
	test("zero for undefined / empty", () => {
		expect(countInvocableSkills(undefined)).toBe(0);
		expect(countInvocableSkills([])).toBe(0);
	});

	test("excludes user-only skills", () => {
		const n = countInvocableSkills([
			skill("a", "."),
			skill("b", ".", true),
			skill("c", "."),
		]);
		expect(n).toBe(2);
	});
});

describe("partitionTools", () => {
	test("splits MCP-sourced from other tools by source", () => {
		const { mcp, other } = partitionTools([
			tool("read", "builtin"),
			tool("context7-docs", "mcp:context7"),
			tool("notion-search", "MCP server notion"),
			tool("grep", "extension:pix-core"),
		]);
		expect(mcp).toBe(2);
		expect(other).toBe(2);
	});

	test("handles undefined", () => {
		expect(partitionTools(undefined)).toEqual({
			mcp: 0,
			other: 0,
			active: 0,
			gated: 0,
		});
	});

	test("without an active set, every tool counts as active (gated 0)", () => {
		const { active, gated } = partitionTools([
			tool("read", "builtin"),
			tool("ast_grep_search", "builtin"),
		]);
		expect(active).toBe(2);
		expect(gated).toBe(0);
	});

	test("with an active set, splits active vs gated", () => {
		const { active, gated } = partitionTools(
			[
				tool("read", "builtin"),
				tool("grep", "builtin"),
				tool("ast_grep_search", "builtin"),
				tool("ctx_search", "builtin"),
			],
			["read", "grep"],
		);
		expect(active).toBe(2);
		expect(gated).toBe(2);
	});
});

describe("buildOrientation", () => {
	test("summarizes counts of tools, MCP tools, and skills", () => {
		const out = buildOrientation(
			[tool("read", "builtin"), tool("ctx", "mcp:context7")],
			[skill("commit", "Commit changes."), skill("plan", "Plan work.")],
		);
		expect(out).toContain("1 tool");
		expect(out).toContain("1 MCP tool");
		expect(out).toContain("2 skills");
	});

	test("explains how to explore via the toolbox tool", () => {
		const out = buildOrientation([tool("read", "builtin")], []);
		expect(out).toContain("toolbox(query");
		expect(out.toLowerCase()).toMatch(/fuzzy|search|discover/);
	});

	test("calls out gated tools and points at toolbox to enable them", () => {
		const out = buildOrientation(
			[
				tool("read", "builtin"),
				tool("grep", "builtin"),
				tool("ast_grep_search", "builtin"),
				tool("ctx_search", "builtin"),
			],
			[],
			["read", "grep"], // active set: 2 gated out
		);
		expect(out).toContain("2 are gated");
		expect(out).toContain("enable via toolbox");
	});

	test("singular phrasing when exactly one tool is gated", () => {
		const out = buildOrientation(
			[tool("read", "builtin"), tool("ast_grep_search", "builtin")],
			[],
			["read"],
		);
		expect(out).toContain("1 is gated");
		expect(out).toContain("enable via toolbox");
	});

	test("no gate line when nothing is gated", () => {
		const out = buildOrientation(
			[tool("read", "builtin"), tool("grep", "builtin")],
			[],
			["read", "grep"],
		);
		expect(out).not.toContain("gated out of the prompt");
	});

	test("no gate line when active set is unknown", () => {
		const out = buildOrientation(
			[tool("read", "builtin"), tool("ast_grep_search", "builtin")],
			[],
		);
		expect(out).not.toContain("gated out of the prompt");
	});

	test("lists invocable skill names, sorted, excluding user-only", () => {
		const out = buildOrientation(
			[],
			[skill("zebra", "z."), skill("alpha", "a."), skill("hidden", "h.", true)],
		);
		expect(out).toContain("Skills: alpha, zebra.");
		expect(out).not.toContain("hidden");
	});

	test("omits the skills line when no invocable skills", () => {
		const out = buildOrientation(
			[tool("read", "builtin")],
			[skill("x", ".", true)],
		);
		expect(out).not.toContain("Skills:");
	});

	test("steers away from improvising", () => {
		const out = buildOrientation([tool("read", "builtin")], []);
		expect(out.toLowerCase()).toContain("improvis");
	});
});
