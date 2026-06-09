/**
 * Ask Tool — structured questionnaire for pi-coding-agent
 *
 * Single file. Single tool. `ask_user_question` API style:
 * multiple questions, options w/ label/description/preview, multiSelect.
 *
 * Replaces both the old `ask` and the external `ask_user_question` package.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	decodeKittyPrintable,
	Editor,
	fuzzyFilter,
	Key,
	type KeybindingsManager,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

// ── Constants ──────────────────────────────────────────────────────────

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 16;
const MAX_LABEL_LENGTH = 60;

const SENTINEL_FREEFORM = "Type something.";
const SENTINEL_CHAT = "Chat about this";
const SENTINEL_NEXT = "Next";

const SPLIT_PANE_MIN_WIDTH = 84;
const SEPARATOR = " │ ";

// ── Schema ─────────────────────────────────────────────────────────────

const OptionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS. Display text for this option. Concise (1-5 words).`,
	}),
	description: Type.String({
		description: "Explanation of what this option means or trade-offs.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional markdown preview for side-by-side layout (single-select only).",
		}),
	),
});

const QuestionSchema = Type.Object({
	question: Type.String({
		description: "Clear, specific question ending with ?",
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `MAX ${MAX_HEADER_LENGTH} CHARS — short chip/tag. E.g. "Auth method", "Approach".`,
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"2-4 options. 'Type something.' and 'Chat about this' are auto-appended.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Allow multiple selections. Suppresses 'Type something.' row.",
		}),
	),
});

const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "1-4 questions",
});

const ParamsSchema = Type.Object({ questions: QuestionsSchema });

export type OptionData = Static<typeof OptionSchema>;
export type QuestionData = Static<typeof QuestionSchema>;
type Params = Static<typeof ParamsSchema>;

// ── Answer types ───────────────────────────────────────────────────────

type AnswerKind = "option" | "custom" | "chat" | "multi";

interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: AnswerKind;
	answer: string | null;
	selected?: string[];
	preview?: string;
}

interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

function safeMarkdownTheme(): MarkdownTheme | undefined {
	try {
		const md = getMarkdownTheme();
		if (!md) return undefined;
		md.bold("");
		return md;
	} catch {
		return undefined;
	}
}

export function hasAnyPreview(q: QuestionData): boolean {
	return q.options.some(
		(o) => typeof o.preview === "string" && o.preview.length > 0,
	);
}

/** Which sentinel rows are auto-appended for a question. */
export function sentinelsFor(
	q: QuestionData,
): Array<{ kind: string; label: string }> {
	const out: Array<{ kind: string; label: string }> = [];
	if (q.multiSelect) {
		out.push({ kind: "next", label: SENTINEL_NEXT });
	} else if (!hasAnyPreview(q)) {
		out.push({ kind: "other", label: SENTINEL_FREEFORM });
	}
	// Chat sentinel is always last (in its own row list, not in main list)
	return out;
}

export function formatAnswerScalar(a: QuestionAnswer): string {
	if (a.kind === "multi") return (a.selected ?? []).join(", ");
	if (a.kind === "custom") return a.answer ?? "(custom)";
	if (a.kind === "chat") return "(chat)";
	return a.answer ?? "(selected)";
}

export function buildResponseText(
	answers: QuestionAnswer[],
	questions: QuestionData[],
): string {
	const segs: string[] = [];
	for (const a of answers) {
		const q = questions[a.questionIndex]?.question ?? `Q${a.questionIndex + 1}`;
		let s = `"${q}"="${formatAnswerScalar(a)}"`;
		if (a.preview) s += `. selected preview: ${a.preview}`;
		segs.push(s);
	}
	return segs.length
		? `User answered: ${segs.join(". ")}.`
		: "User declined to answer questions.";
}

// ── Scrollbar helper ───────────────────────────────────────────────────

