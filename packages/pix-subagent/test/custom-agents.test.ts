import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCustomAgents } from "../src/custom-agents.ts";
import type { AgentConfig } from "../src/types.ts";

test("loads a project .pi/agents/*.md with frontmatter", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pixsa-"));
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "agents", "scout.md"),
		"---\ndescription: scout the code\ntools: read, grep, find\nmodel: haiku\n---\nYou are a scout.",
	);
	const agents = loadCustomAgents(cwd);
	const scout = agents.get("scout");
	expect(scout?.description).toBe("scout the code");
	expect(new Set(scout?.builtinToolNames)).toEqual(
		new Set(["read", "grep", "find"]),
	);
	expect(scout?.model).toBe("haiku");
	expect(scout?.systemPrompt).toBe("You are a scout.");
});

// ── thinking level validation ────────────────────────────────────────────────

describe("thinking level validation", () => {
	test("valid thinking levels are accepted", () => {
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
			const cwd = mkdtempSync(join(tmpdir(), "pixsa-"));
			mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "agents", "a.md"),
				`---\nthinking: ${level}\n---\nprompt`,
			);
			const agents = loadCustomAgents(cwd);
			const a = agents.get("a");
			expect(a?.thinking).toBe(level as AgentConfig["thinking"]);
			expect(a?.warnings).toBeUndefined();
		}
	});

	test("invalid thinking level → undefined + warning populated", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pixsa-"));
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "bad.md"),
			"---\nthinking: hgih\n---\nprompt",
		);
		const agents = loadCustomAgents(cwd);
		const bad = agents.get("bad");
		expect(bad?.thinking).toBeUndefined();
		expect(bad?.warnings).toBeDefined();
		expect(bad?.warnings?.length).toBe(1);
		expect(bad?.warnings?.[0]).toContain('thinking: "hgih"');
		expect(bad?.warnings?.[0]).toContain("not a valid level");
	});

	test("omitted thinking → undefined, no warning", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pixsa-"));
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "plain.md"),
			"---\ndescription: no thinking\n---\nprompt",
		);
		const agents = loadCustomAgents(cwd);
		const plain = agents.get("plain");
		expect(plain?.thinking).toBeUndefined();
		expect(plain?.warnings).toBeUndefined();
	});
});
