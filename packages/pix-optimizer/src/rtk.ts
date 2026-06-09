/**
 * Simple RTK Integration
 *
 * 1. Injects RTK system prompt (tells model to prefix commands with rtk)
 * 2. Rewrites bash commands to add rtk prefix when model forgets
 * 3. Falls back gracefully if rtk binary is missing
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

/**
 * Minimal structural shape of the SDK `tool_call` event we care about.
 * Mirrors `BashToolCallEvent` from the SDK without importing it, so the
 * rewrite logic stays unit-testable with plain objects.
 */
export interface BashCallEvent {
	toolName: string;
	input: { command?: unknown; [k: string]: unknown };
}

/**
 * Pure decision + mutation step for the `tool_call` hook.
 *
 * Given a tool-call event and whether RTK is available, mutate `event.input`
 * in place (the SDK's only supported way to patch tool args) when the command
 * is a rewritable bash command. Returns true if the command was rewritten.
 *
 * Extracted from the hook closure so the integration is directly testable
 * without a live ExtensionAPI.
 */
export function applyRtkRewrite(
	event: BashCallEvent,
	opts: { enabled: boolean; rtkAvailable: boolean },
): boolean {
	if (!opts.enabled) return false;
	if (!opts.rtkAvailable) return false;
	if (event.toolName !== "bash") return false;

	const command = event.input?.command;
	if (typeof command !== "string" || !command) return false;

	const rewritten = rewriteChain(command);
	if (rewritten === command) return false;

	event.input.command = rewritten;
	return true;
}

const RTK_SYSTEM_PROMPT = `# RTK — token-optimized command wrapper

Prefix shell commands with \`rtk\` (e.g. \`rtk git status\`). RTK compacts output for git, gh, cargo, npm/pnpm/yarn/bun, tsc, lint, vitest/jest/playwright, docker, kubectl, ls, grep, find, prisma — and passes anything else through unchanged, so it's always safe.

Prefix EVERY segment in a chain, not just the first:
\`rtk git add . && rtk git commit -m "msg" && rtk git push\`

RTK also has filtering subcommands the auto-rewriter won't add — reach for these yourself when useful: \`rtk err <cmd>\` (errors only), \`rtk summary <cmd>\`, \`rtk log <file>\` (dedup), \`rtk json <file>\` (structure), \`rtk test <cmd>\` (failures only), \`rtk gain\` (savings stats).`;

// Commands that should be prefixed with rtk
const RTK_COMMANDS = new Set([
	"git",
	"gh",
	"ls",
	"tree",
	"find",
	"grep",
	"cat",
	"head",
	"tail",
	"tsc",
	"lint",
	"eslint",
	"prettier",
	"next",
	"cargo",
	"rustc",
	"vitest",
	"playwright",
	"jest",
	"test",
	"pnpm",
	"npm",
	"npx",
	"yarn",
	"bun",
	"docker",
	"kubectl",
	"aws",
	"psql",
	"curl",
	"wget",
	"wc",
	"prisma",
	"dotnet",
]);

interface RtkStatus {
	available: boolean;
	checkedAt: number;
	path?: string;
}

/**
 * Split a command line into segments at top-level shell operators
 * (&&, ||, ;, |), keeping the operators as their own tokens. Operators
 * inside single/double quotes are ignored.
 *
 * Returns null if the parser hits something it can't safely reason about
 * (unbalanced quotes), so the caller can skip rewriting.
 */
export function splitChain(command: string): string[] | null {
	const out: string[] = [];
	let buf = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const c = command[i]!;
		const next = command[i + 1];

		if (quote) {
			buf += c;
			if (c === quote) quote = null;
			continue;
		}

		if (c === "'" || c === '"') {
			quote = c;
			buf += c;
			continue;
		}

		// two-char operators
		if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
			out.push(buf, c + c);
			buf = "";
			i++;
			continue;
		}

		// single-char operators
		if (c === ";" || c === "|") {
			out.push(buf, c);
			buf = "";
			continue;
		}

		buf += c;
	}

	if (quote) return null; // unbalanced quote — bail out
	out.push(buf);
	return out;
}

const CHAIN_OPERATORS = new Set(["&&", "||", ";", "|"]);

/**
 * Prefix each command segment with `rtk` when its first word is a known
 * RTK command and it is not already prefixed. Operators are preserved.
 * Returns the rewritten command, or the original if nothing changed.
 */