function scrollIndicator(index: number, total: number): string {
	if (total <= 1) return "";
	const pos = Math.round((index / (total - 1)) * 6);
	const bar = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦"][pos] ?? "·";
	return ` ${bar} ${index + 1}/${total}`;
}

// ── TUI Components ─────────────────────────────────────────────────────

function _borderColor(theme: Theme): (s: string) => string {
	return (s: string) => theme.fg("accent", s);
}

function dim(theme: Theme): (s: string) => string {
	return (s: string) => theme.fg("dim", s);
}

class TabBar implements Component {
	private questions: QuestionData[];
	private activeIndex: number;
	private theme: Theme;

	constructor(questions: QuestionData[], activeIndex: number, theme: Theme) {
		this.questions = questions;
		this.activeIndex = activeIndex;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(10, width - 2);
		// Build tab labels: "1.Approach  2.Auth  3.Database"
		const parts: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const active = i === this.activeIndex;
			const num = `${i + 1}`;
			const tag = `${num}.${this.questions[i]?.header}`;
			if (active) {
				parts.push(t.fg("accent", t.bold(tag)));
			} else {
				parts.push(t.fg("dim", tag));
			}
		}
		const line = parts.join(t.fg("dim", "  "));
		return [
			truncateToWidth(
				t.fg("accent", "╭─") +
					line +
					t.fg(
						"accent",
						`${"─".repeat(Math.max(0, inner - line.length - 1))}╮`,
					),
				width,
				"",
			),
		].filter(Boolean);
	}
}

class AskQuestionnaire extends Container {
	private params: Params;
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private onDone: (result: QuestionnaireResult | null) => void;

	private currentIndex = 0;
	private answers: QuestionAnswer[] = [];
	private searchQuery = "";
	private selectedOptionIndex = 0;
	private multiChecked = new Set<number>();
	private inputMode = false; // typing freeform text
	private freeformText = "";
	private editor?: Editor;
	private mdTheme = safeMarkdownTheme();
	// Resolve panel width once
	private _splitWidth: number | null = null;

	constructor(
		params: Params,
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		onDone: (result: QuestionnaireResult | null) => void,
	) {
		super();
		this.params = params;
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.onDone = onDone;
		this.renderLayout();
	}

	private get currentQ(): QuestionData {
		return this.params.questions[this.currentIndex]!;
	}

	private get filteredOptions(): OptionData[] {
		if (!this.searchQuery) return this.currentQ.options;
		return fuzzyFilter(
			this.currentQ.options,
			this.searchQuery,
			(o) => `${o.label} ${o.description}`,
		);
	}

	private get mainListItems(): Array<{
		kind: string;
		label?: string;
		option?: OptionData;
	}> {
		const items: Array<{ kind: string; label?: string; option?: OptionData }> =
			[];
		for (const o of this.filteredOptions) {
			items.push({ kind: "option", option: o });
		}
		for (const s of sentinelsFor(this.currentQ)) {
			items.push({ kind: s.kind, label: s.label });
		}
		return items;
	}

	private get totalItems(): number {
		return this.mainListItems.length;
	}

	private get selectedItem(): (typeof this.mainListItems)[0] | undefined {
		return this.mainListItems[this.selectedOptionIndex];
	}

	invalidate(): void {
		super.invalidate();
		this._splitWidth = null;
	}

