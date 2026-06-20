import { expect, test } from "bun:test";
import {
	BUILTIN_TOOL_NAMES,
	getAvailableTypes,
	getToolNamesForType,
	registerAgents,
} from "../src/agent-types.ts";

test("BUILTIN_TOOL_NAMES is the 7 pi built-ins", () => {
	expect(new Set(BUILTIN_TOOL_NAMES)).toEqual(
		new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]),
	);
});

test("defaults register and Explore is read-only", () => {
	registerAgents(new Map());
	expect(getAvailableTypes()).toEqual(
		expect.arrayContaining(["general-purpose", "Explore", "Plan"]),
	);
	// Explore omits write/edit/bash
	const explore = getToolNamesForType("Explore");
	expect(explore).not.toContain("write");
	expect(explore).not.toContain("edit");
});

test("getToolNamesForType falls back to all built-ins for unknown type", () => {
	registerAgents(new Map());
	expect(new Set(getToolNamesForType("does-not-exist"))).toEqual(
		new Set(BUILTIN_TOOL_NAMES),
	);
});
