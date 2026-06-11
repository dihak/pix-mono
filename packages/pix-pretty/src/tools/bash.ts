import type {
	AgentToolUpdateCallback,
	BashToolInput,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { FG_DIM, RST } from "../ansi.js";
import { MAX_PREVIEW_LINES } from "../config.js";
import { renderBashOutput } from "../renderers.js";
import type {
	BashParams,
	PiPrettyApi,
	RenderContextLike,
	ThemeLike,
	ToolFactory,
	ToolResultLike,
} from "../types.js";
import {
	fillToolBackground,
	getTextContent,
	isTextContent,
	normalizeLineEndings,
	renderToolError,
	rule,
	setResultDetails,
	termW,
} from "../utils.js";
import type { ToolContext } from "./context.js";

export function registerBashTool(
	pi: PiPrettyApi,
	createBashTool: ToolFactory<BashToolInput>,
	ctx: ToolContext,
): void {
	const { cwd, TextComponent } = ctx;
	const origBash = createBashTool(cwd);

	pi.registerTool({
		...origBash,
		name: "bash",

		async execute(
			tid: string,
			params: BashParams,
			sig: AbortSignal | undefined,
			upd: AgentToolUpdateCallback<unknown> | undefined,
			toolCtx: ExtensionContext,
		) {
			const result = (await origBash.execute(
				tid,
				params,
				sig,
				upd,
				toolCtx,
			)) as ToolResultLike;
			const textContent = getTextContent(result);

			let exitCode: number | null = 0;
			if (textContent) {
				const exitMatch = textContent.match(
					/(?:exit code|exited with|exit status)[:\s]*(\d+)/i,
				);
				if (exitMatch) exitCode = Number(exitMatch[1]);
				if (
					textContent.includes("command not found") ||
					textContent.includes("No such file")
				) {
					exitCode = 1;
				}
			}

			setResultDetails(result, {
				_type: "bashResult",
				text: textContent ?? "",
				exitCode,
				command: params.command ?? "",
			});

			return result;
		},

		renderCall(
			args: BashParams,
			theme: ThemeLike,
			renderCtx: RenderContextLike,
		) {
			const cmd = args.command ?? "";
			const displayCmdRaw = cmd.trim();
			const text = renderCtx.lastComponent ?? new TextComponent("", 0, 0);
			const timeout = args.timeout
				? ` ${theme.fg("muted", `(${args.timeout}s timeout)`)}`
				: "";
			const cmdLines = displayCmdRaw.split("\n");
			const firstLine = cmdLines[0] ?? "";
			const compactCmd =
				cmdLines.length > 1
					? `${firstLine} ${theme.fg("muted", `… (+${cmdLines.length - 1} lines)`)}`
					: firstLine;
			const baseCmd = renderCtx.expanded ? displayCmdRaw : compactCmd;
			const displayCmd =
				renderCtx.expanded || baseCmd.length <= 80
					? baseCmd
					: `${baseCmd.slice(0, 77)}…`;
			text.setText(
				fillToolBackground(
					`${theme.fg("toolTitle", theme.bold("bash"))} ${theme.fg("accent", displayCmd)}${timeout}`,
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
			if (d?._type === "bashResult") {
				const normalizedText = normalizeLineEndings(d.text as string)
					.replace(/\n{3,}/g, "\n\n")
					.replace(/^\n+|\n+$/g, "");
				const { summary } = renderBashOutput(
					normalizedText,
					d.exitCode as number | null,
				);
				const lines = normalizedText ? normalizedText.split("\n") : [];
				const lineCount = lines.length;
				const lineInfo =
					lineCount > 1 ? `  ${FG_DIM}(${lineCount} lines)${RST}` : "";
				const header = `  ${summary}${lineInfo}`;

				if (normalizedText) {
					const maxShow = renderCtx.expanded ? lineCount : MAX_PREVIEW_LINES;
					const show = lines.slice(0, maxShow);
					const tw = termW();
					const out: string[] = [header, rule(tw)];
					for (const line of show) out.push(`  ${line}`);
					out.push(rule(tw));
					if (lineCount > maxShow) {
						out.push(`${FG_DIM}  … ${lineCount - maxShow} more lines${RST}`);
					}
					text.setText(fillToolBackground(out.join("\n")));
				} else {
					text.setText(fillToolBackground(header));
				}
				return text;
			}

			const fallback = result.content?.[0];
			const fallbackText =
				fallback && isTextContent(fallback) ? fallback.text : "done";
			text.setText(
				fillToolBackground(
					`  ${theme.fg("dim", String(fallbackText).slice(0, 120))}`,
				),
			);
			return text;
		},
	});
}