	renderLayout(): void {
		this.clear();
		const t = this.theme;
		// Border top
		this.addChild(new Text("", 0, 0)); // placeholder, re-rendered

		// Tab bar
		if (this.params.questions.length > 1) {
			this.addChild(new TabBar(this.params.questions, this.currentIndex, t));
		}

		// Question header chip
		const q = this.currentQ;
		const chip = t.fg("accent", t.bold(q.header));
		const prog =
			this.params.questions.length > 1
				? dim(t)(
						scrollIndicator(this.currentIndex, this.params.questions.length),
					)
				: "";
		this.addChild(new Text(`${chip}${prog}`, 1, 0));
		this.addChild(new Spacer(1));

		// Question text
		this.addChild(new Text(t.fg("text", t.bold(q.question)), 1, 0));
		this.addChild(new Spacer(1));

		// Search bar for single-select
		if (!q.multiSelect && !this.inputMode) {
			const searchVal = this.searchQuery
				? t.fg("text", this.searchQuery)
				: t.fg("dim", "type to filter");
			this.addChild(
				new Text(`${t.fg("accent", "Filter:")} ${searchVal}`, 1, 0),
			);
		}

		// Options area (filled on render)
		this.addChild(new Spacer(1));

		// Input mode editor
		if (this.inputMode) {
			this.addChild(this.ensureEditor());
		}

		// Footer hints
		this.addChild(new Spacer(1));
		this.addChild(this.buildHintText());

		// Border bottom
		this.addChild(new Text("", 0, 0));
	}

	private ensureEditor(): Editor {
		if (this.editor) return this.editor;
		const editor = new Editor(this.tui, {
			borderColor: (s: string) => this.theme.fg("accent", s),
			selectList: {
				selectedPrefix: (s: string) => this.theme.fg("accent", s),
				selectedText: (s: string) => this.theme.fg("accent", s),
				description: (s: string) => this.theme.fg("muted", s),
				scrollInfo: (s: string) => this.theme.fg("dim", s),
				noMatch: (s: string) => this.theme.fg("warning", s),
			},
		});
		editor.disableSubmit = false;
		editor.onSubmit = (text: string) => this.handleFreeformSubmit(text);
		(editor as any).focused = true;
		this.editor = editor;
		return editor;
	}

	private buildHintText(): Text {
		const t = this.theme;
		const isMulti = !!this.currentQ.multiSelect;
		const hints: string[] = [];
		if (this.inputMode) {
			hints.push(dim(t)("enter=submit • esc=back • ^c=cancel"));
		} else if (isMulti) {
			hints.push(
				dim(t)(
					"↑↓=nav • space=toggle • enter=commit & next • esc=clear • ^c=cancel",
				),
			);
		} else {
			hints.push(
				dim(t)("↑↓=nav • type=filter • enter=select • esc=clear • ^c=cancel"),
			);
		}
		return new Text(hints.join("\n"), 1, 0);
	}

	private recordAnswer(
		kind: AnswerKind,
		answer: string | null,
		selected?: string[],
		preview?: string,
	): void {
		// Remove any previous answer for this question
		this.answers = this.answers.filter(
			(a) => a.questionIndex !== this.currentIndex,
		);
		this.answers.push({
			questionIndex: this.currentIndex,
			question: this.currentQ.question,
			kind,
			answer,
			selected,
			preview,
		});
	}

	private commitAnswer(): void {
		const item = this.selectedItem;
		if (!item) {
			this.cancel();
			return;
		}

		if (item.kind === "option" && item.option) {
			this.recordAnswer(
				"option",
				item.option.label,
				undefined,
				item.option.preview,
			);
			this.nextQuestion();
		} else if (item.kind === "other") {
			this.inputMode = true;
			this.freeformText = "";
			(this.ensureEditor() as any).focused = true;
			this.invalidate();
			this.renderLayout();
			this.tui.requestRender();
		} else if (item.kind === "next") {
			// multi-select commit
			const selected = Array.from(this.multiChecked)
				.sort((a, b) => a - b)
				.map((i) => this.currentQ.options[i]?.label);
			if (selected.length === 0) {
				this.cancel();
				return;
			}
			this.recordAnswer("multi", null, selected);
			this.nextQuestion();
		}
	}

	private handleFreeformSubmit(text: string): void {
		if (!text.trim()) {
			this.cancel();
			return;
		}
		this.recordAnswer("custom", text.trim());
		this.nextQuestion();
	}

