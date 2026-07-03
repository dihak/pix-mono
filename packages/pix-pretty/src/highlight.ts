import { normalizeShikiContrast } from "./ansi.js";
import { CACHE_LIMIT, MAX_HL_CHARS, THEME } from "./config.js";
import type { BundledLanguage } from "./types.js";

// Engine: cli-highlight (highlight.js-backed, synchronous ANSI output).
//
// cli-highlight colors via chalk, which decides its color level ONCE based on
// TTY/env detection. Shiki's codeToANSI always emitted truecolor regardless of
// stream; to match that (pi renders highlighted output into its own TUI, which
// is not the process stdout chalk inspects) we default FORCE_COLOR before chalk
// initializes, and lazy-load cli-highlight so this runs first. Respect an
// explicit FORCE_COLOR/NO_COLOR if the user set one.
if (process.env.FORCE_COLOR === undefined && process.env.NO_COLOR === undefined) {
	process.env.FORCE_COLOR = "3";
}

type CliHighlight = typeof import("cli-highlight");

let _hl: CliHighlight | null = null;

// Deterministically force chalk's color level to truecolor. The FORCE_COLOR
// env default above only works if chalk has not been required yet — but if
// ANY transitive dependency loads chalk before this module evaluates, chalk
// freezes its level at 0 (pi's TUI is not a TTY) and cli-highlight emits NO
// ANSI, so read/diff render as plain text. Setting chalk.level after require
// is load-order-independent and fixes that. Respect NO_COLOR.
function forceChalkColor(): void {
	if (process.env.NO_COLOR !== undefined) return;
	try {
		const chalk = require("chalk");
		const c = chalk?.default ?? chalk;
		if (c && typeof c.level === "number" && c.level < 3) c.level = 3;
	} catch {
		/* chalk not resolvable — cli-highlight will fall back gracefully */
	}
}

function cliHighlight(): CliHighlight | null {
	if (_hl) return _hl;
	try {
		forceChalkColor();
		_hl = require("cli-highlight") as CliHighlight;
	} catch {
		_hl = null;
	}
	return _hl;
}

const HLJS_LANG_ALIAS: Record<string, string> = {
	tsx: "typescript",
	jsx: "javascript",
	jsonc: "json",
	mdx: "markdown",
	make: "makefile",
	svelte: "html",
	vue: "html",
};

function toHljsLang(language: BundledLanguage): string | undefined {
	const hl = cliHighlight();
	if (!hl) return undefined;
	const mapped = HLJS_LANG_ALIAS[language] ?? language;
	return hl.supportsLanguage(mapped) ? mapped : undefined;
}

export const _cache = new Map<string, string[]>();

function _touch(k: string, v: string[]): string[] {
	_cache.delete(k);
	_cache.set(k, v);
	while (_cache.size > CACHE_LIMIT) {
		const first = _cache.keys().next().value;
		if (first === undefined) break;
		_cache.delete(first);
	}
	return v;
}

// Async signature is preserved (renderers await hlBlock) even though
// cli-highlight is synchronous — keeps the call sites 1:1 with upstream.
export async function hlBlock(
	code: string,
	language: BundledLanguage | undefined,
): Promise<string[]> {
	if (!code) return [""];
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");

	const hljsLang = toHljsLang(language);
	if (!hljsLang) return code.split("\n");

	const k = `${THEME}\0${hljsLang}\0${code}`;
	const hit = _cache.get(k);
	if (hit) return _touch(k, hit);

	const hl = cliHighlight();
	if (!hl) return code.split("\n");

	try {
		const ansi = normalizeShikiContrast(
			hl.highlight(code, { language: hljsLang, ignoreIllegals: true }),
		);
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return _touch(k, out);
	} catch {
		return code.split("\n");
	}
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function clearHighlightCache(): void {
	_cache.clear();
}
