import { expect, test } from "bun:test";
import { lastReleaseTagCommand } from "./release-tag.ts";

test("keeps the release-tag match pattern as one git argument", () => {
	expect(lastReleaseTagCommand("HEAD^")).toEqual([
		"describe",
		"--tags",
		"--abbrev=0",
		"--match=release-*",
		"HEAD^",
	]);
});
