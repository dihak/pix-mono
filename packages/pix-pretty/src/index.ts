/**
 * pi-pretty — Pretty terminal output for pi built-in tools.
 *
 * Entry point: wraps SDK factory tools (read/bash/ls/find/grep + multi_grep),
 * delegates execute() unchanged, and attaches custom renderCall/renderResult.
 *
 * Modules:
 *   types.ts      shared interfaces/types
 *   config.ts     theme + thresholds
 *   ansi.ts       ANSI codes, low-contrast fix
 *   utils.ts      helpers + renderToolError
 *   lang.ts       language detection
 *   image.ts      terminal image protocols
 *   icons.ts      Nerd Font file-type icons
 *   highlight.ts  cli-highlight engine + ANSI cache
 *   renderers.ts  renderFileContent/Bash/Tree/Find/Grep
 *   fff.ts        Fast File Finder + cursor store + multi-grep fallback
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentToolUpdateCallback,
	BashToolInput,
	EditToolInput,
	ExtensionContext,
	FindToolInput,
	GrepToolInput,
	LsToolInput,
	ReadToolInput,
	ToolRenderResultOptions,
	WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import type { FileItem, GrepResult, SearchResult } from "@ff-labs/fff-node";

import { FG_DIM, RST, resolveBaseBackground } from "./ansi.js";
import {
	getDefaultAgentDir,
	MAX_PREVIEW_LINES,
	MAX_RENDER_LINES,
	setPrettyTheme,
} from "./config.js";
import { parseDiff } from "./diff.js";
import {
	diffThemeCacheKey,
	renderSplit,
	resolveDiffColors,
	summarize,
} from "./diff-render.js";
import {
	CursorStore,
	fffDestroy,
	fffEnsureFinder,
	fffFormatGrepText,
	fffState,
	getPiPrettyFffDir,
	runMultiGrepRipgrepFallback,
} from "./fff.js";
import { clearHighlightCache, hlBlock } from "./highlight.js";
import { fileIcon } from "./icons.js";
import { lang } from "./lang.js";
import {
	renderBashOutput,
	renderFileContent,
	renderFindResults,
	renderGrepResults,
	renderTree,
} from "./renderers.js";
import type {
	BashParams,
	CommandContextLike,
	EditOperation,
	EditParams,
	EditRenderState,
	FindParams,
	FindResultDetails,
	GrepParams,
	GrepRenderState,
	GrepResultDetails,
	LsParams,
	MultiGrepParams,
	MultiGrepRenderState,
	PiPrettyApi,
	PiPrettyDeps,
	PiPrettySdk,
	ReadParams,
	RenderContextLike,
	RenderDetails,
	TextComponentCtor,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
	WriteParams,
	WriteRenderState,
} from "./types.js";
import {
	appendNotices,
	buildLiteralAlternationPattern,
	countRipgrepMatches,
	fillToolBackground,
	getConstraintBackedPath,
	getErrorMessage,
	getTextContent,
	humanSize,
	isImageContent,
	isTextContent,
	makeTextResult,
	normalizeLineEndings,
	renderToolError,
	rule,
	setResultDetails,
	shortPath,
	shouldIgnoreCaseForPatterns,
	termW,
	trimToUndefined,
} from "./utils.js";

export default function piPrettyExtension(
	pi: PiPrettyApi,
	deps?: PiPrettyDeps,
): void {
	let createReadTool: ToolFactory<ReadToolInput> | undefined;
	let createBashTool: ToolFactory<BashToolInput> | undefined;
	let createLsTool: ToolFactory<LsToolInput> | undefined;
	let createFindTool: ToolFactory<FindToolInput> | undefined;
	let createGrepTool: ToolFactory<GrepToolInput> | undefined;
	let createEditTool: ToolFactory<EditToolInput> | undefined;
	let createWriteTool: ToolFactory<WriteToolInput> | undefined;
	let TextComponent: TextComponentCtor;

	let sdk: PiPrettySdk;

	const _cursorStore = new CursorStore();

	if (deps) {
		// Test path: use injected dependencies, reset module state
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
	if (!createReadTool || !TextComponent) return;

	const cwd = process.cwd();
	const home = process.env.HOME ?? "";
	const sp = (p: string) => shortPath(cwd, home, p);
	const multiGrepRipgrepFallback =
		deps?.multiGrepRipgrepFallback ?? runMultiGrepRipgrepFallback;

	// Parse PRETTY_DISABLE_TOOLS — comma-separated tool names to skip
	const disabledTools = new Set(
		(process.env.PRETTY_DISABLE_TOOLS ?? "")
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
	function isToolEnabled(name: string): boolean {
		return !disabledTools.has(name.toLowerCase());
	}

	// ===================================================================
	// FFF initialization (optional — graceful fallback to SDK)
	// ===================================================================

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
		// Only try require() in production — tests inject fffModule via deps
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

	pi.on("session_start", async (_event, ctx) => {
		// Try dynamic import if sync require failed (ESM-only package)
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
				// Confirm indexing via a transient toast instead of a footer status
				// segment — the footer sorts extension statuses by key, and "fff"
				// sorting ahead of other extensions shifted their indicators.
				ctx.ui?.notify?.("FFF indexed", "info");
			}
		} catch (error: unknown) {
			ctx.ui?.notify?.(`FFF init failed: ${getErrorMessage(error)}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		fffDestroy();
	});

	// ===================================================================
	// read — syntax-highlighted file content
	// ===================================================================

	const origRead = createReadTool(cwd);

	if (isToolEnabled("read")) {
		pi.registerTool({
			...origRead,
			name: "read",

			async execute(
				tid: string,
				params: ReadParams,
				sig: AbortSignal | undefined,
				upd: AgentToolUpdateCallback<unknown> | undefined,
				ctx: ExtensionContext,
			) {
				const result = (await origRead.execute(
					tid,
					params,
					sig,
					upd,
					ctx,
				)) as ToolResultLike;

				const fp = params.path ?? "";
				const offset = params.offset ?? 1;

				const imageBlock = result.content?.find(isImageContent);
				if (imageBlock) {
					setResultDetails(result, {
						_type: "readImage",
						filePath: fp,
						data: imageBlock.data,
						mimeType: imageBlock.mimeType ?? "image/png",
					});
					return result;
				}

				const textContent = getTextContent(result);
				if (textContent && fp) {
					const normalizedContent = normalizeLineEndings(textContent);
					const lineCount = normalizedContent.split("\n").length;
					setResultDetails(result, {
						_type: "readFile",
						filePath: fp,
						content: normalizedContent,
						offset,
						lineCount,
					});
				}

				return result;
			},

			renderCall(args: ReadParams, theme: ThemeLike, ctx: RenderContextLike) {
				resolveBaseBackground(theme);
				const fp = args.path ?? "";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const offset = args.offset
					? ` ${theme.fg("muted", `from line ${args.offset}`)}`
					: "";
				const limit = args.limit
					? ` ${theme.fg("muted", `(${args.limit} lines)`)}`
					: "";
				text.setText(
					fillToolBackground(
						`${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", sp(fp))}${offset}${limit}`,
					),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike,
				_opt: unknown,
				theme: ThemeLike,
				ctx: RenderContextLike,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}

				const d = result.details as RenderDetails | undefined;

				// Image reads keep the original image content so Pi's native TUI renderer
				// can display it exactly once. pi-pretty only renders metadata here;
				// rendering another inline image caused duplicate previews.
				if (d?._type === "readImage") {
					const byteSize = Math.ceil(((d.data as string).length * 3) / 4);
					const sizeStr = humanSize(byteSize);
					const mimeStr = d.mimeType ?? "image";

					text.setText(
						fillToolBackground(
							`  ${fileIcon(d.filePath)}${FG_DIM}${mimeStr} · ${sizeStr}${RST}`,
						),
					);
					return text;
				}

				if (d?._type === "readFile" && d.content) {
					const key = `read:${d.filePath}:${d.offset}:${d.lineCount}:${termW()}`;
					if (ctx.state._rk !== key) {
						ctx.state._rk = key;
						const info = `${FG_DIM}${d.lineCount} lines${RST}`;
						ctx.state._rt = fillToolBackground(`  ${info}`);

						const maxShow = ctx.expanded ? d.lineCount : MAX_PREVIEW_LINES;
						renderFileContent(d.content, d.filePath, d.offset, maxShow)
							.then((rendered: string) => {
								if (ctx.state._rk !== key) return;
								ctx.state._rt = fillToolBackground(`  ${info}\n${rendered}`);
								ctx.invalidate();
							})
							.catch(() => {});
					}
					text.setText(
						ctx.state._rt ??
							fillToolBackground(`  ${FG_DIM}${d.lineCount} lines${RST}`),
					);
					return text;
				}

				// Fallback
				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "read";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// bash — colored exit status
	// ===================================================================

	if (createBashTool) {
		const origBash = createBashTool(cwd);

		pi.registerTool({
			...origBash,
			name: "bash",

			async execute(
				tid: string,
				params: BashParams,
				sig: AbortSignal | undefined,
				upd: AgentToolUpdateCallback<unknown> | undefined,
				ctx: ExtensionContext,
			) {
				const result = (await origBash.execute(
					tid,
					params,
					sig,
					upd,
					ctx,
				)) as ToolResultLike;
				const textContent = getTextContent(result);

				let exitCode: number | null = 0;
				if (textContent) {
					const exitMatch = textContent.match(
						/(?:exit code|exited with|exit status)[:\s]*(\d+)/i,
					);
					if (exitMatch) exitCode = Number(exitMatch[1]);
					if (
						textContent.includes("command not found") ||
						textContent.includes("No such file")
					) {
						exitCode = 1;
					}
				}

				setResultDetails(result, {
					_type: "bashResult",
					text: textContent ?? "",
					exitCode,
					command: params.command ?? "",
				});

				return result;
			},

			renderCall(args: BashParams, theme: ThemeLike, ctx: RenderContextLike) {
				resolveBaseBackground(theme);
				const cmd = args.command ?? "";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const timeout = args.timeout
					? ` ${theme.fg("muted", `(${args.timeout}s timeout)`)}`
					: "";
				const displayCmd =
					ctx.expanded || cmd.length <= 80 ? cmd : `${cmd.slice(0, 77)}…`;
				text.setText(
					fillToolBackground(
						`${theme.fg("toolTitle", theme.bold("bash"))} ${theme.fg("accent", displayCmd)}${timeout}`,
					),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike,
				_opt: unknown,
				theme: ThemeLike,
				ctx: RenderContextLike,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}

				const d = result.details as RenderDetails | undefined;
				if (d?._type === "bashResult") {
					const { summary } = renderBashOutput(d.text, d.exitCode);
					const lines = d.text.split("\n");
					const lineCount = lines.length;
					const lineInfo =
						lineCount > 1 ? `  ${FG_DIM}(${lineCount} lines)${RST}` : "";
					const header = `  ${summary}${lineInfo}`;

					if (d.text.trim()) {
						const maxShow = ctx.expanded ? lineCount : MAX_PREVIEW_LINES;
						const show = lines.slice(0, maxShow);
						const tw = termW();
						const out: string[] = [header, rule(tw)];
						for (const line of show) {
							out.push(`  ${line}`);
						}
						out.push(rule(tw));
						if (lineCount > maxShow) {
							out.push(`${FG_DIM}  … ${lineCount - maxShow} more lines${RST}`);
						}
						text.setText(fillToolBackground(out.join("\n")));
					} else {
						text.setText(fillToolBackground(header));
					}
					return text;
				}

				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "done";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// ls — tree view with icons
	// ===================================================================

	if (createLsTool) {
		const origLs = createLsTool(cwd);

		pi.registerTool({
			...origLs,
			name: "ls",

			async execute(
				tid: string,
				params: LsParams,
				sig: AbortSignal | undefined,
				upd: AgentToolUpdateCallback<unknown> | undefined,
				ctx: ExtensionContext,
			) {
				const result = (await origLs.execute(
					tid,
					params,
					sig,
					upd,
					ctx,
				)) as ToolResultLike;
				const textContent = getTextContent(result);
				const fp = params.path ?? cwd;
				const entryCount = textContent
					? textContent.trim().split("\n").filter(Boolean).length
					: 0;

				setResultDetails(result, {
					_type: "lsResult",
					text: textContent ?? "",
					path: fp,
					entryCount,
				});

				return result;
			},

			renderCall(args: LsParams, theme: ThemeLike, ctx: RenderContextLike) {
				resolveBaseBackground(theme);
				const fp = args.path ?? ".";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				text.setText(
					fillToolBackground(
						`${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", sp(fp))}`,
					),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike,
				_opt: unknown,
				theme: ThemeLike,
				ctx: RenderContextLike,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}

				const d = result.details as RenderDetails | undefined;
				if (d?._type === "lsResult" && d.text) {
					const tree = renderTree(d.text, d.path);
					const info = `${FG_DIM}${d.entryCount} entries${RST}`;
					text.setText(fillToolBackground(`  ${info}\n${tree}`));
					return text;
				}

				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "listed";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// find — grouped file list with icons
	// ===================================================================

	if (createFindTool) {
		const origFind = createFindTool(cwd);

		pi.registerTool({
			...origFind,
			name: "find",

			async execute(
				tid: string,
				params: FindParams,
				sig: AbortSignal | undefined,
				upd: unknown,
				ctx: ExtensionContext,
			) {
				// Try FFF first (frecency-ranked, SIMD-accelerated)
				if (fffState.finder && !fffState.finder.isDestroyed) {
					try {
						const effectiveLimit = Math.max(1, params.limit ?? 200);
						let query = params.pattern;
						if (params.path) query = `${params.path} ${query}`;

						const searchResult = fffState.finder.fileSearch(query, {
							pageSize: effectiveLimit,
						});
						if (searchResult.ok) {
							const search: SearchResult = searchResult.value;
							const items: FileItem[] = search.items.slice(0, effectiveLimit);
							const notices: string[] = [];
							if (fffState.partialIndex)
								notices.push("Warning: partial file index");
							if (items.length >= effectiveLimit)
								notices.push(`${effectiveLimit} limit reached`);
							if (search.totalMatched > items.length)
								notices.push(`${search.totalMatched} total matches`);

							const textContent = appendNotices(
								items.map((item) => item.relativePath).join("\n"),
								notices,
							);
							return makeTextResult<FindResultDetails>(textContent, {
								_type: "findResult",
								text: textContent,
								pattern: params.pattern,
								matchCount: items.length,
							});
						}
					} catch {
						/* fall through to SDK */
					}
				}

				// SDK fallback
				const result = await origFind.execute(
					tid,
					params,
					sig,
					upd as never,
					ctx,
				);
				const textContent = getTextContent(result);
				const matchCount = textContent
					? textContent.trim().split("\n").filter(Boolean).length
					: 0;

				setResultDetails<FindResultDetails>(result, {
					_type: "findResult",
					text: textContent,
					pattern: params.pattern,
					matchCount,
				});

				return result;
			},

			renderCall(args: FindParams, theme: ThemeLike, ctx: RenderContextLike) {
				resolveBaseBackground(theme);
				const pattern = args.pattern ?? "";
				const path = args.path
					? ` ${theme.fg("muted", `in ${sp(args.path)}`)}`
					: "";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				text.setText(
					fillToolBackground(
						`${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}${path}`,
					),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike<FindResultDetails>,
				_opt: ToolRenderResultOptions,
				theme: ThemeLike,
				ctx: RenderContextLike,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}

				const d = result.details;
				if (d?._type === "findResult" && d.text) {
					const rendered = renderFindResults(d.text);
					const info = `${FG_DIM}${d.matchCount} files${RST}`;
					text.setText(fillToolBackground(`  ${info}\n${rendered}`));
					return text;
				}

				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "found";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// grep — highlighted matches with line numbers
	// ===================================================================

	if (createGrepTool) {
		const origGrep = createGrepTool(cwd);

		pi.registerTool({
			...origGrep,
			name: "grep",

			async execute(
				tid: string,
				params: GrepParams,
				sig: AbortSignal | undefined,
				upd: unknown,
				ctx: ExtensionContext,
			) {
				// Try FFF first (SIMD-accelerated, frecency-ranked).
				// FFF 0.5.2 can abort the process when path/glob constraints meet
				// Unicode filenames, so constrained searches use the SDK fallback.
				if (
					fffState.finder &&
					!fffState.finder.isDestroyed &&
					!params.path &&
					!params.glob
				) {
					try {
						const effectiveLimit = Math.max(1, params.limit ?? 100);
						const query = params.pattern;

						const grepResult = fffState.finder.grep(query, {
							mode: params.literal ? "plain" : "regex",
							smartCase: !params.ignoreCase,
							maxMatchesPerFile: Math.min(effectiveLimit, 50),
							cursor: null,
							beforeContext: params.context ?? 0,
							afterContext: params.context ?? 0,
						});

						if (grepResult.ok) {
							const grep: GrepResult = grepResult.value;
							const notices: string[] = [];
							if (fffState.partialIndex)
								notices.push("Warning: partial file index");
							if (grep.items.length >= effectiveLimit)
								notices.push(`${effectiveLimit} limit reached`);
							if (grep.regexFallbackError)
								notices.push(
									`Regex failed: ${grep.regexFallbackError}, used literal match`,
								);
							if (grep.nextCursor) {
								const cursorId = _cursorStore.store(grep.nextCursor);
								notices.push(
									`More results available. Use cursor="${cursorId}" to continue`,
								);
							}

							const textContent = appendNotices(
								fffFormatGrepText(grep.items, effectiveLimit),
								notices,
							);
							return makeTextResult<GrepResultDetails>(textContent, {
								_type: "grepResult",
								text: textContent,
								pattern: params.pattern,
								matchCount: Math.min(grep.items.length, effectiveLimit),
							});
						}
					} catch {
						/* fall through to SDK */
					}
				}

				// SDK fallback
				const result = await origGrep.execute(
					tid,
					params,
					sig,
					upd as never,
					ctx,
				);
				const textContent = normalizeLineEndings(getTextContent(result));
				if (result.content) {
					for (const content of result.content) {
						if (isTextContent(content))
							content.text = normalizeLineEndings(content.text || "");
					}
				}
				const matchCount = textContent ? countRipgrepMatches(textContent) : 0;

				setResultDetails<GrepResultDetails>(result, {
					_type: "grepResult",
					text: textContent,
					pattern: params.pattern,
					matchCount,
				});

				return result;
			},

			renderCall(args: GrepParams, theme: ThemeLike, ctx: RenderContextLike) {
				resolveBaseBackground(theme);
				const pattern = args.pattern ?? "";
				const path = args.path
					? ` ${theme.fg("muted", `in ${sp(args.path)}`)}`
					: "";
				const glob = args.glob ? ` ${theme.fg("muted", `(${args.glob})`)}` : "";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				text.setText(
					fillToolBackground(
						`${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", pattern)}${path}${glob}`,
					),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike<GrepResultDetails>,
				_opt: ToolRenderResultOptions,
				theme: ThemeLike,
				ctx: RenderContextLike<GrepRenderState>,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}

				const d = result.details;
				if (d?._type === "grepResult" && d.text) {
					const key = `grep:${d.pattern}:${d.matchCount}:${termW()}`;
					if (ctx.state._gk !== key) {
						ctx.state._gk = key;
						const info = `${FG_DIM}${d.matchCount} matches${RST}`;
						ctx.state._gt = fillToolBackground(`  ${info}`);

						renderGrepResults(d.text, d.pattern)
							.then((rendered: string) => {
								if (ctx.state._gk !== key) return;
								ctx.state._gt = fillToolBackground(`  ${info}\n${rendered}`);
								ctx.invalidate();
							})
							.catch(() => {});
					}
					text.setText(
						ctx.state._gt ??
							fillToolBackground(`  ${FG_DIM}${d.matchCount} matches${RST}`),
					);
					return text;
				}

				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "searched";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// multi_grep — OR-logic multi-pattern search (FFF when available,
	// SDK grep fallback otherwise)
	// ===================================================================

	if (fffState.module || createGrepTool) {
		const multiGrepFallback = createGrepTool ? createGrepTool(cwd) : null;

		pi.registerTool({
			name: "multi_grep",
			label: "multi_grep",
			description: [
				"Search file contents for lines matching ANY of multiple patterns (OR logic).",
				"Uses SIMD-accelerated Aho-Corasick multi-pattern matching when FFF is available.",
				"Falls back to ripgrep while preserving literal OR semantics and file constraints when needed.",
				"Patterns are literal text — never escape special characters.",
				"Use path to scope a directory/file and constraints for file filtering ('*.rs', 'src/', '!test/').",
			].join(" "),
			promptSnippet:
				"Multi-pattern OR search across file contents (FFF-accelerated with grep fallback)",
			promptGuidelines: [
				"Use multi_grep when you need to find multiple identifiers at once (OR logic).",
				"Include all naming conventions: snake_case, PascalCase, camelCase variants.",
				"Patterns are literal text. Never escape special characters.",
				"Use path to scope a directory or file when you need fresh on-disk results.",
				"Use the constraints parameter for additional file filtering, not inside patterns.",
			],

			parameters: {
				type: "object",
				properties: {
					patterns: {
						type: "array",
						items: { type: "string" },
						description:
							"Patterns to search for (OR logic — matches lines containing ANY pattern).",
					},
					path: {
						type: "string",
						description:
							"Directory or file path to search (default: current directory)",
					},
					constraints: {
						type: "string",
						description:
							"File constraints, e.g. '*.{ts,tsx} !test/' to filter files.",
					},
					context: {
						type: "number",
						description:
							"Number of context lines before and after each match (default: 0)",
					},
					limit: {
						type: "number",
						description: "Maximum number of matches to return (default: 100)",
					},
				},
				required: ["patterns"],
			},

			async execute(
				tid: string,
				params: MultiGrepParams,
				sig: AbortSignal | undefined,
				upd: unknown,
				ctx: ExtensionContext,
			) {
				if (sig?.aborted) return makeTextResult("Aborted", {});

				if (!params.patterns || params.patterns.length === 0) {
					return makeTextResult(
						"Error: patterns array must have at least 1 element",
						{ error: "empty patterns" },
					);
				}

				const effectiveLimit = Math.max(1, params.limit ?? 100);
				const pattern = buildLiteralAlternationPattern(params.patterns);
				const requestedPath = trimToUndefined(params.path);
				const requestedConstraints = trimToUndefined(params.constraints);
				const effectivePath =
					requestedPath ?? getConstraintBackedPath(requestedConstraints);
				const hasNativeConstraints = Boolean(
					requestedPath || requestedConstraints,
				);

				if (
					fffState.finder &&
					!fffState.finder.isDestroyed &&
					!hasNativeConstraints
				) {
					try {
						const grepResult = fffState.finder.multiGrep({
							patterns: params.patterns,
							maxMatchesPerFile: Math.min(effectiveLimit, 50),
							smartCase: true,
							cursor: null,
							beforeContext: params.context ?? 0,
							afterContext: params.context ?? 0,
						});

						if (!grepResult.ok) {
							return makeTextResult(`multi_grep error: ${grepResult.error}`, {
								error: grepResult.error,
							});
						}

						const grep: GrepResult = grepResult.value;
						const notices: string[] = [];
						if (fffState.partialIndex)
							notices.push("Warning: partial file index");
						if (grep.items.length >= effectiveLimit)
							notices.push(`${effectiveLimit} limit reached`);
						if (grep.nextCursor) {
							const cursorId = _cursorStore.store(grep.nextCursor);
							notices.push(`More results: cursor="${cursorId}"`);
						}

						const textContent = appendNotices(
							fffFormatGrepText(grep.items, effectiveLimit),
							notices,
						);
						return makeTextResult<GrepResultDetails>(textContent, {
							_type: "grepResult",
							text: textContent,
							pattern,
							matchCount: Math.min(grep.items.length, effectiveLimit),
						});
					} catch {
						/* fall through to SDK */
					}
				}

				if (requestedConstraints || !multiGrepFallback) {
					try {
						const pathBackedConstraint = Boolean(
							requestedConstraints &&
								!requestedPath &&
								requestedConstraints === effectivePath,
						);
						const constraintsForRipgrep = pathBackedConstraint
							? undefined
							: requestedConstraints;
						const notices: string[] = [];

						if (!fffState.finder || fffState.finder.isDestroyed)
							notices.push("FFF unavailable, used ripgrep fallback");
						else if (hasNativeConstraints)
							notices.push("Used ripgrep fallback for constrained search");
						else notices.push("Used ripgrep fallback");

						const rgResult = await multiGrepRipgrepFallback({
							cwd,
							patterns: params.patterns,
							path: effectivePath,
							constraints: constraintsForRipgrep,
							ignoreCase: shouldIgnoreCaseForPatterns(params.patterns),
							context: params.context,
							limit: effectiveLimit,
							signal: sig,
						});
						const textContent =
							normalizeLineEndings(rgResult.text) || "No matches found";
						if (rgResult.limitReached)
							notices.push(`${effectiveLimit} limit reached`);
						const finalText = appendNotices(textContent, notices);

						return makeTextResult<GrepResultDetails>(finalText, {
							_type: "grepResult",
							text: finalText,
							pattern,
							matchCount: rgResult.matchCount,
						});
					} catch (error: unknown) {
						const message = getErrorMessage(error);
						return makeTextResult(`multi_grep error: ${message}`, {
							error: message,
						});
					}
				}

				try {
					const notices: string[] = [];
					if (!fffState.finder || fffState.finder.isDestroyed)
						notices.push("FFF unavailable, used SDK grep fallback");

					const result = await multiGrepFallback.execute(
						tid,
						{
							pattern,
							path: effectivePath,
							ignoreCase: shouldIgnoreCaseForPatterns(params.patterns),
							context: params.context,
							limit: params.limit,
						},
						sig,
						upd as never,
						ctx,
					);
					const textContent =
						normalizeLineEndings(getTextContent(result)) || "No matches found";
					const finalText = appendNotices(textContent, notices);

					return makeTextResult<GrepResultDetails>(finalText, {
						_type: "grepResult",
						text: finalText,
						pattern,
						matchCount: textContent ? countRipgrepMatches(textContent) : 0,
					});
				} catch (error: unknown) {
					const message = getErrorMessage(error);
					return makeTextResult(`multi_grep error: ${message}`, {
						error: message,
					});
				}
			},

			renderCall(
				args: MultiGrepParams,
				theme: ThemeLike,
				ctx: RenderContextLike,
			) {
				resolveBaseBackground(theme);
				const patterns = args.patterns ?? [];
				const path = args.path
					? ` ${theme.fg("muted", `in ${sp(args.path)}`)}`
					: "";
				const constraints = args.constraints;
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				let content =
					theme.fg("toolTitle", theme.bold("multi_grep")) +
					" " +
					theme.fg("accent", patterns.map((p) => `"${p}"`).join(", "));
				content += path;
				if (constraints) content += theme.fg("muted", ` (${constraints})`);
				text.setText(fillToolBackground(content));
				return text;
			},

			renderResult(
				result: ToolResultLike<GrepResultDetails | { error?: string }>,
				_opt: ToolRenderResultOptions,
				theme: ThemeLike,
				ctx: RenderContextLike<MultiGrepRenderState>,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);

				if (ctx.isError) {
					text.setText(
						`\n${theme.fg("error", getTextContent(result) || "Error")}`,
					);
					return text;
				}

				const d = result.details;
				if (d && "_type" in d && d._type === "grepResult" && d.text) {
					const key = `mgrep:${d.pattern}:${d.matchCount}:${termW()}`;
					if (ctx.state._mgk !== key) {
						ctx.state._mgk = key;
						const info = `${FG_DIM}${d.matchCount} matches${RST}`;
						ctx.state._mgt = `  ${info}`;

						renderGrepResults(d.text, d.pattern)
							.then((rendered: string) => {
								if (ctx.state._mgk !== key) return;
								ctx.state._mgt = `  ${info}\n${rendered}`;
								ctx.invalidate();
							})
							.catch(() => {});
					}
					text.setText(
						ctx.state._mgt ?? `  ${FG_DIM}${d.matchCount} matches${RST}`,
					);
					return text;
				}

				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "searched";
				text.setText(
					`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
				);
				return text;
			},
		});
	}

	// ===================================================================
	// edit — split/unified/word-level diff preview
	// ===================================================================

	function getEditOperations(input: EditParams): EditOperation[] {
		if (Array.isArray(input?.edits)) {
			return input.edits
				.map((e) => ({
					oldText:
						typeof e?.oldText === "string"
							? e.oldText
							: typeof e?.old_text === "string"
								? e.old_text
								: "",
					newText:
						typeof e?.newText === "string"
							? e.newText
							: typeof e?.new_text === "string"
								? e.new_text
								: "",
				}))
				.filter((e) => e.oldText && e.oldText !== e.newText);
		}
		const oldText =
			typeof input?.oldText === "string"
				? input.oldText
				: typeof input?.old_text === "string"
					? input.old_text
					: "";
		const newText =
			typeof input?.newText === "string"
				? input.newText
				: typeof input?.new_text === "string"
					? input.new_text
					: "";
		return oldText && oldText !== newText ? [{ oldText, newText }] : [];
	}

	function summarizeEditOperations(operations: EditOperation[]) {
		const diffs = operations.map((e) => parseDiff(e.oldText, e.newText));
		const totalAdded = diffs.reduce((sum, d) => sum + d.added, 0);
		const totalRemoved = diffs.reduce((sum, d) => sum + d.removed, 0);
		return {
			diffs,
			totalAdded,
			totalRemoved,
			summary: summarize(totalAdded, totalRemoved),
		};
	}

	if (createEditTool) {
		const origEdit = createEditTool(cwd);

		pi.registerTool({
			...origEdit,
			name: "edit",

			async execute(
				tid: string,
				params: EditParams,
				sig: AbortSignal | undefined,
				upd: AgentToolUpdateCallback<unknown> | undefined,
				ctx: ExtensionContext,
			) {
				const fp = params.path ?? params.file_path ?? "";
				const operations = getEditOperations(params);
				// params is the live tool input (upstream EditToolInput shape); we
				// type it loosely as EditParams for defensive legacy-field reads, so
				// cast back to the upstream input when delegating to the real tool.
				const result = (await origEdit.execute(
					tid,
					params as unknown as Parameters<typeof origEdit.execute>[1],
					sig,
					upd,
					ctx,
				)) as ToolResultLike;

				if (operations.length === 0) return result;

				const { diffs, summary } = summarizeEditOperations(operations);
				if (operations.length === 1) {
					let editLine = 0;
					try {
						if (fp && existsSync(fp)) {
							const f = readFileSync(fp, "utf-8");
							const idx = f.indexOf(operations[0].newText);
							if (idx >= 0) editLine = f.slice(0, idx).split("\n").length;
						}
					} catch {
						editLine = 0;
					}
					setResultDetails(result, {
						_type: "editInfo",
						summary,
						editLine,
					});
					return result;
				}

				setResultDetails(result, {
					_type: "multiEditInfo",
					summary,
					editCount: operations.length,
					diffLineCount: diffs.reduce((sum, d) => sum + d.lines.length, 0),
				});
				return result;
			},

			renderCall(
				args: EditParams,
				theme: ThemeLike,
				ctx: RenderContextLike<EditRenderState>,
			) {
				resolveBaseBackground(theme);
				const fp = args?.path ?? args?.file_path ?? "";
				const operations = getEditOperations(args);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const hdr = `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", sp(fp))}`;

				if (operations.length === 0) {
					text.setText(fillToolBackground(hdr));
					return text;
				}

				const { summary } = summarizeEditOperations(operations);
				const suffix =
					operations.length === 1
						? summary
						: `${operations.length} edits ${summary}`;
				text.setText(
					fillToolBackground(`${hdr}  ${theme.fg("muted", suffix)}`),
				);
				return text;
			},

			renderResult(
				result: ToolResultLike,
				_opt: ToolRenderResultOptions,
				theme: ThemeLike,
				ctx: RenderContextLike<EditRenderState>,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}
				const d = result.details as RenderDetails | undefined;
				if (d?._type === "editInfo") {
					const loc =
						d.editLine > 0
							? ` ${theme.fg("muted", `at line ${d.editLine}`)}`
							: "";
					text.setText(fillToolBackground(`  ${d.summary}${loc}`));
					return text;
				}
				if (d?._type === "multiEditInfo") {
					const extra =
						typeof d.diffLineCount === "number"
							? ` ${theme.fg("muted", `(${d.diffLineCount} diff lines)`)}`
							: "";
					text.setText(
						fillToolBackground(`  ${d.editCount} edits ${d.summary}${extra}`),
					);
					return text;
				}
				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "edited";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// write — new-file preview + overwrite diff
	// ===================================================================

	if (createWriteTool) {
		const origWrite = createWriteTool(cwd);

		pi.registerTool({
			...origWrite,
			name: "write",

			async execute(
				tid: string,
				params: WriteParams,
				sig: AbortSignal | undefined,
				upd: AgentToolUpdateCallback<unknown> | undefined,
				ctx: ExtensionContext,
			) {
				const fp = params.path ?? params.file_path ?? "";
				let old: string | null = null;
				try {
					if (fp && existsSync(fp)) old = readFileSync(fp, "utf-8");
				} catch {
					old = null;
				}

				const result = (await origWrite.execute(
					tid,
					params as unknown as Parameters<typeof origWrite.execute>[1],
					sig,
					upd,
					ctx,
				)) as ToolResultLike;
				const content = params.content ?? "";

				if (old !== null && old !== content) {
					const diff = parseDiff(old, content);
					setResultDetails(result, {
						_type: "diff",
						summary: summarize(diff.added, diff.removed),
						oldContent: old,
						newContent: content,
						language: lang(fp),
					});
				} else if (old === null) {
					setResultDetails(result, {
						_type: "new",
						lines: content ? content.split("\n").length : 0,
						content,
						filePath: fp,
					});
				} else {
					setResultDetails(result, { _type: "noChange" });
				}
				return result;
			},

			renderCall(
				args: WriteParams,
				theme: ThemeLike,
				ctx: RenderContextLike<WriteRenderState>,
			) {
				resolveBaseBackground(theme);
				const fp = args?.path ?? args?.file_path ?? "";
				const isNew = !fp || !existsSync(fp);
				const label = isNew ? "create" : "write";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const hdr = `${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("accent", sp(fp))}`;

				if (args?.content && isNew) {
					const previewKey = `create:${diffThemeCacheKey(theme)}:${fp}:${String(args.content).length}`;
					if (ctx.state._previewKey !== previewKey) {
						ctx.state._previewKey = previewKey;
						ctx.state._previewText = hdr;
						const lg = lang(fp);
						hlBlock(String(args.content), lg)
							.then((lines) => {
								if (ctx.state._previewKey !== previewKey) return;
								const maxShow = ctx.expanded ? lines.length : 16;
								const preview = lines.slice(0, maxShow).join("\n");
								const rem = lines.length - maxShow;
								let out = `${hdr}\n\n${preview}`;
								if (rem > 0)
									out += `\n${theme.fg("muted", `… (${rem} more lines, ${lines.length} total)`)}`;
								ctx.state._previewText = out;
								ctx.invalidate();
							})
							.catch(() => {});
					}
					text.setText(ctx.state._previewText ?? hdr);
					return text;
				}

				text.setText(fillToolBackground(hdr));
				return text;
			},

			renderResult(
				result: ToolResultLike,
				_opt: ToolRenderResultOptions,
				theme: ThemeLike,
				ctx: RenderContextLike<WriteRenderState>,
			) {
				resolveBaseBackground(theme);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				if (ctx.isError) {
					text.setText(
						renderToolError(getTextContent(result) || "Error", theme),
					);
					return text;
				}
				const d = result.details as RenderDetails | undefined;

				if (d?._type === "diff") {
					const key = `wd:${diffThemeCacheKey(theme)}:${termW()}:${d.summary}:${d.newContent.length}:${d.language ?? ""}`;
					if (ctx.state._wdk !== key) {
						ctx.state._wdk = key;
						ctx.state._wdt = `  ${d.summary}\n${theme.fg("muted", "  rendering diff…")}`;
						const dc = resolveDiffColors(theme);
						const diff = parseDiff(d.oldContent, d.newContent);
						renderSplit(diff, d.language, MAX_RENDER_LINES, dc)
							.then((rendered) => {
								if (ctx.state._wdk !== key) return;
								ctx.state._wdt = `  ${d.summary}\n${rendered}`;
								ctx.invalidate();
							})
							.catch(() => {
								if (ctx.state._wdk !== key) return;
								ctx.state._wdt = `  ${d.summary}`;
								ctx.invalidate();
							});
					}
					text.setText(ctx.state._wdt ?? `  ${d.summary}`);
					return text;
				}
				if (d?._type === "noChange") {
					text.setText(
						fillToolBackground(`  ${theme.fg("muted", "✓ no changes")}`),
					);
					return text;
				}
				if (d?._type === "new") {
					const { lines: lineCount, content: rawContent, filePath: fp } = d;
					const base = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`;
					const pk = `nf:${diffThemeCacheKey(theme)}:${fp}:${lineCount}`;
					if (ctx.state._nfk !== pk) {
						ctx.state._nfk = pk;
						ctx.state._nft = base;
						if (rawContent) {
							hlBlock(rawContent, lang(fp))
								.then((hlLines) => {
									if (ctx.state._nfk !== pk) return;
									const maxShow = ctx.expanded ? hlLines.length : 12;
									const preview = hlLines.slice(0, maxShow).join("\n");
									const rem = hlLines.length - maxShow;
									let out = `${base}\n${preview}`;
									if (rem > 0)
										out += `\n${theme.fg("muted", `  … ${rem} more lines`)}`;
									ctx.state._nft = out;
									ctx.invalidate();
								})
								.catch(() => {});
						}
					}
					text.setText(ctx.state._nft ?? base);
					return text;
				}
				const fallback = result.content?.[0];
				const fallbackText =
					fallback && isTextContent(fallback) ? fallback.text : "written";
				text.setText(
					fillToolBackground(
						`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
					),
				);
				return text;
			},
		});
	}

	// ===================================================================
	// FFF commands
	// ===================================================================

	if (fffState.module) {
		pi.registerCommand("fff-health", {
			description: "Show FFF file finder health and indexer status",
			handler: async (_args: string, ctx: CommandContextLike) => {
				if (!fffState.finder || fffState.finder.isDestroyed) {
					ctx.ui?.notify?.("FFF not initialized", "warning");
					return;
				}

				const health = fffState.finder.healthCheck();
				if (!health.ok) {
					ctx.ui?.notify?.(`Health check failed: ${health.error}`, "error");
					return;
				}

				const h = health.value;
				const lines = [
					`FFF v${h.version}`,
					`Git: ${h.git.repositoryFound ? `yes (${h.git.workdir ?? "unknown"})` : "no"}`,
					`Picker: ${h.filePicker.initialized ? `${h.filePicker.indexedFiles ?? 0} files` : "not initialized"}`,
					`Frecency: ${h.frecency.initialized ? "active" : "disabled"}`,
					`Query tracker: ${h.queryTracker.initialized ? "active" : "disabled"}`,
					`Partial index: ${fffState.partialIndex ? "yes (scan timed out)" : "no"}`,
				];

				const progress = fffState.finder.getScanProgress();
				if (progress.ok) {
					lines.push(
						`Scanning: ${progress.value.isScanning ? "yes" : "no"} (${progress.value.scannedFilesCount} files)`,
					);
				}

				ctx.ui?.notify?.(lines.join("\n"), "info");
			},
		});

		pi.registerCommand("fff-rescan", {
			description: "Trigger FFF to rescan files",
			handler: async (_args: string, ctx: CommandContextLike) => {
				if (!fffState.finder || fffState.finder.isDestroyed) {
					ctx.ui?.notify?.("FFF not initialized", "warning");
					return;
				}

				const result = fffState.finder.scanFiles();
				if (!result.ok) {
					ctx.ui?.notify?.(`Rescan failed: ${result.error}`, "error");
					return;
				}

				fffState.partialIndex = false;
				ctx.ui?.notify?.("FFF rescan triggered", "info");
			},
		});
	}
}
