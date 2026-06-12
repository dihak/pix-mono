import type {
	AgentToolUpdateCallback,
	ExtensionContext,
	LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { FG_DIM, RST } from "../ansi.js";
import { renderTree } from "../renderers.js";
import type {
	LsParams,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "../types.js";
import {
	fillToolBackground,
	getTextContent,
	renderToolError,
	setResultDetails,
} from "../utils.js";
import type { ToolContext } from "./context.js";

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
		renderShell: "self",

		async execute(
			tid: string,
			params: LsParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const result = (await origLs.execute(
				tid,
				params,
				sig,
				upd,
				toolCtx,
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

		renderCall(args: LsParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const fp = args.path ?? ".";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
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
			renderCtx: RenderContextLike,
		) {
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);

			if (renderCtx.isError) {
				text.setText(renderToolError(getTextContent(result) || "Error", theme));
				return text;
			}

			const d = result.details as Record<string, unknown> | undefined;
			if (d?._type === "lsResult" && d.text) {
				const tree = renderTree(d.text as string, d.path as string);
				const info = `${FG_DIM}${d.entryCount} entries${RST}`;
				text.setText(fillToolBackground(`  ${info}\n${tree}`));
				return text;
			}

			const output = getTextContent(result) || "listed";
			text.setText(
				fillToolBackground(`  ${theme.fg("dim", output.slice(0, 120))}`),
			);
			return text;
		},
	});
}
