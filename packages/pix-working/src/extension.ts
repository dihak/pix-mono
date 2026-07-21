/**
 * pix-working — elapsed-time counter on the streaming "Working" indicator.
 *
 * Ticks the built-in working message once per second between agent_start and
 * agent_end, so the loader reads e.g. "Working (12s)". On agent_end it pops a
 * "Done in 12s" toast and restores the default working message.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { formatElapsed } from "./format.js";

export default function pixWorkingExtension(pi: ExtensionAPI): void {
	let start = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	const stop = (ctx: ExtensionContext) => {
		if (timer) clearInterval(timer);
		timer = undefined;
		ctx.ui.setWorkingMessage(); // restore pi's default label
	};

	pi.on("agent_start", async (_event, ctx) => {
		start = Date.now();
		const tick = () => ctx.ui.setWorkingMessage(`Working (${formatElapsed(Date.now() - start)})`);
		tick();
		if (timer) clearInterval(timer);
		timer = setInterval(tick, 1000);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const total = Date.now() - start;
		stop(ctx);
		if (start > 0) ctx.ui.notify(`Done in ${formatElapsed(total)}`, "info");
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		stop(ctx);
	});
}
