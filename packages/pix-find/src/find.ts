import type {
	ExtensionContext,
	FindToolInput,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";

import type {
	FindParams,
	FindResultDetails,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@xynogen/pix-pretty/types";
import {
	appendNotices,
	fillToolBackground,
	getTextContent,
	makeTextResult,
	renderDimPreview,
	renderToolError,
	setResultDetails,
} from "@xynogen/pix-pretty/utils";
import type { ToolContext } from "@xynogen/pix-pretty/context";

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
		renderShell: "self",

		async execute(
			tid: string,
			params: FindParams,
			sig: AbortSignal | undefined,
			upd: unknown,
			toolCtx: ExtensionContext,
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
						const { items, totalMatched } = searchResult.value;
						const trimmed = items.slice(0, effectiveLimit);
						const notices: string[] = [];
						if (fffState.partialIndex)
							notices.push("Warning: partial file index");
						if (trimmed.length >= effectiveLimit)
							notices.push(`${effectiveLimit} limit reached`);
						if (totalMatched > trimmed.length)
							notices.push(`${totalMatched} total matches`);

						const textContent = appendNotices(
							trimmed.map((item) => item.relativePath).join("\n"),
							notices,
						);
						return makeTextResult<FindResultDetails>(textContent, {
							_type: "findResult",
							text: textContent,
							pattern: params.pattern,
							matchCount: trimmed.length,
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
				toolCtx,
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

		renderCall(
			args: FindParams,
			theme: ThemeLike,
			renderCtx: RenderContextLike,
		) {
			const pattern = args.pattern ?? "";
			const path = args.path
				? ` ${theme.fg("muted", `in ${sp(args.path)}`)}`
				: "";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
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

			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const output = getTextContent(result) || "found";
			text.setText(renderDimPreview(output, theme));
			return text;
		},
	});
}
