import { existsSync, readFileSync } from "node:fs";
import type {
	AgentToolUpdateCallback,
	ExtensionContext,
	ToolRenderResultOptions,
	WriteToolInput,
} from "@earendil-works/pi-coding-agent";

import { type CollapseState, tickCollapse } from "@xynogen/pix-data/collapse";
import { MAX_RENDER_LINES } from "@xynogen/pix-pretty/config";
import type { ToolContext } from "@xynogen/pix-pretty/context";
import { parseDiff } from "@xynogen/pix-pretty/diff";
import {
	diffThemeCacheKey,
	renderSplit,
	resolveDiffColors,
	summarize,
} from "@xynogen/pix-pretty/diff-render";
import { hlBlock } from "@xynogen/pix-pretty/highlight";
import { lang } from "@xynogen/pix-pretty/lang";
import type {
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
	WriteParams,
	WriteRenderState,
} from "@xynogen/pix-pretty/types";
import {
	fillToolBackground,
	getTextContent,
	isTextContent,
	renderToolError,
	setResultDetails,
	termW,
} from "@xynogen/pix-pretty/utils";

export function registerWriteTool(
	pi: PiPrettyApi,
	createWriteTool: ToolFactory<WriteToolInput>,
	ctx: ToolContext,
	trackInvalidator: (id: string, inv: () => void) => void,
): void {
	const { cwd, sp, TextComponent } = ctx;
	const origWrite = createWriteTool(cwd);

	pi.registerTool({
		...origWrite,
		name: "write",
		renderShell: "self",

		async execute(
			tid: string,
			params: WriteParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
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
				toolCtx,
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
			renderCtx: RenderContextLike<WriteRenderState>,
		) {
			const fp = args?.path ?? args?.file_path ?? "";
			const isNew = !fp || !existsSync(fp);
			const label = isNew ? "create" : "write";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			const hdr = `${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("accent", sp(fp))}`;

			if (args?.content && isNew) {
				const previewKey = `create:${diffThemeCacheKey(theme)}:${fp}:${String(args.content).length}`;
				if (renderCtx.state._previewKey !== previewKey) {
					renderCtx.state._previewKey = previewKey;
					renderCtx.state._previewText = hdr;
					const lg = lang(fp);
					hlBlock(String(args.content), lg)
						.then((lines) => {
							if (renderCtx.state._previewKey !== previewKey) return;
							const maxShow = renderCtx.expanded ? lines.length : 16;
							const preview = lines.slice(0, maxShow).join("\n");
							const rem = lines.length - maxShow;
							let out = `${hdr}\n\n${preview}`;
							if (rem > 0)
								out += `\n${theme.fg("muted", `… (${rem} more lines, ${lines.length} total)`)}`;
							renderCtx.state._previewText = out;
							renderCtx.invalidate();
						})
						.catch(() => {});
				}
				text.setText(renderCtx.state._previewText ?? hdr);
				return text;
			}

			text.setText(fillToolBackground(hdr));
			return text;
		},

		renderResult(
			result: ToolResultLike,
			_opt: ToolRenderResultOptions,
			theme: ThemeLike,
			renderCtx: RenderContextLike<WriteRenderState>,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}
			const d = result.details as Record<string, unknown> | undefined;

			// Auto-collapse: show summary line after delay
			const cs = renderCtx.state as CollapseState;
			if (tickCollapse("write", cs, renderCtx.invalidate)) {
				const summary =
					d?._type === "diff"
						? (d.summary as string)
						: d?._type === "noChange"
							? "✓ no changes"
							: d?._type === "new"
								? `✓ new file (${d.lines} lines)`
								: "written";
				text.setText(fillToolBackground(`  ${theme.fg("muted", summary)}`));
				return text;
			}

			if (d?._type === "diff") {
				const key = `wd:${diffThemeCacheKey(theme)}:${termW()}:${d.summary}:${(d.newContent as string).length}:${d.language ?? ""}`;
				if (renderCtx.toolCallId) trackInvalidator(renderCtx.toolCallId, renderCtx.invalidate);
				if (renderCtx.state._wdk !== key) {
					renderCtx.state._wdk = key;
					renderCtx.state._wdt = `  ${d.summary}\n${theme.fg("muted", "  rendering diff…")}`;
					const dc = resolveDiffColors(theme);
					const diff = parseDiff(d.oldContent as string, d.newContent as string);
					renderSplit(diff, d.language as string | undefined, MAX_RENDER_LINES, dc)
						.then((rendered) => {
							if (renderCtx.state._wdk !== key) return;
							renderCtx.state._wdt = `  ${d.summary}\n${rendered}`;
							renderCtx.invalidate();
						})
						.catch(() => {
							if (renderCtx.state._wdk !== key) return;
							renderCtx.state._wdt = `  ${d.summary}`;
							renderCtx.invalidate();
						});
				}
				text.setText(renderCtx.state._wdt ?? `  ${d.summary}`);
				return text;
			}

			if (d?._type === "noChange") {
				text.setText(fillToolBackground(`  ${theme.fg("muted", "✓ no changes")}`));
				return text;
			}

			if (d?._type === "new") {
				const {
					lines: lineCount,
					content: rawContent,
					filePath: fp,
				} = d as { lines: number; content: string; filePath: string };
				const base = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`;
				const pk = `nf:${diffThemeCacheKey(theme)}:${fp}:${lineCount}`;
				if (renderCtx.state._nfk !== pk) {
					renderCtx.state._nfk = pk;
					renderCtx.state._nft = base;
					if (rawContent) {
						hlBlock(rawContent, lang(fp))
							.then((hlLines) => {
								if (renderCtx.state._nfk !== pk) return;
								const maxShow = renderCtx.expanded ? hlLines.length : 12;
								const preview = hlLines.slice(0, maxShow).join("\n");
								const rem = hlLines.length - maxShow;
								let out = `${base}\n${preview}`;
								if (rem > 0) out += `\n${theme.fg("muted", `  … ${rem} more lines`)}`;
								renderCtx.state._nft = out;
								renderCtx.invalidate();
							})
							.catch(() => {});
					}
				}
				text.setText(renderCtx.state._nft ?? base);
				return text;
			}

			const fallback = result.content?.[0];
			const fallbackText = fallback && isTextContent(fallback) ? fallback.text : "written";
			text.setText(fillToolBackground(`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`));
			return text;
		},
	});
}
