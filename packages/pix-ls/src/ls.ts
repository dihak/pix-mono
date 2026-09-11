import { type CollapseState, tickCollapse } from "@dihak/pix-data/collapse";
import { FG_DIM, RST } from "@dihak/pix-pretty/ansi";
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
import { renderTree } from "@dihak/pix-pretty/renderers";
import type {
	LsBatchDetails,
	LsParams,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@dihak/pix-pretty/types";
import {
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
	AgentToolUpdateCallback,
	ExtensionContext,
	LsToolInput,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_LS_LIMIT = 200;

const ENTRY_NOUNS = ["entry", "entries"] as const;

export function applyLsDefaults(params: LsParams): LsParams {
	return params.limit === undefined ? { ...params, limit: DEFAULT_LS_LIMIT } : params;
}

export function registerLsTool(
	pi: PiPrettyApi,
	createLsTool: ToolFactory<LsToolInput>,
	ctx: ToolContext,
): void {
	const { cwd, sp, TextComponent } = ctx;
	const origLs = createLsTool(cwd);

	pi.registerTool({
		...origLs,
		name: "ls",
		description:
			"List a directory, including dotfiles. Defaults to 200 sorted entries; use limit to request more. Output remains capped by Pi's 50KB hard limit. Pass paths to list several known directories in one call.",
		parameters: withOptionalStringArray(
			origLs.parameters,
			"paths",
			"Known directories in one call.",
		),
		renderShell: "self",

		async execute(
			tid: string,
			params: LsParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const { targets, omitted } = sliceBatchTargets(
				resolveBatchStrings(params.path, params.paths),
			);
			const run = async (path: string | undefined, callId: string) => {
				const { paths: _paths, ...rest } = params;
				const effectiveParams = applyLsDefaults({ ...rest, path });
				const result = (await origLs.execute(
					callId,
					effectiveParams,
					sig,
					upd,
					toolCtx,
				)) as ToolResultLike;
				const textContent = getTextContent(result);
				const fp = effectiveParams.path ?? cwd;
				const entryCount = textContent ? textContent.trim().split("\n").filter(Boolean).length : 0;
				setResultDetails(result, {
					_type: "lsResult",
					text: textContent ?? "",
					path: fp,
					entryCount,
				});
				return result;
			};

			if (targets.length <= 1 && omitted === 0) {
				return run(targets[0], tid);
			}

			const settled = await Promise.all(
				targets.map(async (path, i) => {
					try {
						return { path, result: await run(path, `${tid}:${i}`) };
					} catch (error) {
						return { path, error: getErrorMessage(error) };
					}
				}),
			);

			const sections: BatchSection[] = settled.map((entry) => {
				if ("error" in entry) {
					return { id: entry.path, body: "", units: 0, nouns: ENTRY_NOUNS, error: entry.error };
				}
				const d = entry.result.details as { text?: string; entryCount?: number } | undefined;
				const body = d?.text ?? getTextContent(entry.result);
				const units = d?.entryCount ?? body.trim().split("\n").filter(Boolean).length;
				return { id: entry.path, body, units, nouns: ENTRY_NOUNS };
			});

			const { text, sections: capped } = capSections(
				sections,
				BATCH_MAX_BYTES,
				params.limit ?? DEFAULT_LS_LIMIT,
				omitted,
			);
			const entryCount = capped.reduce(
				(sum, section) => sum + (section.error ? 0 : section.units),
				0,
			);
			const index = formatBatchIndex(sections, omitted);
			return makeTextResult<LsBatchDetails>(text, {
				_type: "lsBatch",
				text: [index, joinSectionBodies(sections)].filter(Boolean).join("\n\n"),
				paths: targets,
				entryCount,
				index,
			});
		},

		renderCall(args: LsParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const targets = resolveBatchStrings(args.path, args.paths);
			const fp = formatCallTargets(targets.map(sp), 3, "dirs") || (args.path ? sp(args.path) : ".");
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (
				hideCollapsedToolCall(renderCtx.state as CollapseState, renderCtx.expanded, (value) =>
					text.setText(value),
				)
			)
				return text;
			text.setText(
				fillToolBackground(`${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", fp)}`),
			);
			return text;
		},

		renderResult(
			result: ToolResultLike,
			_opt: unknown,
			theme: ThemeLike,
			renderCtx: RenderContextLike,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			const d = result.details as Record<string, unknown> | undefined;
			const isPartial = (_opt as { isPartial?: boolean } | undefined)?.isPartial === true;
			const structuredError =
				renderCtx.isError && (d?._type === "lsResult" || d?._type === "lsBatch");

			if (renderCtx.isError && (!structuredError || isPartial)) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const cs = renderCtx.state as CollapseState;
			if (!isPartial && tickCollapse("ls", cs, renderCtx.invalidate, renderCtx.expanded)) {
				if (d?._type === "lsBatch") {
					const batch = d as unknown as LsBatchDetails;
					text.setText(
						renderCollapsedToolRow(
							theme,
							"ls",
							formatCallTargets(batch.paths.map(sp), 3, "dirs"),
							renderCtx.isError ? "failed" : `${batch.entryCount} entries`,
							renderCtx.isError ? "error" : "success",
						),
					);
					return text;
				}
				const summary = d?._type === "lsResult" ? `${d.entryCount} entries` : "listed";
				const target = d?._type === "lsResult" ? sp(String(d.path ?? ".")) : ".";
				text.setText(
					renderCollapsedToolRow(
						theme,
						"ls",
						target,
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
			if (d?._type === "lsBatch") {
				const batch = d as unknown as LsBatchDetails;
				text.setText(
					renderDimPreview(batch.text || batch.index, theme, {
						header: `${batch.entryCount} entries`,
					}),
				);
				return text;
			}
			if (d?._type === "lsResult" && d.text) {
				const tree = renderTree(d.text as string, d.path as string);
				const info = `${FG_DIM}${d.entryCount} entries${RST}`;
				text.setText(fillToolBackground(`  ${info}\n${tree}`));
				return text;
			}

			const output = getTextContent(result) || "listed";
			text.setText(fillToolBackground(`  ${theme.fg("dim", output.slice(0, 120))}`));
			return text;
		},
	});
}
