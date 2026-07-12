/**
 * Pure directive logic for skill command interpolation — no pi-tui / runtime
 * deps, so it can be imported by both the skill loader (index.ts) and the
 * startup safety check in pix-welcome.
 *
 * A `!`cmd`` directive embeds live command output into a skill at load time.
 * Safety policy (shared with the bash gate via @xynogen/pix-gate):
 *   - shell metacharacters → unsafe (chaining/expansion)
 *   - matches any pix-gate rule (critical/dangerous/risky) → unsafe
 *   - otherwise → safe to run
 */

import { buildRules, classify, loadUserConfig } from "@xynogen/pix-gate/lib";

export interface CommandDirective {
	start: number;
	end: number;
	command: string;
}

// !`...` not preceded by a backslash; command is single-line, no backticks.
const DIRECTIVE_RE = /(^|[^\\])!`([^`\n]+)`/g;

/** Locate all !`cmd` directives with their source spans (escaped \!`…` skipped). */
export function findCommandDirectives(content: string): CommandDirective[] {
	const hits: CommandDirective[] = [];
	for (const m of content.matchAll(DIRECTIVE_RE)) {
		const lead = m[1] ?? "";
		const start = (m.index ?? 0) + lead.length; // skip the captured lead char
		hits.push({
			start,
			end: start + m[0].length - lead.length,
			command: m[2]?.trim() ?? "",
		});
	}
	return hits;
}

/** Replace the [start, end) slice of `s` with `text`. */
export function replaceSpan(s: string, start: number, end: number, text: string): string {
	return s.slice(0, start) + text + s.slice(end);
}

const SHELL_META_RE = /[;|&$`><(){}\n]/;

/** True when the command contains shell metacharacters (chaining/expansion). */
export function hasShellMeta(command: string): boolean {
	return SHELL_META_RE.test(command);
}

/** Minimal argv tokenizer: whitespace-split with single/double quote support. */
export function tokenizeCommand(command: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const m of command.matchAll(re)) {
		out.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return out;
}

// Built once per process — same rules + user pix-gate.json the bash gate uses.
const gateRules = buildRules(loadUserConfig()).rules;

/**
 * Classify a single directive command against the safety policy.
 * Returns a reason string when the command is UNSAFE, or null when safe.
 */
export function directiveBlockReason(command: string): string | null {
	if (hasShellMeta(command)) {
		return "shell metacharacters not allowed in skill commands";
	}
	const hit = classify(command, gateRules);
	if (hit) return `${hit.severity} — ${hit.reason}`;
	return null;
}

export interface UnsafeDirective {
	command: string;
	reason: string;
}

/** Return every unsafe directive found in a skill's content. */
export function scanUnsafeDirectives(content: string): UnsafeDirective[] {
	const unsafe: UnsafeDirective[] = [];
	for (const d of findCommandDirectives(content)) {
		const reason = directiveBlockReason(d.command);
		if (reason) unsafe.push({ command: d.command, reason });
	}
	return unsafe;
}
