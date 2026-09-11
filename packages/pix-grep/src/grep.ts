import { type CollapseState, tickCollapse } from "@dihak/pix-data/collapse";
import {
	BATCH_MAX_BYTES,
	type BatchSection,
	capSections,
	formatBatchIndex,
	formatCallTargets,
	joinSectionBodies,
	resolveBatchStrings,
	sliceBatchTargets,
	withOptionalStringArray,
} from "@dihak/pix-pretty/batch";
import type { ToolContext } from "@dihak/pix-pretty/context";
import { fffFormatGrepText } from "@dihak/pix-pretty/fff";
import type {
	GrepParams,
	GrepResultDetails,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@dihak/pix-pretty/types";
import {
	appendNotices,
	countRipgrepMatches,
	fillToolBackground,
	getErrorMessage,
	getTextContent,
	hideCollapsedToolCall,
	isTextContent,
	makeTextResult,
	normalizeLineEndings,
	pluralize,
	renderCollapsedToolRow,
	renderDimPreview,
	renderToolError,
	setResultDetails,
} from "@dihak/pix-pretty/utils";
import type {
	ExtensionContext,
	GrepToolInput,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_GREP_LIMIT = 30;

const MATCH_NOUNS = ["match", "matches"] as const;

export function applyGrepDefaults(params: GrepParams): GrepParams {
	return params.limit === undefined ? { ...params, limit: DEFAULT_GREP_LIMIT } : params;
}

async function executeGrepOnce(
	origGrep: ReturnType<ToolFactory<GrepToolInput>>,
	tid: string,
	params: GrepParams & { pattern: string },
	sig: AbortSignal | undefined,
	upd: unknown,
	toolCtx: ExtensionContext,
	fffState: ToolContext["fffState"],
	cursorStore: ToolContext["cursorStore"],
): Promise<ToolResultLike<GrepResultDetails>> {
	const effectiveParams = applyGrepDefaults(params);
	const pattern = params.pattern;

	if (
		fffState.finder &&
		!fffState.finder.isDestroyed &&
		!effectiveParams.path &&
		!effectiveParams.glob
	) {
		try {
			const effectiveLimit = Math.max(1, effectiveParams.limit ?? DEFAULT_GREP_LIMIT);
			const grepResult = fffState.finder.grep(pattern, {
				mode: effectiveParams.literal ? "plain" : "regex",
				smartCase: !effectiveParams.ignoreCase,
				maxMatchesPerFile: Math.min(effectiveLimit, 50),
				cursor: null,
				beforeContext: effectiveParams.context ?? 0,
				afterContext: effectiveParams.context ?? 0,
			});

			if (grepResult.ok) {
				const grep = grepResult.value;
				const notices: string[] = [];
				if (fffState.partialIndex) notices.push("Warning: partial file index");
				if (grep.items.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
				if (grep.regexFallbackError)
					notices.push(`Regex failed: ${grep.regexFallbackError}, used literal match`);
				if (grep.nextCursor) {
					const cursorId = cursorStore.store(grep.nextCursor);
					notices.push(`More results available. Use cursor="${cursorId}" to continue`);
				}

				const textContent = appendNotices(fffFormatGrepText(grep.items, effectiveLimit), notices);
				return makeTextResult<GrepResultDetails>(textContent, {
					_type: "grepResult",
					text: textContent,
					pattern,
					path: effectiveParams.path,
					matchCount: Math.min(grep.items.length, effectiveLimit),
				});
			}
		} catch {
			/* fall through to SDK */
		}
	}

	const result = await origGrep.execute(
		tid,
		effectiveParams as GrepToolInput,
		sig,
		upd as never,
		toolCtx,
	);
	const textContent = normalizeLineEndings(getTextContent(result));
	if (result.content) {
		for (const content of result.content) {
			if (isTextContent(content)) content.text = normalizeLineEndings(content.text || "");
		}
	}
	const matchCount = textContent ? countRipgrepMatches(textContent) : 0;

	setResultDetails<GrepResultDetails>(result, {
		_type: "grepResult",
		text: textContent,
		pattern: params.pattern,
		path: params.path,
		matchCount,
	});

	return result as ToolResultLike<GrepResultDetails>;
}

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
		description:
			"Search file contents for a regex or literal pattern. Defaults to 30 matches; use limit to request more. Respects .gitignore and remains capped by Pi's 50KB hard limit. Pass patterns to search several known patterns in one call.",
		parameters: withOptionalStringArray(
			origGrep.parameters,
			"patterns",
			"Known patterns in one call.",
			["pattern"],
		),
		renderShell: "self",

		async execute(
			tid: string,
			params: GrepParams,
			sig: AbortSignal | undefined,
			upd: unknown,
			toolCtx: ExtensionContext,
		) {
			const { targets, omitted } = sliceBatchTargets(
				resolveBatchStrings(params.pattern, params.patterns),
			);
			if (targets.length === 0) {
				return makeTextResult<GrepResultDetails>("pattern or patterns required", {
					_type: "grepResult",
					text: "pattern or patterns required",
					pattern: "",
					path: params.path,
					matchCount: 0,
				});
			}

			const run = (pattern: string, callId: string) => {
				const { patterns: _patterns, ...rest } = params;
				return executeGrepOnce(
					origGrep,
					callId,
					{ ...rest, pattern },
					sig,
					upd,
					toolCtx,
					fffState,
					cursorStore,
				);
			};

			if (targets.length === 1 && omitted === 0) {
				return run(targets[0] ?? "", tid);
			}

			const settled = await Promise.all(
				targets.map(async (pattern, i) => {
					try {
						return { pattern, result: await run(pattern, `${tid}:${i}`) };
					} catch (error) {
						return { pattern, error: getErrorMessage(error) };
					}
				}),
			);

			const sections: BatchSection[] = settled.map((entry) => {
				if ("error" in entry) {
					return { id: entry.pattern, body: "", units: 0, nouns: MATCH_NOUNS, error: entry.error };
				}
				const details = entry.result.details;
				const body = details?._type === "grepResult" ? details.text : getTextContent(entry.result);
				const units =
					details?._type === "grepResult" ? details.matchCount : countRipgrepMatches(body);
				return { id: entry.pattern, body, units, nouns: MATCH_NOUNS };
			});

			const { text, sections: capped } = capSections(
				sections,
				BATCH_MAX_BYTES,
				params.limit ?? DEFAULT_GREP_LIMIT,
				omitted,
			);
			const matchCount = capped.reduce(
				(sum, section) => sum + (section.error ? 0 : section.units),
				0,
			);
			const full = [formatBatchIndex(sections, omitted), joinSectionBodies(sections)]
				.filter(Boolean)
				.join("\n\n");
			return makeTextResult<GrepResultDetails>(text, {
				_type: "grepResult",
				text: full,
				pattern: targets.join(", "),
				patterns: targets,
				path: params.path,
				matchCount,
			});
		},

		renderCall(args: GrepParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const patterns = resolveBatchStrings(args.pattern, args.patterns);
			const pattern = formatCallTargets(patterns, 3, "patterns") || (args.pattern ?? "");
			const path = args.path ? ` ${theme.fg("muted", `in ${sp(args.path)}`)}` : "";
			const glob = args.glob ? ` ${theme.fg("muted", `(${args.glob})`)}` : "";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (
				hideCollapsedToolCall(renderCtx.state as CollapseState, renderCtx.expanded, (value) =>
					text.setText(value),
				)
			)
				return text;
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
			const d = result.details;
			const isPartial = _opt?.isPartial === true;
			const structuredError = renderCtx.isError && d?._type === "grepResult";

			if (renderCtx.isError && (!structuredError || isPartial)) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const cs = renderCtx.state as CollapseState;
			if (!isPartial && tickCollapse("grep", cs, renderCtx.invalidate, renderCtx.expanded)) {
				const summary =
					d?._type === "grepResult" ? pluralize(d.matchCount, "match", "matches") : "searched";
				const target = d?._type === "grepResult" ? `“${d.pattern}”` : "";
				const scope = d?._type === "grepResult" && d.path ? ` in ${sp(d.path)}` : "";
				text.setText(
					renderCollapsedToolRow(
						theme,
						"grep",
						`${target}${scope}`,
						renderCtx.isError ? "failed" : summary,
						renderCtx.isError ? "error" : "success",
					),
				);
				return text;
			}

			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const output =
				(d?._type === "grepResult" ? d.text : undefined) || getTextContent(result) || "searched";
			text.setText(
				renderDimPreview(output, theme, {
					header:
						d?._type === "grepResult" ? pluralize(d.matchCount, "match", "matches") : undefined,
					highlight: d?._type === "grepResult" && !d.patterns?.length ? d.pattern : undefined,
				}),
			);
			return text;
		},
	});
}
