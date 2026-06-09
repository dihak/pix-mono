/**
 * Copy-All Extension
 *
 * /copy-all → copies the entire user+assistant conversation in the current
 * branch to the system clipboard. Uses pbcopy on macOS, xclip/xsel/wl-copy
 * on Linux, clip.exe on WSL/Windows.
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object" || !("type" in block)) return "";
			if (
				block.type === "text" &&
				"text" in block &&
				typeof block.text === "string"
			)
				return block.text;
			if (block.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function pickClipboardCmd(): { cmd: string; args: string[] } | undefined {
	const p = platform();
	if (p === "darwin") return { cmd: "pbcopy", args: [] };
	if (p === "win32") return { cmd: "clip.exe", args: [] };
	// linux / wsl
	if (process.env.WSL_DISTRO_NAME) return { cmd: "clip.exe", args: [] };
	if (process.env.WAYLAND_DISPLAY) return { cmd: "wl-copy", args: [] };
	return { cmd: "xclip", args: ["-selection", "clipboard"] };
}

function copyToClipboard(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const c = pickClipboardCmd();
		if (!c) {
			reject(new Error("No clipboard utility detected"));
			return;
		}
		const child = spawn(c.cmd, c.args);
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else
				reject(new Error(stderr.trim() || `${c.cmd} exited with code ${code}`));
		});
		child.stdin.end(text);
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copy-all", {
		description:
			"Copy all user/assistant messages in this thread to the clipboard",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const messages = ctx.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "message")
				.map((entry) => entry.message)
				.filter((m) => m.role === "user" || m.role === "assistant");

			const text = messages
				.map((m) => {
					const c = textFromContent(m.content).trim();
					return `${m.role.toUpperCase()}:\n${c}`;
				})
				.filter((s) => !s.endsWith(":\n"))
				.join("\n\n---\n\n");

			if (!text) {
				ctx.ui.notify("No user or assistant messages to copy", "info");
				return;
			}

			try {
				await copyToClipboard(text);
				ctx.ui.notify(
					`📋 Copied ${messages.length} messages to clipboard`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(
					`Clipboard copy failed: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});
}
