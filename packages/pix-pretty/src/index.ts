/**
 * pi-pretty — Pretty terminal output for pi built-in tools.
 *
 * Entry point: boots shared state, registers all tool overrides and commands.
 *
 * Modules:
 *   types.ts          shared interfaces/types
 *   config.ts         theme + thresholds
 *   ansi.ts           ANSI codes, low-contrast fix
 *   utils.ts          helpers + renderToolError
 *   lang.ts           language detection
 *   image.ts          terminal image protocols
 *   icons.ts          Nerd Font file-type icons
 *   highlight.ts      cli-highlight engine + ANSI cache
 *   renderers.ts      renderFileContent/Bash/Tree/Find/Grep
 *   fff.ts            Fast File Finder + cursor store + multi-grep fallback
 *   diff.ts           unified diff parser
 *   diff-render.ts    split/word-level diff renderer
 *   tools/            per-tool registrars (read/bash/ls/find/grep/edit/write)
 *   commands/         slash command registrars (fff)
 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type {
	BashToolInput,
	EditToolInput,
	ExtensionContext,
	FindToolInput,
	GrepToolInput,
	LsToolInput,
	ReadToolInput,
	WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { registerFffCommands } from "./commands/fff.js";
import { getDefaultAgentDir, setPrettyTheme } from "./config.js";
import {
	CursorStore,
	fffDestroy,
	fffEnsureFinder,
	fffState,
	getPiPrettyFffDir,
} from "./fff.js";
import { clearHighlightCache } from "./highlight.js";
// Built-in registrars — used as fallback when a pix-* package is not installed
import { registerBashTool as _registerBashTool } from "./tools/bash.js";
import type { ToolContext } from "./tools/context.js";
import { registerEditTool as _registerEditTool } from "./tools/edit.js";
import { registerFindTool as _registerFindTool } from "./tools/find.js";
import { registerGrepTool as _registerGrepTool } from "./tools/grep.js";
import { registerLsTool as _registerLsTool } from "./tools/ls.js";
import { registerReadTool as _registerReadTool } from "./tools/read.js";
import { registerWriteTool as _registerWriteTool } from "./tools/write.js";

const _req = createRequire(import.meta.url);

/** Try to load a registrar from an optional pix-* package; fall back to built-in. */
function loadRegistrar<T>(pkg: string, builtIn: T): T {
	try {
		const mod = _req(pkg) as Record<string, unknown>;
		// ESM-compiled packages expose named exports directly or via .default
		const keys = Object.keys(mod);
		// Named export preferred (e.g. registerBashTool); default is the fallback
		const named = keys.find((k) => k.startsWith("register"));
		return ((named ? mod[named] : mod.default) as T) ?? builtIn;
	} catch {
		return builtIn;
	}
}

import type {
	PiPrettyApi,
	PiPrettyDeps,
	PiPrettySdk,
	TextComponentCtor,
	ToolFactory,
} from "./types.js";
import { getErrorMessage, shortPath } from "./utils.js";

// ── Resize invalidation registry ───────────────────────────────────────
// Diff/write renderResults register their ctx.invalidate keyed by toolCallId
// so terminal resize triggers re-render at the correct width.

const _resizeInvalidators = new Map<string, () => void>();
let _resizeListenerAttached = false;

function attachResizeListener(): void {
	if (_resizeListenerAttached) return;
	_resizeListenerAttached = true;
	process.stdout.on("resize", () => {
		for (const inv of _resizeInvalidators.values()) inv();
	});
}

function trackInvalidator(toolCallId: string, inv: () => void): void {
	_resizeInvalidators.set(toolCallId, inv);
}

// ── Extension entry point ──────────────────────────────────────────────

