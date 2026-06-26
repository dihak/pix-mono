/**
 * prompts.ts — unconditional system-prompt injection
 *
 * Injects structured context into every agent turn via `before_agent_start`.
 * Sources (injected in order):
 *   1. Own bundled SOP.md — the pix agent operating spec baseline.
 *   2. Repo CWD directive files — AGENTS.md, CLAUDE.md, GEMINI.md,
 *      .cursorrules, .windsurfrules (extend/override the baseline).
 *
 * Each file is wrapped in a labelled XML tag so the model knows provenance.
 * Injection is idempotent and host-aware: a file is skipped when either our
 * own tag is already present (retry) OR the Pi host has already injected the
 * same absolute path as <project_instructions path="..."> (resource-loader.js
 * auto-loads AGENTS.md / CLAUDE.md). This stays correct whichever files the
 * host decides to inject — no static assumption about host behaviour, so the
 * host coverage and pix-prompts coverage can never silently double or drop.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Repo-root filenames scanned for per-project directives. */
const REPO_DIRECTIVE_FILES = [
	"AGENTS.md",
	"CLAUDE.md",
	"GEMINI.md",
	".cursorrules",
	".windsurfrules",
] as const;

interface PromptSource {
	/** Unique tag name — used for idempotency check. */
	tag: string;
	/** Absolute path to the file. */
	path: string;
}

/** Resolve the absolute path to SOP.md bundled inside this package. */
function resolveOwnSopMd(): string | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJson = require.resolve("@xynogen/pix-prompts/package.json");
		return resolve(pkgJson, "..", "SOP.md");
	} catch {
		// Fallback: resolve relative to this file's location at runtime.
		return resolve(new URL(".", import.meta.url).pathname, "..", "SOP.md");
	}
}

/** Read a file, returning null on any error. */
function safeRead(p: string): string | null {
	try {
		return readFileSync(p, "utf-8");
	} catch {
		return null;
	}
}

/** Wrap file content in a labelled XML tag for provenance + idempotency. */
function wrap(tag: string, content: string): string {
	return `<${tag}>\n${content}\n</${tag}>`;
}

export default function registerPrompts(pi: ExtensionAPI): void {
	// Resolve own SOP.md once at load time (path is static).
	const ownSopMdPath = resolveOwnSopMd();

	pi.on("before_agent_start", async (event) => {
		const existing = event.systemPrompt ?? "";
		const cwd = process.cwd();

		const sources: PromptSource[] = [];

		// 1. Own SOP.md
		if (ownSopMdPath) {
			sources.push({ tag: "pix-agent-sop", path: ownSopMdPath });
		}

		// 2. Repo directive files (root only)
		for (const filename of REPO_DIRECTIVE_FILES) {
			const p = join(cwd, filename);
			if (existsSync(p)) {
				// tag = "pix-prompts-<filename>" with dots/leading-dot stripped
				const tag = `pix-prompts-${filename.replace(/^\./, "").replace(/\./g, "-").toLowerCase()}`;
				sources.push({ tag, path: p });
			}
		}

		// Inject each source the prompt doesn't already carry.
		// Skip when EITHER our own tag is present (retry) OR the host has
		// already injected this file as <project_instructions path="...">.
		// The host uses the absolute file path verbatim (system-prompt.js),
		// so a path match means the content is already present byte-for-byte.
		let prompt = existing;
		for (const { tag, path } of sources) {
			if (prompt.includes(`<${tag}>`)) continue;
			if (prompt.includes(`path="${path}"`)) continue; // host already injected it
			const content = safeRead(path);
			if (!content) continue;
			prompt = prompt
				? `${prompt}\n\n${wrap(tag, content)}`
				: wrap(tag, content);
		}

		if (prompt === existing) return; // nothing new to inject
		return { systemPrompt: prompt };
	});
}
