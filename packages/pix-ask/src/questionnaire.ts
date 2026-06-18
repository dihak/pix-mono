import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	decodeKittyPrintable,
	Editor,
	fuzzyFilter,
	Key,
	type KeybindingsManager,
	Markdown,
	matchesKey,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { dim } from "./components.js";
import { safeMarkdownTheme, sentinelsFor } from "./helpers.js";
import type { OptionData, Params, QuestionData } from "./schema.js";
import {
	SENTINEL_CHAT,
	SENTINEL_FREEFORM,
	SENTINEL_NEXT,
	SEPARATOR,
	SPLIT_PANE_MIN_WIDTH,
} from "./schema.js";
import type {
	AnswerKind,
	QuestionAnswer,
	QuestionnaireResult,
} from "./types.js";

// ── AskQuestionnaire ───────────────────────────────────────────────────

export class AskQuestionnaire extends Container {
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
	private inputMode = false;
	private editor?: Editor;
	private mdTheme = safeMarkdownTheme();

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
	}

	// ── Accessors ──────────────────────────────────────────────────────

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

	// ── Layout ─────────────────────────────────────────────────────────

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
		editor.focused = true;
		this.editor = editor;
		return editor;
	}

	private refresh(): void {
		this.invalidate();
		this.tui.requestRender();
	}

	// ── Answer management ──────────────────────────────────────────────

	private recordAnswer(
		kind: AnswerKind,
		answer: string | null,
		selected?: string[],
		preview?: string,
	): void {
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
			this.ensureEditor().focused = true;
			this.refresh();
		} else if (item.kind === "next") {
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

	private gotoQuestion(index: number): void {
		if (index < 0 || index >= this.params.questions.length) return;
		this.currentIndex = index;
		this.searchQuery = "";
		this.multiChecked.clear();
		this.inputMode = false;
		this.selectedOptionIndex = 0;
		this.editor = undefined;
		this.restoreAnswerState();
		this.refresh();
	}

	private restoreAnswerState(): void {
		const prev = this.answers.find(
			(a) => a.questionIndex === this.currentIndex,
		);
		if (!prev) return;
		const q = this.currentQ;
		if (prev.kind === "multi") {
			for (let i = 0; i < q.options.length; i++) {
				if (prev.selected?.includes(q.options[i]!.label)) {
					this.multiChecked.add(i);
				}
			}
		} else if (prev.kind === "option" && prev.answer) {
			const idx = this.mainListItems.findIndex(
				(it) => it.kind === "option" && it.option?.label === prev.answer,
			);
			if (idx >= 0) this.selectedOptionIndex = idx;
		} else if (prev.kind === "custom") {
			const idx = this.mainListItems.findIndex((it) => it.kind === "other");
			if (idx >= 0) this.selectedOptionIndex = idx;
		}
	}

	private nextQuestion(): void {
		const total = this.params.questions.length;
		const answered = new Set(this.answers.map((a) => a.questionIndex));
		for (let step = 1; step <= total; step++) {
			const idx = (this.currentIndex + step) % total;
			if (!answered.has(idx)) {
				this.gotoQuestion(idx);
				return;
			}
		}
		this.answers.sort((a, b) => a.questionIndex - b.questionIndex);
		this.onDone({ answers: this.answers, cancelled: false });
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

	// ── Input handling ─────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.cancel();
			return;
		}

		if (this.inputMode) {
			if (matchesKey(data, Key.escape)) {
				this.inputMode = false;
				this.editor = undefined;
				this.refresh();
				return;
			}
			this.ensureEditor().handleInput(data);
			this.tui.requestRender();
			return;
		}

		const isMulti = !!this.currentQ.multiSelect;
		const total = this.totalItems;

		if (
			this.keybindings.matches(data, "tui.select.up") ||
			matchesKey(data, Key.shift("tab")) ||
			matchesKey(data, Key.ctrl("k"))
		) {
			if (total > 0) {
				this.selectedOptionIndex =
					(this.selectedOptionIndex - 1 + total) % total;
				this.refresh();
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
				this.refresh();
			}
			return;
		}

		if (matchesKey(data, Key.left)) {
			this.gotoQuestion(this.currentIndex - 1);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.gotoQuestion(this.currentIndex + 1);
			return;
		}

		if (
			this.keybindings.matches(data, "tui.editor.deleteCharBackward") ||
			matchesKey(data, Key.backspace)
		) {
			if (this.searchQuery) {
				const chars = [...this.searchQuery];
				chars.pop();
				this.searchQuery = chars.join("");
				this.selectedOptionIndex = 0;
				this.refresh();
			}
			return;
		}

		if (matchesKey(data, Key.escape)) {
			if (this.searchQuery) {
				this.searchQuery = "";
				this.selectedOptionIndex = 0;
				this.refresh();
			}
			return;
		}

		if (matchesKey(data, Key.space) && isMulti) {
			if (this.selectedItem?.kind === "option" && this.selectedItem.option) {
				const idx = this.filteredOptions.indexOf(this.selectedItem.option);
				if (idx >= 0) this.toggleMulti(idx);
				this.refresh();
			}
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch && this.filteredOptions.length > 0) {
			const idx = Number(numMatch[0]) - 1;
			if (idx >= 0 && idx < this.filteredOptions.length) {
				if (isMulti) {
					this.toggleMulti(idx);
					this.selectedOptionIndex = Math.min(idx, this.totalItems - 1);
					this.refresh();
				} else {
					const opt = this.filteredOptions[idx]!;
					this.recordAnswer("option", opt.label, undefined, opt.preview);
					this.nextQuestion();
				}
				return;
			}
		}

		if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.commitAnswer();
			return;
		}

		if (!isMulti) {
			const printable = decodeKittyPrintable(data);
			if (printable !== undefined) {
				this.searchQuery += printable;
				this.selectedOptionIndex = 0;
				this.refresh();
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
				this.refresh();
			}
		}
	}

	// ── Rendering ──────────────────────────────────────────────────────

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

		const useSplit = hasPreview && width >= SPLIT_PANE_MIN_WIDTH;
		const leftWidth = useSplit ? Math.floor((width - 6) * 0.45) : inner;
		const previewWidth = useSplit ? Math.max(20, width - leftWidth - 10) : 0;

		const lines: string[] = [];

		const row = (content: string): string =>
			` ${truncateToWidth(content, Math.max(0, width - 1), "")}`;

		// Tab bar
		if (this.params.questions.length > 1) {
			const tabParts: string[] = [];
			for (let i = 0; i < this.params.questions.length; i++) {
				const active = i === this.currentIndex;
				const tag = `${i + 1}.${this.params.questions[i]?.header}`;
				tabParts.push(active ? t.fg("accent", t.bold(tag)) : t.fg("dim", tag));
			}
			lines.push(row(tabParts.join(t.fg("dim", "  "))));
		}

		// Header chip
		const chip = t.fg("accent", t.bold(this.currentQ.header));
		const prog =
			this.params.questions.length > 1
				? dim(t)(` ${this.currentIndex + 1}/${this.params.questions.length}`)
				: "";
		lines.push(row(`${chip}${prog}`));

		// Question text
		for (const w of wrapTextWithAnsi(
			this.currentQ.question,
			Math.max(10, inner),
		)) {
			lines.push(row(t.fg("text", t.bold(w))));
		}

		// Input mode
		if (this.inputMode) {
			lines.push("");
			lines.push(row(t.fg("accent", t.bold("Type your response:"))));
			lines.push("");
			const editorLines = this.ensureEditor().render(Math.max(0, width - 1));
			for (const el of editorLines) {
				lines.push(` ${truncateToWidth(el, Math.max(0, width - 1), "")}`);
			}
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

		// Chat sentinel
		const chatLabel =
			this.selectedOptionIndex === -999
				? t.fg("accent", t.bold(SENTINEL_CHAT))
				: t.fg("dim", SENTINEL_CHAT);
		lines.push(row(`  ${t.fg("dim", "💬")} ${chatLabel}`));

		// Options (with optional split-pane preview)
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
				const body = `${left || " ".repeat(leftWidth - 1)}${sep}${right || " ".repeat(previewWidth - 2)}`;
				lines.push(` ${truncateToWidth(body, Math.max(0, width - 1), "")}`);
			}
		} else {
			for (const line of optionLines) lines.push(row(line));
		}

		// Footer hints
		const navHint =
			this.params.questions.length > 1 ? "↑↓ nav • ←→ question" : "↑↓ nav";
		const hintParts = isMulti
			? [
					`${navHint} • space toggle • enter commit • esc clear`,
					"ctrl+c cancel",
				]
			: [
					`${navHint} • type filter • enter select • esc clear`,
					"ctrl+c cancel",
				];
		lines.push(row(dim(t)(hintParts.join(" • "))));
		lines.push("");

		return lines.map((l) => truncateToWidth(l, width, ""));
	}
}
