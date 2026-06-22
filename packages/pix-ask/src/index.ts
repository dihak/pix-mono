import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { buildResponseText } from "./helpers.js";
import { once } from "./once.ts";
import { AskQuestionnaire } from "./questionnaire.js";
import { rpcFallback } from "./rpc.js";
import type { Params } from "./schema.js";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	ParamsSchema,
	SENTINEL_FREEFORM,
} from "./schema.js";
import type { QuestionAnswer, QuestionnaireResult } from "./types.js";

// ── Re-exports (consumed by tests and single-select-layout) ───────────

export {
	buildResponseText,
	formatAnswerScalar,
	hasAnyPreview,
	sentinelsFor,
} from "./helpers.js";
export type { OptionData, QuestionData } from "./schema.js";
export type {
	AnswerKind,
	QuestionAnswer,
	QuestionnaireResult,
} from "./types.js";

// ── Tool registration ──────────────────────────────────────────────────

export default function registerAsk(pi: ExtensionAPI): void {
	once(pi, "pix-ask", () => {
		pi.registerTool({
			name: "ask_user",
			label: "Ask",
			description: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous.`,
			promptSnippet: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`,
			promptGuidelines: [
				`Use ask whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
				`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ("${SENTINEL_FREEFORM}" row is appended automatically to single-select questions).`,
				`Set multiSelect: true when multiple answers are valid; this suppresses the "${SENTINEL_FREEFORM}" row. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. NOTE: any non-empty preview on a single-select question ALSO suppresses the "${SENTINEL_FREEFORM}" row (no room in the side-by-side layout). If you recommend a specific option, make it the first option and append "(Recommended)" to its label.`,
				"Do not stack multiple ask calls back-to-back — group all clarifying questions into one invocation.",
			],
			executionMode: "sequential",
			parameters: ParamsSchema,

			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Cancelled" }],
						details: { answers: [], cancelled: true },
					};
				}

				const typed = params as unknown as Params;

				if (!Array.isArray(typed.questions) || typed.questions.length === 0) {
					return {
						content: [
							{ type: "text", text: "At least one question is required." },
						],
						isError: true,
						details: { answers: [], cancelled: true },
					};
				}

				if (!ctx.hasUI) {
					const result = await rpcFallback(ctx.ui, typed);
					const text = result.cancelled
						? "User cancelled the questionnaire"
						: buildResponseText(result.answers, typed.questions);
					return { content: [{ type: "text", text }], details: result };
				}

				const result = await ctx.ui.custom<QuestionnaireResult | null>(
					(tui, theme, keybindings, done) => {
						if (signal) {
							signal.addEventListener(
								"abort",
								() => done({ answers: [], cancelled: true }),
								{ once: true },
							);
						}
						return new AskQuestionnaire(typed, tui, theme, keybindings, done);
					},
					{ overlay: true },
				);

				if (!result || result.cancelled) {
					return {
						content: [
							{ type: "text", text: "User cancelled the questionnaire" },
						],
						details: result ?? { answers: [], cancelled: true },
					};
				}

				const text = buildResponseText(result.answers, typed.questions);
				return { content: [{ type: "text", text }], details: result };
			},

			renderCall(args, theme) {
				const questions = Array.isArray(args.questions) ? args.questions : [];
				const count = questions.length;
				const firstQ = (questions[0]?.question ?? "") as string;
				let text = theme.fg("toolTitle", theme.bold(`ask (${count}) `));
				text += theme.fg("muted", firstQ);
				if (count > 1) text += theme.fg("dim", ` +${count - 1} more`);
				return new Text(text, 0, 0);
			},

			renderResult(result, options, theme) {
				const details = result.details as
					| { answers?: QuestionAnswer[]; cancelled?: boolean }
					| undefined;
				if (options.isPartial) {
					return new Text(theme.fg("muted", "Waiting for user input..."), 0, 0);
				}
				if (!details || details.cancelled || !details.answers?.length) {
					return new Text(theme.fg("warning", "Cancelled"), 0, 0);
				}
				const texts = details.answers.map((a) => {
					const v =
						a.kind === "multi"
							? (a.selected ?? []).join(", ")
							: (a.answer ?? "");
					return `${a.questionIndex + 1}: ${v}`;
				});
				return new Text(theme.fg("success", `✓ ${texts.join(" • ")}`), 0, 0);
			},
		});
	});
}
