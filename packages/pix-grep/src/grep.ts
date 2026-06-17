import type {
	ExtensionContext,
	GrepToolInput,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { ToolContext } from "@xynogen/pix-pretty/context";
import { fffFormatGrepText } from "@xynogen/pix-pretty/fff";
import type {
	GrepParams,
	GrepResultDetails,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@xynogen/pix-pretty/types";
import {
	appendNotices,
	countRipgrepMatches,
	fillToolBackground,
	getTextContent,
	isTextContent,
	makeTextResult,
	normalizeLineEndings,
	pluralize,
	renderDimPreview,
	renderToolError,
	setResultDetails,
} from "@xynogen/pix-pretty/utils";

export function registerGrepTool(
	pi: PiPrettyApi,
	createGrepTool: ToolFactory<GrepToolInput>,
	ctx: ToolContext,
): void {
	const { cwd, sp, TextComponent, fffState, cursorStore } = ctx;
	const origGrep = createGrepTool(cwd);

	pi.registerTool({
		...origGrep,
		name: "grep",
		renderShell: "self",

		async execute(
			tid: string,
			params: GrepParams,
			sig: AbortSignal | undefined,
			upd: unknown,
			toolCtx: ExtensionContext,
		) {
			// Try FFF first (SIMD-accelerated).
			// Constrained searches (path/glob) fall through to SDK — FFF 0.5.2
			// can abort the process on constrained searches with Unicode filenames.
			if (
				fffState.finder &&
				!fffState.finder.isDestroyed &&
				!params.path &&
				!params.glob
			) {
				try {
					const effectiveLimit = Math.max(1, params.limit ?? 100);
					const grepResult = fffState.finder.grep(params.pattern, {
						mode: params.literal ? "plain" : "regex",
						smartCase: !params.ignoreCase,
						maxMatchesPerFile: Math.min(effectiveLimit, 50),
						cursor: null,
						beforeContext: params.context ?? 0,
						afterContext: params.context ?? 0,
					});

					if (grepResult.ok) {
						const grep = grepResult.value;
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
							const cursorId = cursorStore.store(grep.nextCursor);
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
				toolCtx,
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

		renderCall(
			args: GrepParams,
			theme: ThemeLike,
			renderCtx: RenderContextLike,
		) {
			const pattern = args.pattern ?? "";
			const path = args.path
				? ` ${theme.fg("muted", `in ${sp(args.path)}`)}`
				: "";
			const glob = args.glob ? ` ${theme.fg("muted", `(${args.glob})`)}` : "";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
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
			renderCtx: RenderContextLike,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);

			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const d = result.details;
			const output = getTextContent(result) || "searched";
			text.setText(
				renderDimPreview(output, theme, {
					header:
						d?._type === "grepResult"
							? pluralize(d.matchCount, "match", "matches")
							: undefined,
					highlight: d?._type === "grepResult" ? d.pattern : undefined,
				}),
			);
			return text;
		},
	});
}
