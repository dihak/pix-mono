/**
 * opt.ts — the single `/opt` command that fronts every optimizer tool.
 *
 * caveman / rtk / json each register their own lifecycle hooks but expose an
 * OptimizerHandle for command dispatch. This router wires them under one
 * command so there's exactly one entry point:
 *
 *   /opt                  → status + help
 *   /opt caveman <level>  → caveman subcommand
 *   /opt rtk [on|off]     → rtk subcommand
 *   /opt toon [on|off]    → toon subcommand
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	CompletionItem,
	OptimizerHandle,
	OptimizerTool,
} from "./status.ts";

/** Split raw args into the subcommand name and the rest. */
export function parseInvocation(args: string): { name: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { name: "", rest: "" };
	const idx = trimmed.search(/\s/);
	if (idx === -1) return { name: trimmed.toLowerCase(), rest: "" };
	return {
		name: trimmed.slice(0, idx).toLowerCase(),
		rest: trimmed.slice(idx + 1),
	};
}

/**
 * Compute completions for `/opt ...`:
 *   - first token → tool names (filtered by prefix)
 *   - after a known tool name → delegate to that tool's complete()
 *
 * Pure + exported for tests.
 */
export function completeInvocation(
	args: string,
	handles: Record<OptimizerTool, OptimizerHandle>,
): CompletionItem[] | null {
	// No space yet → still completing the tool name.
	if (!/\s/.test(args.trimStart())) {
		const prefix = args.trim().toLowerCase();
		const names = (Object.keys(handles) as OptimizerTool[])
			.filter((n) => n.startsWith(prefix))
			.map((n) => ({
				value: n,
				label: n,
				description: handles[n].help,
			}));
		return names.length > 0 ? names : null;
	}

	// Past the tool name → delegate to the tool's own completer.
	const { name, rest } = parseInvocation(args);
	const handle = handles[name as OptimizerTool];
	if (!handle) return null;
	return handle.complete(rest);
}

/** Build the `/opt` help text listing every tool. */
export function buildOptHelp(
	handles: Record<OptimizerTool, OptimizerHandle>,
): string {
	const lines = (Object.keys(handles) as OptimizerTool[]).map(
		(n) => `  /opt ${handles[n].help}`,
	);
	return [
		"pix-optimizer — token tools",
		"",
		"Usage: /opt <tool> [args]",
		...lines,
	].join("\n");
}

export function registerOptCommand(
	pi: ExtensionAPI,
	handles: Record<OptimizerTool, OptimizerHandle>,
): void {
	pi.registerCommand("opt", {
		description: "pix-optimizer: caveman / rtk / toon / ponytail tools",
		getArgumentCompletions: (prefix: string) =>
			completeInvocation(prefix, handles),
		handler: async (args, ctx) => {
			const { name, rest } = parseInvocation(args ?? "");

			// No subcommand → show help.
			if (!name) {
				ctx.ui.notify(buildOptHelp(handles), "info");
				return;
			}

			const handle = handles[name as OptimizerTool];
			if (!handle) {
				ctx.ui.notify(
					`Unknown tool: "${name}". Try: ${Object.keys(handles).join(", ")}`,
					"error",
				);
				return;
			}

			await handle.run(rest, ctx);
		},
	});
}