export default function piPrettyExtension(
	pi: PiPrettyApi,
	deps?: PiPrettyDeps,
): void {
	attachResizeListener();

	let createReadTool: ToolFactory<ReadToolInput> | undefined;
	let createBashTool: ToolFactory<BashToolInput> | undefined;
	let createLsTool: ToolFactory<LsToolInput> | undefined;
	let createFindTool: ToolFactory<FindToolInput> | undefined;
	let createGrepTool: ToolFactory<GrepToolInput> | undefined;
	let createEditTool: ToolFactory<EditToolInput> | undefined;
	let createWriteTool: ToolFactory<WriteToolInput> | undefined;
	let TextComponent: TextComponentCtor;
	let sdk: PiPrettySdk;

	const cursorStore = new CursorStore();

	if (deps) {
		sdk = deps.sdk;
		createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
		createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
		createLsTool = sdk.createLsToolDefinition ?? sdk.createLsTool;
		createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
		createGrepTool = sdk.createGrepToolDefinition ?? sdk.createGrepTool;
		createEditTool = sdk.createEditToolDefinition ?? sdk.createEditTool;
		createWriteTool = sdk.createWriteToolDefinition ?? sdk.createWriteTool;
		TextComponent = deps.TextComponent;
		fffState.module = deps.fffModule ?? null;
		fffState.finder = null;
		fffState.partialIndex = false;
		fffState.dbDir = null;
	} else {
		try {
			sdk = require("@earendil-works/pi-coding-agent");
			createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
			createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
			createLsTool = sdk.createLsToolDefinition ?? sdk.createLsTool;
			createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
			createGrepTool = sdk.createGrepToolDefinition ?? sdk.createGrepTool;
			createEditTool = sdk.createEditToolDefinition ?? sdk.createEditTool;
			createWriteTool = sdk.createWriteToolDefinition ?? sdk.createWriteTool;
			TextComponent = require("@earendil-works/pi-tui").Text;
		} catch {
			return;
		}
	}
	if (!createReadTool || !TextComponent!) return;

	const cwd = process.cwd();
	const home = process.env.HOME ?? "";
	const sp = (p: string) => shortPath(cwd, home, p);
	// Respect PRETTY_DISABLE_TOOLS env var
	const disabledTools = new Set(
		(process.env.PRETTY_DISABLE_TOOLS ?? "")
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
	const isToolEnabled = (name: string) =>
		!disabledTools.has(name.toLowerCase());

	// ── Theme + FFF init ────────────────────────────────────────────────

	const getAgentDir = sdk.getAgentDir;
	setPrettyTheme(
		(() => {
			try {
				return getAgentDir?.() ?? getDefaultAgentDir();
			} catch {
				return getDefaultAgentDir();
			}
		})(),
	);
	clearHighlightCache();

	if (!deps) {
		try {
			fffState.module = require("@ff-labs/fff-node");
			if (getAgentDir) {
				fffState.dbDir = getPiPrettyFffDir(getAgentDir());
				try {
					mkdirSync(fffState.dbDir, { recursive: true });
				} catch {}
			}
		} catch {
			/* FFF not installed — SDK tools will be used */
		}
	} else if (fffState.module && getAgentDir) {
		fffState.dbDir = getPiPrettyFffDir(getAgentDir());
		try {
			mkdirSync(fffState.dbDir, { recursive: true });
		} catch {}
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (!fffState.module) {
			try {
				const imported = await import("@ff-labs/fff-node");
				fffState.module = { FileFinder: imported.FileFinder };
			} catch {}
		}
		if (!fffState.module) return;

		if (!fffState.dbDir) {
			const agentDir = getAgentDir?.() ?? join(home, ".pi/agent");
			fffState.dbDir = getPiPrettyFffDir(agentDir);
			try {
				mkdirSync(fffState.dbDir, { recursive: true });
			} catch {}
		}

		try {
			await fffEnsureFinder(ctx.cwd);
			if (fffState.partialIndex) {
				ctx.ui?.notify?.(
					"FFF: scan timed out — using partial index. Run /fff-rescan when ready.",
					"warning",
				);
			} else {
				ctx.ui?.notify?.("FFF indexed", "info");
			}
		} catch (error: unknown) {
			ctx.ui?.notify?.(`FFF init failed: ${getErrorMessage(error)}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		fffDestroy();
	});

	// ── Build shared tool context ───────────────────────────────────────

	const toolCtx: ToolContext = {
		cwd,
		sp,
		TextComponent: TextComponent!,
		fffState,
		cursorStore,
	};

	// ── Register tools ──────────────────────────────────────────────────

	// Soft-load each tool: prefer installed @xynogen/pix-* package; fall back to built-in.
	const registerRead = loadRegistrar("@xynogen/pix-read", _registerReadTool);
	const registerBash = loadRegistrar("@xynogen/pix-bash", _registerBashTool);
	const registerLs = loadRegistrar("@xynogen/pix-ls", _registerLsTool);
	const registerFind = loadRegistrar("@xynogen/pix-find", _registerFindTool);
	const registerGrep = loadRegistrar("@xynogen/pix-grep", _registerGrepTool);
	const registerEdit = loadRegistrar("@xynogen/pix-edit", _registerEditTool);
	const registerWrite = loadRegistrar("@xynogen/pix-write", _registerWriteTool);

	if (isToolEnabled("read") && createReadTool) {
		registerRead(pi, createReadTool, toolCtx);
	}
	if (isToolEnabled("bash") && createBashTool) {
		registerBash(pi, createBashTool, toolCtx);
	}
	if (isToolEnabled("ls") && createLsTool) {
		registerLs(pi, createLsTool, toolCtx);
	}
	if (isToolEnabled("find") && createFindTool) {
		registerFind(pi, createFindTool, toolCtx);
	}
	if (isToolEnabled("grep") && createGrepTool) {
		registerGrep(pi, createGrepTool, toolCtx);
	}
	if (isToolEnabled("edit") && createEditTool) {
		registerEdit(pi, createEditTool, toolCtx, trackInvalidator);
	}
	if (isToolEnabled("write") && createWriteTool) {
		registerWrite(pi, createWriteTool, toolCtx, trackInvalidator);
	}

	// ── Register FFF commands ───────────────────────────────────────────

	if (fffState.module) {
		registerFffCommands(pi, fffState);
	}
}