export function rewriteChain(command: string): string {
	const parts = splitChain(command);
	if (!parts) return command; // unparseable — leave untouched

	let changed = false;
	const rewritten = parts.map((part) => {
		if (CHAIN_OPERATORS.has(part.trim())) return part;

		const leading = part.match(/^\s*/)?.[0] ?? "";
		const body = part.slice(leading.length);
		if (!body) return part;

		const firstWord = body.split(/\s+/)[0]!;
		if (firstWord === "rtk") return part;
		if (!RTK_COMMANDS.has(firstWord)) return part;

		changed = true;
		return `${leading}rtk ${body}`;
	});

	return changed ? rewritten.join("") : command;
}

export function rtk(
	pi: ExtensionAPI,
	status: OptimizerStatus,
): OptimizerHandle {
	let rtkStatus: RtkStatus | null = null;
	let warnedMissing = false;
	let enabled = true;

	// Report into the shared optimizer indicator. RTK counts as "on" only when
	// enabled AND the binary is actually available.
	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		status.set("rtk", enabled && rtkStatus?.available === true, ctx);
	}

	// Check if rtk binary is available
	const checkRtkAvailability = async (): Promise<RtkStatus> => {
		// Cache for 60 seconds
		if (rtkStatus && Date.now() - rtkStatus.checkedAt < 60000) {
			return rtkStatus;
		}

		try {
			const result = await pi.exec("which", ["rtk"], { timeout: 1000 });
			if (result.code === 0 && result.stdout?.trim()) {
				rtkStatus = {
					available: true,
					checkedAt: Date.now(),
					path: result.stdout.trim(),
				};
				warnedMissing = false;
				return rtkStatus;
			}
		} catch (_error) {
			// which command failed
		}

		rtkStatus = {
			available: false,
			checkedAt: Date.now(),
		};
		return rtkStatus;
	};

	// Inject RTK system prompt
	pi.on("before_agent_start", async (event) => {
		if (!enabled) return undefined;
		const existing = event.systemPrompt ?? "";
		return { systemPrompt: `${RTK_SYSTEM_PROMPT}\n\n${existing}` };
	});

	// Keep the status indicator in sync across the agent lifecycle. Probe
	// availability on session start so the icon reflects reality immediately.
	pi.on("session_start", async (_event, ctx) => {
		await checkRtkAvailability();
		syncStatus(ctx);
	});
	pi.on("agent_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		syncStatus(ctx);
	});

	// -- Subcommand handler (dispatched by the merged /opt router) --

	async function run(
		args: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const arg = args.trim().toLowerCase();
		if (arg === "on") enabled = true;
		else if (arg === "off") enabled = false;
		else enabled = !enabled; // bare toggles

		await checkRtkAvailability();
		syncStatus(ctx);
		ctx.ui.notify(`RTK rewriting ${enabled ? "on" : "off"}.`, "info");
	}

	function complete(prefix: string) {
		const items = [
			{ value: "on", label: "on", description: "Force RTK rewriting on" },
			{ value: "off", label: "off", description: "Force RTK rewriting off" },
		];
		const n = prefix.trim().toLowerCase();
		const filtered = items.filter((i) => i.value.startsWith(n));
		return filtered.length > 0 ? filtered : null;
	}

	// Rewrite bash commands to add rtk prefix.
	//
	// The SDK fires a single `tool_call` event for every tool. The bash variant
	// carries `event.toolName === "bash"` and a mutable `event.input` of shape
	// `{ command: string; timeout?: number }`. Arguments are patched by mutating
	// `event.input` IN PLACE — returning `{ toolInput: ... }` does nothing.
	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) {
			return undefined;
		}

		if (event.toolName !== "bash") {
			return undefined;
		}

		const probe = await checkRtkAvailability();

		if (!probe.available) {
			if (!warnedMissing) {
				ctx.ui.notify(
					"RTK binary not found. Install: cargo install rtk-ai",
					"warning",
				);
				warnedMissing = true;
			}
			return undefined; // Don't rewrite if rtk not available
		}

		// First confirmed-available probe may have flipped state — refresh icon.
		syncStatus(ctx);

		// Rewrite every segment in the command chain that uses a known RTK
		// command (e.g. `git add . && git push` -> `rtk git add . && rtk git push`).
		// Mutates `event.input.command` in place — the SDK's supported patch path.
		applyRtkRewrite(event, { enabled, rtkAvailable: probe.available });
		return undefined;
	});

	return {
		name: "rtk",
		help: "rtk [on|off] — prefix shell commands with rtk (token-optimized)",
		run,
		complete,
	};
}