	private nextQuestion(): void {
		this.searchQuery = "";
		this.multiChecked.clear();
		this.inputMode = false;
		this.selectedOptionIndex = 0;
		this.freeformText = "";
		this.editor = undefined;

		if (this.currentIndex + 1 < this.params.questions.length) {
			this.currentIndex++;
			this.invalidate();
			this.renderLayout();
			this.tui.requestRender();
		} else {
			this.onDone({ answers: this.answers, cancelled: false });
		}
	}

	private cancel(): void {
		this.onDone({ answers: this.answers, cancelled: true });
	}

	private toggleMulti(index: number): void {
		if (index < 0 || index >= this.currentQ.options.length) return;
		if (this.multiChecked.has(index)) this.multiChecked.delete(index);
		else this.multiChecked.add(index);
		this.invalidate();
	}

	handleInput(data: string): void {
		// Global: cancel
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.cancel();
			return;
		}

		// Input mode: handle editor keys
		if (this.inputMode) {
			if (matchesKey(data, Key.escape)) {
				this.inputMode = false;
				this.editor = undefined;
				this.invalidate();
				this.renderLayout();
				this.tui.requestRender();
				return;
			}
			// Forward all other keys to the Editor (typing, enter=submit, etc.)
			this.ensureEditor().handleInput(data);
			this.tui.requestRender();
			return;
		}

		const isMulti = !!this.currentQ.multiSelect;
		const total = this.totalItems;

