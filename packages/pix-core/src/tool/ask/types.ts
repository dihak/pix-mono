// ── Answer & result types ──────────────────────────────────────────────

export type AnswerKind = "option" | "custom" | "chat" | "multi";

export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: AnswerKind;
	answer: string | null;
	selected?: string[];
	preview?: string;
}

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
}
