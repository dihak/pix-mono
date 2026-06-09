import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

async function clearCache(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	ctx.ui.notify("Clearing ~/.cache/pi", "info");
	const result = await pi.exec("/bin/sh", ["-lc", 'rm -rf "$HOME/.cache/pi"'], {
		timeout: 10_000,
	});
	const output = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	if ((result.code ?? 0) !== 0) {
		ctx.ui.notify(`Cache clear failed. ${output || "No output."}`, "error");
		return;
	}
	ctx.ui.notify(
		"~/.cache/pi cleared. Run /reload to apply changes.",
		"warning",
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Remove ~/.cache/pi and reload",
		handler: async (_args, ctx) => {
			await clearCache(pi, ctx);
		},
	});
}