		// Navigation
		if (
			this.keybindings.matches(data, "tui.select.up") ||
			matchesKey(data, Key.shift("tab")) ||
			matchesKey(data, Key.ctrl("k"))
		) {
			if (total > 0) {
				this.selectedOptionIndex =
					(this.selectedOptionIndex - 1 + total) % total;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		if (
			this.keybindings.matches(data, "tui.select.down") ||
			matchesKey(data, Key.tab) ||
			matchesKey(data, Key.ctrl("j"))
		) {
			if (total > 0) {
				this.selectedOptionIndex = (this.selectedOptionIndex + 1) % total;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		// Backspace: pop search
		if (
			this.keybindings.matches(data, "tui.editor.deleteCharBackward") ||
			matchesKey(data, Key.backspace)
		) {
			if (this.searchQuery) {
				const chars = [...this.searchQuery];
				chars.pop();
				this.searchQuery = chars.join("");
				this.selectedOptionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		// Escape: clear search
		if (matchesKey(data, Key.escape)) {
			if (this.searchQuery) {
				this.searchQuery = "";
				this.selectedOptionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		// Space: toggle multi-select
		if (matchesKey(data, Key.space) && isMulti) {
			if (this.selectedItem?.kind === "option" && this.selectedItem.option) {
				const idx = this.filteredOptions.indexOf(this.selectedItem.option);
				if (idx >= 0) this.toggleMulti(idx);
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}

		// Number shortcut
		const numMatch = data.match(/^[1-9]$/);
		if (numMatch && this.filteredOptions.length > 0) {
			const idx = Number(numMatch[0]) - 1;
			if (idx >= 0 && idx < this.filteredOptions.length) {
				if (isMulti) {
					this.toggleMulti(idx);
					this.selectedOptionIndex = Math.min(idx, this.totalItems - 1);
					this.invalidate();
					this.tui.requestRender();
				} else {
					// Direct select
					const opt = this.filteredOptions[idx]!;
					this.recordAnswer("option", opt.label, undefined, opt.preview);
					this.nextQuestion();
				}
				return;
			}
		}

		// Submit / select
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.commitAnswer();
			return;
		}

		// Search input: type to filter
		if (!isMulti) {
			const printable = decodeKittyPrintable(data);
			if (printable !== undefined) {
				this.searchQuery += printable;
				this.selectedOptionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
				return;
			}
			const chars = [...data];
			if (
				chars.length === 1 &&
				chars[0] &&
				chars[0].charCodeAt(0) >= 32 &&
				chars[0].charCodeAt(0) < 127
			) {
				this.searchQuery += chars[0];
				this.selectedOptionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
			}
		}
	}

	private renderOptions(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(20, width - 6);
		const isMulti = !!this.currentQ.multiSelect;
		const items = this.mainListItems;
		const total = items.length;
		const chk = (i: number) =>
			isMulti
				? this.multiChecked.has(i)
					? t.fg("success", "✓")
					: t.fg("dim", "○")
				: "";

		if (total === 0) return [t.fg("warning", "No options")];

		const maxVisible = Math.min(total, 12);
		const start = Math.max(
			0,
			Math.min(
				this.selectedOptionIndex - Math.floor(maxVisible / 2),
				total - maxVisible,
			),
		);
		const end = Math.min(start + maxVisible, total);

		const lines: string[] = [];
		const pad = "   ";

		for (let i = start; i < end; i++) {
			const item = items[i]!;
			const sel = i === this.selectedOptionIndex;
			const ptr = sel ? t.fg("accent", "→") : " ";

			if (item.kind === "option" && item.option) {
				const optIdx = this.filteredOptions.indexOf(item.option);
				const checkbox = isMulti ? ` ${chk(optIdx)}` : "";
				const num = t.fg("dim", `${optIdx + 1}.`);
				const label = sel
					? t.fg("accent", t.bold(item.option.label))
					: t.fg("text", t.bold(item.option.label));
				lines.push(
					truncateToWidth(`${ptr} ${num}${checkbox} ${label}`, inner, ""),
				);
				if (item.option.description) {
					const wrapped = wrapTextWithAnsi(
						item.option.description,
						Math.max(10, inner - 6),
					);
					for (const w of wrapped) {
						lines.push(truncateToWidth(`${pad}${t.fg("muted", w)}`, inner, ""));
					}
				}
			} else if (item.kind === "other") {
				const label = sel
					? t.fg("accent", t.bold(SENTINEL_FREEFORM))
					: t.fg("text", t.bold(SENTINEL_FREEFORM));
				lines.push(
					truncateToWidth(`${ptr} ${t.fg("dim", "✎")} ${label}`, inner, ""),
				);
			} else if (item.kind === "next") {
				const label = sel
					? t.fg("accent", t.bold(SENTINEL_NEXT))
					: t.fg("text", t.bold(SENTINEL_NEXT));
				lines.push(
					truncateToWidth(`${ptr} ${t.fg("dim", "→")} ${label}`, inner, ""),
				);
			}
		}

		if (start > 0 || end < total) {
			const count =
				this.filteredOptions.length > 0
					? `${this.selectedOptionIndex + 1}/${total}`
					: `${total}`;
			lines.push(t.fg("dim", truncateToWidth(`  ${count}`, inner, "")));
		}

		return lines;
	}

	private renderPreview(width: number): string[] {
		const item = this.selectedItem;
		if (item?.kind !== "option" || !item.option?.preview) {
			return [this.theme.fg("dim", "No preview")];
		}

		const mdText = item.option.preview;
		const mdWidth = Math.max(10, width);

		if (this.mdTheme) {
			const md = new Markdown(
				`## ${item.option.label}\n\n${mdText}`,
				0,
				0,
				this.mdTheme,
			);
			return md.render(mdWidth);
		}

		const lines = wrapTextWithAnsi(mdText, mdWidth);
		return lines.map((l) =>
			truncateToWidth(this.theme.fg("muted", l), mdWidth, ""),
		);
	}

	override render(width: number): string[] {
		const inner = Math.max(20, width - 4);
		const t = this.theme;
		const isMulti = !!this.currentQ.multiSelect;
		const hasPreview =
			!isMulti &&
			this.selectedItem?.kind === "option" &&
			!!this.selectedItem?.option?.preview;

		// Decide layout: split pane if preview and wide enough
		const useSplit = hasPreview && width >= SPLIT_PANE_MIN_WIDTH;
		const leftWidth = useSplit ? Math.floor((width - 6) * 0.45) : inner;
		const previewWidth = useSplit ? Math.max(20, width - leftWidth - 10) : 0;

		const lines: string[] = [];

		// Build a bordered body row: pad/truncate the (ANSI-containing) content to
		// exactly `inner` visible columns, then wrap in side borders. Using
		// visibleWidth() (not String.length) keeps ANSI codes + wide glyphs honest.
		const row = (content: string): string => {
			return ` ${truncateToWidth(content, Math.max(0, width - 1), "")}`;
		};

		// Tab bar
		if (this.params.questions.length > 1) {
			const tabParts: string[] = [];
			for (let i = 0; i < this.params.questions.length; i++) {
				const active = i === this.currentIndex;
				const tag = `${i + 1}.${this.params.questions[i]?.header}`;
				tabParts.push(active ? t.fg("accent", t.bold(tag)) : t.fg("dim", tag));
			}
			const tabLine = tabParts.join(t.fg("dim", "  "));
			lines.push(row(tabLine));
		}

		// Header chip
		const chip = t.fg("accent", t.bold(this.currentQ.header));
		const prog =
			this.params.questions.length > 1
				? dim(t)(` ${this.currentIndex + 1}/${this.params.questions.length}`)
				: "";
		lines.push(row(`${chip}${prog}`));

		// Question text
		const questionWrapped = wrapTextWithAnsi(
			this.currentQ.question,
			Math.max(10, inner),
		);
		for (const w of questionWrapped) {
			lines.push(row(t.fg("text", t.bold(w))));
		}

		// Input mode: render the freeform editor instead of the options list.
		if (this.inputMode) {
			lines.push("");
			lines.push(row(t.fg("accent", t.bold("Type your response:"))));
			lines.push("");
			const editorLines = this.ensureEditor().render(Math.max(0, width - 1));
			for (const el of editorLines)
				lines.push(` ${truncateToWidth(el, Math.max(0, width - 1), "")}`);
			lines.push("");
			lines.push(row(dim(t)("enter submit • esc back • ctrl+c cancel")));
			lines.push("");
			return lines.map((l) => truncateToWidth(l, width, ""));
		}

		// Search bar
		if (!isMulti) {
			const searchVal = this.searchQuery
				? t.fg("text", this.searchQuery)
				: t.fg("dim", "type to filter");
			lines.push(row(`${t.fg("accent", "Filter:")} ${searchVal}`));
		}

		// Chat sentinel row (above options for single-select, always visible)
		const chatLabel =
			this.selectedOptionIndex === -999
				? t.fg("accent", t.bold(SENTINEL_CHAT))
				: t.fg("dim", SENTINEL_CHAT);
		lines.push(row(`  ${t.fg("dim", "💬")} ${chatLabel}`));

		// Options (with optional preview pane)
		const optionLines = this.renderOptions(useSplit ? leftWidth : width - 4);
		const previewLines = useSplit ? this.renderPreview(previewWidth) : [];
		const maxOptLines = Math.max(optionLines.length, previewLines.length);

		if (useSplit) {
			const sep = t.fg("dim", SEPARATOR);
			for (let i = 0; i < maxOptLines; i++) {
				const left = truncateToWidth(
					optionLines[i] ?? "",
					leftWidth - 1,
					"",
					true,
				);
				const right = truncateToWidth(
					previewLines[i] ?? "",
					previewWidth - 2,
					"",
				);
				const paintedLeft = left || " ".repeat(leftWidth - 1);
				const paintedRight = right || " ".repeat(previewWidth - 2);
				const body = `${paintedLeft}${sep}${paintedRight}`;
				lines.push(` ${truncateToWidth(body, Math.max(0, width - 1), "")}`);
			}
		} else {
			for (const line of optionLines) {
				lines.push(row(line));
			}
		}

		// Footer hints
		const hintTexts: string[] = [];
		if (isMulti) {
			hintTexts.push("↑↓ nav • space toggle • enter commit • esc clear");
		} else {
			hintTexts.push("↑↓ nav • type filter • enter select • esc clear");
		}
		hintTexts.push("ctrl+c cancel");
		const hint = dim(t)(hintTexts.join(" • "));
		lines.push(row(hint));
		lines.push("");

		// Final safety net: never emit a line wider than the terminal.
		return lines.map((l) => truncateToWidth(l, width, ""));
	}
}

// ── RPC fallback ───────────────────────────────────────────────────────

async function rpcFallback(
	ui: { select: Function; input: Function },
	params: Params,
): Promise<QuestionnaireResult> {
	const answers: QuestionAnswer[] = [];
	let cancelled = false;

	for (let i = 0; i < params.questions.length; i++) {
		const q = params.questions[i]!;
		const header = q.header;

		if (q.multiSelect) {
			const lines = q.options.map(
				(o, idx) => `${idx + 1}. ${o.label} — ${o.description}`,
			);
			const raw = await ui.input(
				`${header}: ${q.question}\n\n${lines.join("\n")}\n\nEnter numbers separated by commas:`,
				"e.g. 1,3",
			);
			if (raw == null) {
				cancelled = true;
				break;
			}
			const indices = String(raw)
				.split(",")
				.map((s) => Number(s.trim()))
				.filter((n) => n >= 1 && n <= q.options.length);
			const selected = indices.map((n) => q.options[n - 1]?.label);
			if (selected.length > 0) {
				answers.push({
					questionIndex: i,
					question: q.question,
					kind: "multi",
					answer: null,
					selected,
				});
			} else {
				cancelled = true;
				break;
			}
		} else {
			const items = q.options.map((o) => `${o.label} — ${o.description}`);
			items.push(SENTINEL_FREEFORM);
			const chosen = await ui.select(`${header}: ${q.question}`, items);
			if (chosen == null) {
				cancelled = true;
				break;
			}
			if (chosen === SENTINEL_FREEFORM) {
				const text = await ui.input(q.question, "Type your answer...");
				if (text == null) {
					cancelled = true;
					break;
				}
				answers.push({
					questionIndex: i,
					question: q.question,
					kind: "custom",
					answer: String(text),
				});
			} else {
				const opt = q.options.find(
					(o) =>
						chosen === o.label || `${o.label} — ${o.description}` === chosen,
				)!;
				answers.push({
					questionIndex: i,
					question: q.question,
					kind: "option",
					answer: opt?.label ?? String(chosen),
				});
			}
		}
	}

	return { answers, cancelled };
}

// ── Tool registration ──────────────────────────────────────────────────

export default function registerAsk(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user",
		label: "Ask",
		description: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous.`,
		promptSnippet: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`,
		promptGuidelines: [
			`Use ask whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
			`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ("${SENTINEL_FREEFORM}" row is appended automatically to single-select questions) or pick "${SENTINEL_CHAT}" to abandon the questionnaire.`,
			`Set multiSelect: true when multiple answers are valid; this suppresses the "${SENTINEL_FREEFORM}" row. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. NOTE: any non-empty preview on a single-select question ALSO suppresses the "${SENTINEL_FREEFORM}" row (no room in the side-by-side layout); "${SENTINEL_CHAT}" remains the escape hatch. If you recommend a specific option, make it the first option and append "(Recommended)" to its label.`,
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

			// Validate
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

			// Render inline in the conversation thread (no floating overlay).
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
			);

			if (!result || result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
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
					a.kind === "multi" ? (a.selected ?? []).join(", ") : (a.answer ?? "");
				return `${a.questionIndex + 1}: ${v}`;
			});
			return new Text(theme.fg("success", `✓ ${texts.join(" • ")}`), 0, 0);
		},
	});
}
