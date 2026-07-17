import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const OPENING_FENCE_RE = /^```([^`]*)$/;
const CLOSING_FENCE_RE = /^```\s*$/;
const DEFAULT_LABEL = "code";
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const PATCHED = Symbol.for("@xynogen/pix-display:code-block-renderer");

type CodeFrameTheme = Pick<Theme, "bg" | "bold" | "fg" | "getBgAnsi">;

type PatchablePrototype = {
	[PATCHED]?: boolean;
	render(width: number): string[];
};

let activeTheme: CodeFrameTheme | undefined;

function plainText(line: string): string {
	return line.replace(OSC_RE, "").replace(ANSI_RE, "");
}

function oscSequences(line: string): string {
	return line.match(OSC_RE)?.join("") ?? "";
}

function leadingSpaces(line: string): number {
	return plainText(line).match(/^ */)?.[0].length ?? 0;
}

function stripLayoutWhitespace(line: string, count: number): string {
	let remaining = count;
	return line
		.replace(OSC_RE, "")
		.replace(/^(?:\x1b\[[0-?]*[ -/]*[@-~]| )+/, (prefix) =>
			prefix.replace(/ /g, (space) => {
				if (remaining <= 0) return space;
				remaining--;
				return "";
			}),
		)
		.replace(/ +$/, "");
}

function paintFrame(theme: CodeFrameTheme, text: string): string {
	try {
		const bg = theme.getBgAnsi("toolSuccessBg");
		const preserved = text.replace(/\x1b\[([0-9;]*)m/g, (sequence, params: string) =>
			params === "0" || params.split(";").includes("49") ? `${sequence}${bg}` : sequence,
		);
		return `${bg}${preserved}\x1b[49m`;
	} catch {
		return theme.bg("toolSuccessBg", text);
	}
}

function fenceLabel(line: string): string | undefined {
	const match = plainText(line).trim().match(OPENING_FENCE_RE);
	if (!match) return undefined;
	const info = (match[1] ?? "").trim();
	return info.split(/\s+/, 1)[0] || DEFAULT_LABEL;
}

function topBorder(width: number, language: string, theme: CodeFrameTheme): string {
	const available = Math.max(1, width - 6);
	const displayLanguage = truncateToWidth(language, available, "…");
	const label = theme.bold(theme.fg("accent", ` ${displayLanguage} `));
	const ruleWidth = Math.max(0, width - visibleWidth(label) - 3);
	return paintFrame(
		theme,
		`${theme.fg("borderMuted", "╭─")}${label}${theme.fg("borderMuted", `${"─".repeat(ruleWidth)}╮`)}`,
	);
}

function bottomBorder(width: number, theme: CodeFrameTheme): string {
	return paintFrame(theme, theme.fg("borderMuted", `╰${"─".repeat(Math.max(0, width - 2))}╯`));
}

function bodyLine(
	line: string,
	width: number,
	layoutIndent: number,
	theme: CodeFrameTheme,
): string {
	const innerWidth = Math.max(1, width - 4);
	const content = truncateToWidth(stripLayoutWhitespace(line, layoutIndent), innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
	return paintFrame(
		theme,
		`${theme.fg("borderMuted", "│")} ${content}${padding} ${theme.fg("borderMuted", "│")}`,
	);
}

/**
 * Replace native Markdown fence rows with a themed code frame while preserving
 * the syntax-highlighted ANSI content produced by Pi for every language.
 */
export function renderCodeFences(lines: string[], width: number, theme: CodeFrameTheme): string[] {
	if (width < 12) return lines;

	const out = [...lines];
	for (let start = 0; start < out.length; start++) {
		const language = fenceLabel(out[start] ?? "");
		if (!language) continue;

		let end = start + 1;
		while (end < out.length && !CLOSING_FENCE_RE.test(plainText(out[end] ?? "").trim())) {
			end++;
		}
		if (end >= out.length) continue;

		const pad = Math.min(leadingSpaces(out[start] ?? ""), Math.floor((width - 12) / 2));
		const frameWidth = Math.max(12, width - pad * 2);
		const body = out.slice(start + 1, end);
		const bodyIndent = Math.min(
			...body
				.map((line) => plainText(line))
				.filter((line) => line.trim().length > 0)
				.map((line) => leadingSpaces(line)),
			pad,
		);
		const left = " ".repeat(pad);
		const right = " ".repeat(Math.max(0, width - pad - frameWidth));
		const framed: string[] = [];

		framed.push(
			`${oscSequences(out[start] ?? "")}${left}${topBorder(frameWidth, language, theme)}${right}`,
		);
		for (let index = start + 1; index < end; index++) {
			framed.push(
				`${oscSequences(out[index] ?? "")}${left}${bodyLine(out[index] ?? "", frameWidth, bodyIndent, theme)}${right}`,
			);
		}
		framed.push(`${oscSequences(out[end] ?? "")}${left}${bottomBorder(frameWidth, theme)}${right}`);

		out.splice(start, end - start + 1, ...framed);
		start += framed.length - 1;
	}
	return out;
}

function patchAssistantRenderer(): void {
	const prototype = AssistantMessageComponent.prototype as PatchablePrototype;
	if (prototype[PATCHED]) return;

	const nativeRender = prototype.render;
	prototype.render = function renderWithCodeFrames(width: number): string[] {
		const lines = nativeRender.call(this, width);
		return activeTheme ? renderCodeFences(lines, width, activeTheme) : lines;
	};
	prototype[PATCHED] = true;
}

export default function codeBlocksExtension(pi: ExtensionAPI): void {
	patchAssistantRenderer();
	pi.on("session_start", (_event, ctx) => {
		activeTheme = ctx.mode === "tui" ? ctx.ui.theme : undefined;
	});
}
