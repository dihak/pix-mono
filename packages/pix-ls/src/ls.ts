import type {
	AgentToolUpdateCallback,
	ExtensionContext,
	LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { type CollapseState, tickCollapse } from "@xynogen/pix-data/collapse";
import { FG_DIM, RST } from "@xynogen/pix-pretty/ansi";
import type { ToolContext } from "@xynogen/pix-pretty/context";
import { renderTree } from "@xynogen/pix-pretty/renderers";
import type {
	LsParams,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "@xynogen/pix-pretty/types";
import {
	fillToolBackground,
	getTextContent,
	hideCollapsedToolCall,
	renderCollapsedToolRow,
	renderToolError,
	setResultDetails,
} from "@xynogen/pix-pretty/utils";

export const DEFAULT_LS_LIMIT = 200;

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
			"List a directory, including dotfiles. Defaults to 200 sorted entries; use limit to request more. Output remains capped by Pi's 50KB hard limit.",
		renderShell: "self",

		async execute(
			tid: string,
			params: LsParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const effectiveParams = applyLsDefaults(params);
			const result = (await origLs.execute(
				tid,
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
		},

		renderCall(args: LsParams, theme: ThemeLike, renderCtx: RenderContextLike) {
			const fp = args.path ?? ".";
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			if (
				hideCollapsedToolCall(renderCtx.state as CollapseState, renderCtx.expanded, (value) =>
					text.setText(value),
				)
			)
				return text;
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

			// Auto-collapse: show summary line after delay
			const cs = renderCtx.state as CollapseState;
			if (tickCollapse("ls", cs, renderCtx.invalidate)) {
				const d2 = result.details as Record<string, unknown> | undefined;
				const summary = d2?._type === "lsResult" ? `${d2.entryCount} entries` : "listed";
				const target = d2?._type === "lsResult" ? sp(String(d2.path ?? ".")) : ".";
				text.setText(renderCollapsedToolRow(theme, "ls", target, summary));
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
			text.setText(fillToolBackground(`  ${theme.fg("dim", output.slice(0, 120))}`));
			return text;
		},
	});
}
