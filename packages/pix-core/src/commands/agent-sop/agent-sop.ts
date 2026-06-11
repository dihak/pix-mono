/**
 * agent-sop — inject AGENT.md (from pix-skills) into system prompt
 *
 * Reads AGENT.md from the @xynogen/pix-skills package and appends it to the
 * system prompt on every agent start via `before_agent_start`.
 *
 * This is the "register skill" mechanism for the agent operating spec — no
 * static SKILL.md file needed. The content becomes part of the model's
 * standing instructions.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Resolve the absolute path to AGENT.md inside @xynogen/pix-skills. */
function resolveAgentMdPath(): string | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJson = require.resolve("@xynogen/pix-skills/package.json");
		return resolve(pkgJson, "..", "AGENT.md");
	} catch {
		return null;
	}
}

/** Read and return AGENT.md content, or null if unavailable. */
function loadAgentMd(): string | null {
	const p = resolveAgentMdPath();
	if (!p || !existsSync(p)) return null;
	try {
		return readFileSync(p, "utf-8");
	} catch {
		return null;
	}
}

export default function registerAgentSop(pi: ExtensionAPI): void {
	// Load once at startup (content is static per session).
	const agentMdContent = loadAgentMd();

	if (!agentMdContent) {
		// Silent skip — pix-skills might not be installed.
		return;
	}

	pi.on("before_agent_start", async (event) => {
		// Skip if already injected (idempotent check via a simple marker).
		if (event.systemPrompt.includes("pix-agent-sop")) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n<pix-agent-sop>\n${agentMdContent}\n</pix-agent-sop>`,
		};
	});
}
