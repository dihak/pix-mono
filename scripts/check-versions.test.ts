import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("publish version guard", () => {
	test("allows mixed published and unpublished package versions", () => {
		const source = readFileSync(join(import.meta.dir, "check-versions.ts"), "utf8");

		expect(source).toContain("if (fresh.length === 0)");
		expect(source).not.toContain("if (stale.length > 0)");
	});
});
