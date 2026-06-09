/**
 * Diff Extension
 *
 * Tracks files changed during the last agent run (git delta + tool-touched
 * paths from edit/write), and exposes /diff to list/open them.
 *
 * Subcommands:
 *   /diff         → interactive selector, opens choice in editor
 *   /diff list    → notify with the list of changed files
 *   /diff clear   → reset tracked set and re-baseline against git
 *
 * Editor: $PI_DIFF_EDITOR > $VISUAL > $EDITOR > zed > code > vim
 */

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMAND = "diff";

function getStringPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object" || !("path" in input))
		return undefined;
	const p = (input as { path?: unknown }).path;
	return typeof p === "string" ? p : undefined;
}

function toAbs(cwd: string, p: string): string {
	return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p);
}

function toRel(cwd: string, p: string): string {
	const r = path.relative(cwd, p);
	return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : p;
}

function parseGitStatus(output: string, cwd: string): Set<string> {
	const files = new Set<string>();
	for (const line of output.split("\n")) {
		if (line.length < 4) continue;
		const raw = line.slice(3).trim();
		if (!raw) continue;
		const target = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
		if (!target) continue;
		files.add(toAbs(cwd, target.replace(/^"|"$/g, "")));
	}
	return files;
}

async function getGitChanged(
	pi: ExtensionAPI,
	cwd: string,
): Promise<Set<string>> {
	const r = await pi.exec(
		"git",
		["status", "--porcelain", "--untracked-files=all"],
		{ cwd, timeout: 5000 },
	);
	if (r.code !== 0) return new Set();
	return parseGitStatus(r.stdout, cwd);
}

function diff(current: Set<string>, baseline: Set<string>): Set<string> {
	return new Set([...current].filter((f) => !baseline.has(f)));
}

function pickEditor(): { cmd: string; args: (file: string) => string[] } {
	const env =
		process.env.PI_DIFF_EDITOR || process.env.VISUAL || process.env.EDITOR;
	if (env) {
		const parts = env.split(/\s+/);
		const cmd = parts[0];
		const rest = parts.slice(1);
		return { cmd, args: (f) => [...rest, f] };
	}
	return { cmd: "zed", args: (f) => ["-e", f] };
}

export default function (pi: ExtensionAPI) {
	let baseline = new Set<string>();
	let changed = new Set<string>();
	let touched = new Set<string>();

	pi.on("agent_start", async (_event, ctx) => {
		touched = new Set();
		changed = new Set();
		baseline = await getGitChanged(pi, ctx.cwd);
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		const p = getStringPath(event.input);
		if (!p) return;
		touched.add(toAbs(ctx.cwd, p));
	});

	pi.on("agent_end", async (_event, ctx) => {
		const now = await getGitChanged(pi, ctx.cwd);
		changed = new Set([...diff(now, baseline), ...touched]);
		if (changed.size > 0) {
			ctx.ui.notify(
				`📝 ${changed.size} changed file(s). Run /${COMMAND} to view/open.`,
				"info",
			);
		}
	});

	pi.registerCommand(COMMAND, {
		description:
			"Show files changed by the last agent run and open one in your editor",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const arg = (args ?? "").trim();

			if (arg === "clear") {
				changed = new Set();
				touched = new Set();
				baseline = await getGitChanged(pi, ctx.cwd);
				ctx.ui.notify("Cleared changed file list", "info");
				return;
			}

			const files = [...changed].sort((a, b) =>
				toRel(ctx.cwd, a).localeCompare(toRel(ctx.cwd, b)),
			);
			if (files.length === 0) {
				ctx.ui.notify(
					"No changed files tracked from the last agent run",
					"info",
				);
				return;
			}

			if (arg === "list") {
				ctx.ui.notify(
					`Changed files:\n${files.map((f) => `- ${toRel(ctx.cwd, f)}`).join("\n")}`,
					"info",
				);
				return;
			}

			if (arg) {
				ctx.ui.notify(
					`Unknown /${COMMAND} argument: ${arg}. Try /${COMMAND}, /${COMMAND} list, /${COMMAND} clear.`,
					"warning",
				);
				return;
			}

			const labels = files.map((f) => toRel(ctx.cwd, f));
			const selected = await ctx.ui.select("Open changed file", labels);
			if (!selected) return;

			const file = files[labels.indexOf(selected)];
			if (!file) return;

			const ed = pickEditor();
			const r = await pi.exec(ed.cmd, ed.args(file), {
				cwd: ctx.cwd,
				timeout: 5000,
			});
			if (r.code === 0)
				ctx.ui.notify(`Opened ${selected} in ${ed.cmd}`, "info");
			else
				ctx.ui.notify(
					r.stderr.trim() || `Failed to open ${selected} in ${ed.cmd}`,
					"error",
				);
		},
	});
}
