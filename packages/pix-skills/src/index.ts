/**
 * pix-skills — skill loader extension
 *
 * Registers a `skill` tool that lets the agent load any bundled skill's
 * full SKILL.md (or flat .md) by name. This is the safe "agent prompts itself"
 * pattern: the agent calls the tool explicitly; no autonomous injection.
 *
 * Also bundles the skills folder so pi auto-loads skill descriptions into the
 * system prompt at startup (names + descriptions only — full content on demand).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ─── Skill resolution ─────────────────────────────────────────────────────────

/** Absolute path to this package's skills/ directory. */
function skillsRoot(): string {
	const here = fileURLToPath(new URL(".", import.meta.url));
	return resolve(here, "..", "skills");
}

interface SkillEntry {
	name: string;
	/** Absolute path to the SKILL.md or flat .md file. */
	path: string;
}

/**
 * Discover all skills from the package's skills/ directory.
 * Supports two layouts:
 *   - flat:     skills/commit.md
 *   - subdir:   skills/commit/SKILL.md
 */
function discoverSkills(): SkillEntry[] {
	const root = skillsRoot();
	if (!existsSync(root)) return [];

	const entries: SkillEntry[] = [];

	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			// Subdirectory layout: skills/<name>/SKILL.md
			const skillMd = join(root, entry.name, "SKILL.md");
			if (existsSync(skillMd)) {
				entries.push({ name: entry.name, path: skillMd });
			}
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			// Flat layout: skills/<name>.md
			const name = entry.name.replace(/\.md$/, "");
			entries.push({ name, path: join(root, entry.name) });
		}
	}

	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Extract the `description` from YAML frontmatter, or null. */
function extractDescription(content: string): string | null {
	const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!m) return null;
	const dm = m[1]!.match(/^description\s*:\s*["']?(.+?)["']?\s*$/m);
	return dm ? dm[1]!.trim() : null;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const ParamsSchema = Type.Object({
	name: Type.Optional(
		Type.String({
			description:
				'Skill name, e.g. "commit", "debug". Omit to list all skills.',
		}),
	),
	full: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"When true, return the full SKILL.md content. When false (default), return the description only.",
		}),
	),
});

export default function registerSkillLoader(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "skill",
		label: "Read Skill",
		description:
			"Browse and load bundled skills. No args → list all skills with descriptions. name only → description for that skill. name + full=true → full instructions.",
		promptSnippet: "Browse and load bundled skill instructions",
		promptGuidelines: [
			"Call skill() with no arguments to list all available skills and their descriptions.",
			"Call skill(name=<skill>) to read the description of a specific skill before deciding to load it.",
			"Call skill(name=<skill>, full=true) to load the full procedure for a skill before executing it.",
			"Prefer skill() over the read tool for skills — it resolves the correct path regardless of install location.",
		],
		executionMode: "sequential",
		parameters: ParamsSchema,

		async execute(_toolCallId, params, _signal) {
			const ok = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: undefined,
			});
			const fail = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: undefined,
				isError: true,
			});

			const { name, full } = params as { name?: string; full?: boolean };

			// No name → list all skills
			if (!name) {
				const skills = discoverSkills();
				if (!skills.length) return ok("No skills found.");

				const lines = skills.map((s) => {
					try {
						const content = readFileSync(s.path, "utf-8");
						const desc = extractDescription(content);
						return desc ? `${s.name}: ${desc}` : s.name;
					} catch {
						return s.name;
					}
				});

				return ok(
					`Available skills (${skills.length}):\n\n${lines.join("\n")}`,
				);
			}

			// Resolve skill
			const skills = discoverSkills();
			const entry = skills.find(
				(s) => s.name === name || s.name === name.replace(/\.md$/, ""),
			);

			if (!entry) {
				const names = skills.map((s) => s.name).join(", ");
				return fail(
					`Skill "${name}" not found. Available: ${names || "(none)"}`,
				);
			}

			try {
				const content = readFileSync(entry.path, "utf-8");

				// full=false (default) → description only
				if (!full) {
					const desc = extractDescription(content);
					return ok(
						desc ? `${entry.name}: ${desc}` : `${entry.name}: (no description)`,
					);
				}

				// full=true → entire file
				return ok(content);
			} catch (err) {
				return fail(
					`Failed to read skill "${name}": ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		},

		renderCall(args, theme) {
			const { name, full } = args as { name?: string; full?: boolean };
			const label = name ? `${name}${full ? " (full)" : ""}` : "list";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("skill"))} ${theme.fg("muted", label)}`,
				0,
				0,
			);
		},
	});
}
