import { existsSync, readFileSync } from "node:fs";
import type {
	AgentToolUpdateCallback,
	EditToolInput,
	ExtensionContext,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";

import { MAX_RENDER_LINES } from "@xynogen/pix-pretty/config";
import type { ToolContext } from "@xynogen/pix-pretty/context";
import { parseDiff } from "@xynogen/pix-pretty/diff";
import {
	diffThemeCacheKey,
	renderSplit,
	resolveDiffColors,
	summarize,
} from "@xynogen/pix-pretty/diff-render";
import { lang } from "@xynogen/pix-pretty/lang";
import type {
	EditOperation,
	EditParams,
	EditRenderState,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@xynogen/pix-pretty/types";
import {
	fillToolBackground,
	getTextContent,
	isTextContent,
	renderToolError,
	setResultDetails,
	termW,
} from "@xynogen/pix-pretty/utils";

// ── Helpers ────────────────────────────────────────────────────────────

export function getEditOperations(input: EditParams): EditOperation[] {
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

export function summarizeEditOperations(operations: EditOperation[]) {
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

// ── Tool ───────────────────────────────────────────────────────────────

export function registerEditTool(
	pi: PiPrettyApi,
	createEditTool: ToolFactory<EditToolInput>,
	ctx: ToolContext,
	trackInvalidator: (id: string, inv: () => void) => void,
): void {
	const { cwd, sp, TextComponent } = ctx;
	const origEdit = createEditTool(cwd);

	pi.registerTool({
		...origEdit,
		name: "edit",

		async execute(
			tid: string,
			params: EditParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const fp = params.path ?? params.file_path ?? "";
			const operations = getEditOperations(params);
			const fileLang = lang(fp);

			const result = (await origEdit.execute(
				tid,
				params as unknown as Parameters<typeof origEdit.execute>[1],
				sig,
				upd,
				toolCtx,
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
					oldContent: operations[0].oldText,
					newContent: operations[0].newText,
					language: fileLang,
					filePath: fp,
				});
				return result;
			}

			setResultDetails(result, {
				_type: "multiEditInfo",
				summary,
				editCount: operations.length,
				diffLineCount: diffs.reduce((sum, d) => sum + d.lines.length, 0),
				ops: operations.map((op) => ({
					oldContent: op.oldText,
					newContent: op.newText,
					language: fileLang,
					filePath: fp,
				})),
			});
			return result;
		},

		renderCall(
			args: EditParams,
			theme: ThemeLike,
			renderCtx: RenderContextLike<EditRenderState>,
		) {
			const fp = args?.path ?? args?.file_path ?? "";
			const operations = getEditOperations(args);
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
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
			text.setText(fillToolBackground(`${hdr}  ${theme.fg("muted", suffix)}`));
			return text;
		},

		renderResult(
			result: ToolResultLike,
			_opt: ToolRenderResultOptions,
			theme: ThemeLike,
			renderCtx: RenderContextLike<EditRenderState>,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}
			const d = result.details as Record<string, unknown> | undefined;

			// Single edit — full split diff
			if (d?._type === "editInfo") {
				const key = `ed:${diffThemeCacheKey(theme)}:${termW()}:${d.summary}:${(d.oldContent as string).length}:${(d.newContent as string).length}:${d.language ?? ""}`;
				if (renderCtx.toolCallId)
					trackInvalidator(renderCtx.toolCallId, renderCtx.invalidate);
				if (renderCtx.state._edk !== key) {
					renderCtx.state._edk = key;
					const loc =
						(d.editLine as number) > 0
							? ` ${theme.fg("muted", `at line ${d.editLine}`)}`
							: "";
					renderCtx.state._edt = `  ${d.summary}${loc}\n${theme.fg("muted", "  rendering diff…")}`;
					const dc = resolveDiffColors(theme);
					const diff = parseDiff(
						d.oldContent as string,
						d.newContent as string,
					);
					renderSplit(
						diff,
						d.language as string | undefined,
						MAX_RENDER_LINES,
						dc,
					)
						.then((rendered) => {
							if (renderCtx.state._edk !== key) return;
							const loc2 =
								(d.editLine as number) > 0
									? ` ${theme.fg("muted", `at line ${d.editLine}`)}`
									: "";
							renderCtx.state._edt = `  ${d.summary}${loc2}\n${rendered}`;
							renderCtx.invalidate();
						})
						.catch(() => {
							if (renderCtx.state._edk !== key) return;
							renderCtx.state._edt = `  ${d.summary}`;
							renderCtx.invalidate();
						});
				}
				text.setText(renderCtx.state._edt ?? `  ${d.summary}`);
				return text;
			}

			// Multi-edit — stacked diffs
			if (d?._type === "multiEditInfo") {
				const key = `med:${diffThemeCacheKey(theme)}:${termW()}:${d.summary}:${d.editCount}:${d.diffLineCount}`;
				if (renderCtx.toolCallId)
					trackInvalidator(renderCtx.toolCallId, renderCtx.invalidate);
				if (renderCtx.state._edk !== key) {
					renderCtx.state._edk = key;
					renderCtx.state._edt = `  ${d.editCount} edits ${d.summary}\n${theme.fg("muted", "  rendering diff…")}`;
					const dc = resolveDiffColors(theme);
					Promise.all(
						(
							d.ops as Array<{
								oldContent: string;
								newContent: string;
								language?: string;
							}>
						).map((op) => {
							const diff = parseDiff(op.oldContent, op.newContent);
							return renderSplit(diff, op.language, MAX_RENDER_LINES, dc);
						}),
					)
						.then((rendered) => {
							if (renderCtx.state._edk !== key) return;
							const body = rendered.join(`\n${theme.fg("muted", "  ···")}\n`);
							renderCtx.state._edt = `  ${d.editCount} edits ${d.summary}\n${body}`;
							renderCtx.invalidate();
						})
						.catch(() => {
							if (renderCtx.state._edk !== key) return;
							renderCtx.state._edt = `  ${d.editCount} edits ${d.summary}`;
							renderCtx.invalidate();
						});
				}
				text.setText(
					renderCtx.state._edt ?? `  ${d.editCount} edits ${d.summary}`,
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
