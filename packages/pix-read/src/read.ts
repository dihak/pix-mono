import { type CollapseState, tickCollapse } from "@dihak/pix-data/collapse";
import { FG_DIM, RST } from "@dihak/pix-pretty/ansi";
import {
	BATCH_MAX_BYTES,
	type BatchSection,
	capSections,
	formatCallTargets,
	resolveBatchStrings,
	sliceBatchTargets,
	withOptionalStringArray,
} from "@dihak/pix-pretty/batch";
import { MAX_PREVIEW_LINES } from "@dihak/pix-pretty/config";
import type { ToolContext } from "@dihak/pix-pretty/context";
import { fileIcon } from "@dihak/pix-pretty/icons";
import { renderFileContent } from "@dihak/pix-pretty/renderers";
import type {
	PiPrettyApi,
	ReadBatchDetails,
	ReadErrorDetails,
	ReadFileDetails,
	ReadImageDetails,
	ReadParams,
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
	humanSize,
	isImageContent,
	isTextContent,
	makeTextResult,
	normalizeLineEndings,
	renderCollapsedToolRow,
	renderDimPreview,
	renderToolError,
	setResultDetails,
} from "@dihak/pix-pretty/utils";
import type {
	AgentToolUpdateCallback,
	ExtensionContext,
	ReadToolInput,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_READ_LIMIT = 400;

const LINE_NOUNS = ["line", "lines"] as const;

export function applyReadDefaults(params: ReadParams): ReadParams {
	return params.limit === undefined ? { ...params, limit: DEFAULT_READ_LIMIT } : params;
}

type ReadItem = ReadFileDetails | ReadImageDetails | ReadErrorDetails;

function decorateTextResult(result: ToolResultLike, fp: string, offset: number): ToolResultLike {
	const imageBlock = result.content?.find(isImageContent);
	if (imageBlock) {
		setResultDetails(result, {
			_type: "readImage",
			filePath: fp,
			data: imageBlock.data,
			mimeType: imageBlock.mimeType ?? "image/png",
		} satisfies ReadImageDetails);
		return result;
	}

	const textContent = getTextContent(result);
	if (textContent && fp) {
		const normalizedContent = normalizeLineEndings(textContent);
		setResultDetails(result, {
			_type: "readFile",
			filePath: fp,
			content: normalizedContent,
			offset,
			lineCount: normalizedContent.split("\n").length,
		} satisfies ReadFileDetails);
	}
	return result;
}

function itemFromResult(fp: string, offset: number, result: ToolResultLike): ReadItem {
	const d = result.details as ReadItem | undefined;
	if (d?._type === "readImage" || d?._type === "readFile") return d;
	const text = getTextContent(result);
	return {
		_type: "readFile",
		filePath: fp,
		content: normalizeLineEndings(text),
		offset,
		lineCount: text ? text.split("\n").length : 0,
	};
}

function sectionFromItem(item: ReadItem): BatchSection {
	if (item._type === "readError") {
		return { id: item.filePath, body: "", units: 0, nouns: LINE_NOUNS, error: item.message };
	}
	if (item._type === "readImage") {
		return { id: item.filePath, body: "", units: 1, nouns: ["image", "images"] };
	}
	return {
		id: item.filePath,
		body: item.content,
		units: item.lineCount,
		nouns: LINE_NOUNS,
		hint: "use offset",
	};
}

export function registerReadTool(
	pi: PiPrettyApi,
	createReadTool: ToolFactory<ReadToolInput>,
	ctx: ToolContext,
): void {
	const { cwd, sp, TextComponent } = ctx;
	const origRead = createReadTool(cwd);

	pi.registerTool({
		...origRead,
		name: "read",
		description:
			"Read text files and images. Text reads default to 400 lines and remain capped by Pi's 2,000-line/50KB hard limit. Use offset/limit to continue large files. Pass paths to read several known files in one call.",
		parameters: withOptionalStringArray(origRead.parameters, "paths", "Known files in one call.", [
			"path",
		]),
		renderShell: "self",

		async execute(
			tid: string,
			params: ReadParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const { targets, omitted } = sliceBatchTargets(
				resolveBatchStrings(params.path, params.paths),
			);
			if (targets.length === 0) {
				return makeTextResult<ReadErrorDetails>("path or paths required", {
					_type: "readError",
					filePath: "",
					message: "path or paths required",
				});
			}

			const offset = params.offset ?? 1;
			const runOne = async (path: string, callId: string) => {
				const { paths: _paths, ...rest } = params;
				const effectiveParams = applyReadDefaults({ ...rest, path });
				const result = (await origRead.execute(
					callId,
					effectiveParams as unknown as ReadToolInput,
					sig,
					upd,
					toolCtx,
				)) as ToolResultLike;
				return decorateTextResult(result, path, offset);
			};

			if (targets.length === 1 && omitted === 0) {
				return runOne(targets[0] ?? "", tid);
			}

			const settled = await Promise.all(
				targets.map(async (path, i) => {
					try {
						return { path, result: await runOne(path, `${tid}:${i}`) };
					} catch (error) {
						return { path, error: getErrorMessage(error) };
					}
				}),
			);

			const items: ReadItem[] = settled.map((entry) =>
				"error" in entry && entry.error
					? { _type: "readError", filePath: entry.path, message: entry.error }
					: itemFromResult(entry.path, offset, entry.result as ToolResultLike),
			);

			const lineBudget = params.limit ?? DEFAULT_READ_LIMIT;
			const { index, text } = capSections(
				items.map(sectionFromItem),
				BATCH_MAX_BYTES,
				lineBudget,
				omitted,
			);
			const images = items.filter((item): item is ReadImageDetails => item._type === "readImage");
			const details: ReadBatchDetails = { _type: "readBatch", items, index };
			return {
				content: [
					{ type: "text", text },
					...images.map((img) => ({
						type: "image" as const,
						data: img.data,
						mimeType: img.mimeType,
					})),
				],
				details,
			};
		},

		renderCall(args: ReadParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const targets = resolveBatchStrings(args.path, args.paths);
			const fp = formatCallTargets(targets.map(sp)) || (args.path ?? "");
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (
				hideCollapsedToolCall(renderCtx.state as CollapseState, renderCtx.expanded, (value) =>
					text.setText(value),
				)
			)
				return text;
			const offset = args.offset ? ` ${theme.fg("muted", `from line ${args.offset}`)}` : "";
			const limit = args.limit ? ` ${theme.fg("muted", `(${args.limit} lines)`)}` : "";
			text.setText(
				fillToolBackground(
					`${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", fp)}${offset}${limit}`,
				),
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
				renderCtx.isError &&
				(d?._type === "readFile" ||
					d?._type === "readImage" ||
					d?._type === "readBatch" ||
					d?._type === "readError");

			if (renderCtx.isError && (!structuredError || isPartial)) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const cs = renderCtx.state as CollapseState;
			if (!isPartial && tickCollapse("read", cs, renderCtx.invalidate, renderCtx.expanded)) {
				if (renderCtx.isError) {
					text.setText(
						renderCollapsedToolRow(theme, "read", sp(String(d?.filePath ?? "")), "failed", "error"),
					);
				} else if (d?._type === "readBatch") {
					const batch = d as unknown as ReadBatchDetails;
					text.setText(
						renderCollapsedToolRow(
							theme,
							"read",
							formatCallTargets(batch.items.map((item) => sp(item.filePath))),
							`${batch.items.length} files`,
						),
					);
				} else if (d?._type === "readFile") {
					text.setText(
						renderCollapsedToolRow(
							theme,
							"read",
							sp(String(d.filePath ?? "")),
							`${d.lineCount} lines`,
						),
					);
				} else if (d?._type === "readImage") {
					const byteSize = Math.ceil(((d.data as string).length * 3) / 4);
					text.setText(
						renderCollapsedToolRow(
							theme,
							"read",
							sp(String(d.filePath ?? "")),
							`${d.mimeType ?? "image"} · ${humanSize(byteSize)}`,
						),
					);
				} else {
					text.setText(renderCollapsedToolRow(theme, "read", "", "done"));
				}
				return text;
			}

			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			if (d?._type === "readBatch") {
				const batch = d as unknown as ReadBatchDetails;
				const full = batch.items
					.map((item) => {
						if (item._type === "readError") return `===== ${item.filePath} =====\n${item.message}`;
						if (item._type === "readImage") return `===== ${item.filePath} =====\n${item.mimeType}`;
						return `===== ${item.filePath} =====\n${item.content}`;
					})
					.join("\n\n");
				text.setText(renderDimPreview(full || batch.index, theme, { header: batch.index }));
				return text;
			}

			if (d?._type === "readImage") {
				const byteSize = Math.ceil(((d.data as string).length * 3) / 4);
				text.setText(
					fillToolBackground(
						`  ${fileIcon(d.filePath as string)}${FG_DIM}${d.mimeType ?? "image"} · ${humanSize(byteSize)}${RST}`,
					),
				);
				return text;
			}

			if (d?._type === "readFile" && d.content) {
				const key = `read:${d.filePath}:${d.offset}:${d.lineCount}:${process.stdout.columns ?? 80}:${renderCtx.expanded ? "full" : "preview"}`;
				if (renderCtx.state._rk !== key) {
					renderCtx.state._rk = key;
					const info = `${FG_DIM}${d.lineCount} lines${RST}`;
					renderCtx.state._rt = fillToolBackground(`  ${info}`);

					const maxShow = renderCtx.expanded ? (d.lineCount as number) : MAX_PREVIEW_LINES;
					renderFileContent(d.content as string, d.filePath as string, d.offset as number, maxShow)
						.then((rendered: string) => {
							if (renderCtx.state._rk !== key) return;
							renderCtx.state._rt = fillToolBackground(`  ${info}\n${rendered}`);
							renderCtx.invalidate();
						})
						.catch(() => {});
				}
				text.setText(
					renderCtx.state._rt ?? fillToolBackground(`  ${FG_DIM}${d.lineCount} lines${RST}`),
				);
				return text;
			}

			const fallback = result.content?.[0];
			const fallbackText = fallback && isTextContent(fallback) ? fallback.text : "read";
			text.setText(fillToolBackground(`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`));
			return text;
		},
	});
}
