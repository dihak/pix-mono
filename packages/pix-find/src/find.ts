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
import type {
	FindParams,
	FindResultDetails,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@dihak/pix-pretty/types";
import {
	appendNotices,
	fillToolBackground,
	getErrorMessage,
	getTextContent,
	hideCollapsedToolCall,
	makeTextResult,
	renderCollapsedToolRow,
	renderDimPreview,
	renderToolError,
	setResultDetails,
} from "@dihak/pix-pretty/utils";
import type {
	ExtensionContext,
	FindToolInput,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_FIND_LIMIT = 200;

const FILE_NOUNS = ["file", "files"] as const;

export function applyFindDefaults(params: FindParams): FindParams {
	return params.limit === undefined ? { ...params, limit: DEFAULT_FIND_LIMIT } : params;
}

async function executeFindOnce(
	origFind: ReturnType<ToolFactory<FindToolInput>>,
	tid: string,
	params: FindParams & { pattern: string },
	sig: AbortSignal | undefined,
	upd: unknown,
	toolCtx: ExtensionContext,
	fffState: ToolContext["fffState"],
): Promise<ToolResultLike<FindResultDetails>> {
	const effectiveParams = applyFindDefaults(params);
	const pattern = params.pattern;

	if (fffState.finder && !fffState.finder.isDestroyed) {
		try {
			const effectiveLimit = Math.max(1, effectiveParams.limit ?? DEFAULT_FIND_LIMIT);
			let query = pattern;
			if (effectiveParams.path) query = `${effectiveParams.path} ${query}`;

			const searchResult = fffState.finder.fileSearch(query, {
				pageSize: effectiveLimit,
			});
			if (searchResult.ok) {
				const { items, totalMatched } = searchResult.value;
				const trimmed = items.slice(0, effectiveLimit);
				const notices: string[] = [];
				if (fffState.partialIndex) notices.push("Warning: partial file index");
				if (trimmed.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
				if (totalMatched > trimmed.length) notices.push(`${totalMatched} total matches`);

				const textContent = appendNotices(
					trimmed.map((item) => item.relativePath).join("\n"),
					notices,
				);
				return makeTextResult<FindResultDetails>(textContent, {
					_type: "findResult",
					text: textContent,
					pattern,
					path: effectiveParams.path,
					matchCount: trimmed.length,
				});
			}
		} catch {
			/* fall through to SDK */
		}
	}

	const result = await origFind.execute(
		tid,
		effectiveParams as FindToolInput,
		sig,
		upd as never,
		toolCtx,
	);
	const textContent = getTextContent(result);
	const matchCount = textContent ? textContent.trim().split("\n").filter(Boolean).length : 0;

	setResultDetails<FindResultDetails>(result, {
		_type: "findResult",
		text: textContent,
		pattern: params.pattern,
		path: params.path,
		matchCount,
	});

	return result as ToolResultLike<FindResultDetails>;
}

export function registerFindTool(
	pi: PiPrettyApi,
	createFindTool: ToolFactory<FindToolInput>,
	ctx: ToolContext,
): void {
	const { cwd, sp, TextComponent, fffState } = ctx;
	const origFind = createFindTool(cwd);

	pi.registerTool({
		...origFind,
		name: "find",
		description:
			"Find files by glob pattern. Defaults to 200 paths; use limit to request more. Respects .gitignore and remains capped by Pi's 50KB hard limit. Pass patterns to search several known globs in one call.",
		parameters: withOptionalStringArray(
			origFind.parameters,
			"patterns",
			"Known globs in one call.",
			["pattern"],
		),
		renderShell: "self",

		async execute(
			tid: string,
			params: FindParams,
			sig: AbortSignal | undefined,
			upd: unknown,
			toolCtx: ExtensionContext,
		) {
			const { targets, omitted } = sliceBatchTargets(
				resolveBatchStrings(params.pattern, params.patterns),
			);
			if (targets.length === 0) {
				return makeTextResult<FindResultDetails>("pattern or patterns required", {
					_type: "findResult",
					text: "pattern or patterns required",
					pattern: "",
					path: params.path,
					matchCount: 0,
				});
			}

			const run = (pattern: string, callId: string) => {
				const { patterns: _patterns, ...rest } = params;
				return executeFindOnce(origFind, callId, { ...rest, pattern }, sig, upd, toolCtx, fffState);
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
					return { id: entry.pattern, body: "", units: 0, nouns: FILE_NOUNS, error: entry.error };
				}
				const details = entry.result.details;
				const body = details?._type === "findResult" ? details.text : getTextContent(entry.result);
				const units =
					details?._type === "findResult"
						? details.matchCount
						: body.trim().split("\n").filter(Boolean).length;
				return { id: entry.pattern, body, units, nouns: FILE_NOUNS };
			});

			const { text, sections: capped } = capSections(
				sections,
				BATCH_MAX_BYTES,
				params.limit ?? DEFAULT_FIND_LIMIT,
				omitted,
			);
			const matchCount = capped.reduce(
				(sum, section) => sum + (section.error ? 0 : section.units),
				0,
			);
			const full = [formatBatchIndex(sections, omitted), joinSectionBodies(sections)]
				.filter(Boolean)
				.join("\n\n");
			return makeTextResult<FindResultDetails>(text, {
				_type: "findResult",
				text: full,
				pattern: targets.join(", "),
				patterns: targets,
				path: params.path,
				matchCount,
			});
		},

		renderCall(args: FindParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const patterns = resolveBatchStrings(args.pattern, args.patterns);
			const pattern = formatCallTargets(patterns, 3, "patterns") || (args.pattern ?? "");
			const path = args.path ? ` ${theme.fg("muted", `in ${sp(args.path)}`)}` : "";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (
				hideCollapsedToolCall(renderCtx.state as CollapseState, renderCtx.expanded, (value) =>
					text.setText(value),
				)
			)
				return text;
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
			renderCtx: RenderContextLike,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			const d = result.details;
			const isPartial = _opt?.isPartial === true;
			const structuredError = renderCtx.isError && d?._type === "findResult";

			if (renderCtx.isError && (!structuredError || isPartial)) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const cs = renderCtx.state as CollapseState;
			if (!isPartial && tickCollapse("find", cs, renderCtx.invalidate, renderCtx.expanded)) {
				const summary =
					d?._type === "findResult" && d.matchCount != null ? `${d.matchCount} files` : "found";
				const target = d?._type === "findResult" ? d.pattern : "";
				const scope = d?._type === "findResult" && d.path ? ` in ${sp(d.path)}` : "";
				text.setText(
					renderCollapsedToolRow(
						theme,
						"find",
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
				(d?._type === "findResult" ? d.text : undefined) || getTextContent(result) || "found";
			text.setText(renderDimPreview(output, theme));
			return text;
		},
	});
}
