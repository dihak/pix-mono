/**
 * paste-chips — collapse pasted image paths into Pi paste markers, and
 * re-render all paste markers with type-aware labels.
 *
 *   /tmp/pi-clipboard-abc.png   →  buffer: [paste #1 58 chars]
 *                                  display: [paste image #1]
 *
 *   long pasted text            →  buffer: [paste #2 +42 lines]
 *                                  display: [paste text +42]
 *
 * Atomic deletion + cursor handling come from Pi's marker grammar.
 * On submit, getExpandedText() restores the real path/text for the model.
 * The display rewrite is purely visual (render layer); buffer is untouched.
 */

import type { ExtensionAPI, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BOLD, FG_BLUE, FG_DIM, FG_GREEN, RST } from "@xynogen/pix-pretty/ansi";
import { icon } from "@xynogen/pix-pretty/icon-catalog";

// Upstream stopped re-exporting `EditorFactory` from the package entry point,
// so we reconstruct its signature locally from the still-exported primitives.
// This matches ctx.ui.setEditorComponent's expected factory shape.
type EditorFactory = (
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => CustomEditor;

// ─── Constants ────────────────────────────────────────────────────────────────

// Boundary wrapper injected around each expanded paste so the model sees an
// explicit start/end per blob instead of multiple pastes merged into one wall.
// Applies to text and image pastes alike.
const PASTE_OPEN = "<paste>";
const PASTE_CLOSE = "</paste>";

const IMAGE_EXTS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".tif",
	".tiff",
	".heic",
	".heif",
]);

// Group 1 = prefix char (or empty at start), Group 2 = path
const PATH_RE = /(^|[^\w/])((?:~|\/)[^\s,;'"(){}[\]]+)/g;

// Pi's marker grammar — must match exactly for atomic segmentation.
// e.g. `[paste #1 58 chars]` or `[paste #2 +42 lines]`
const MARKER_RE = /\[paste #(\d+)( (\+(\d+) lines|(\d+) chars))?\]/g;
// Cursor inversion codes the TUI Editor embeds when the cursor intersects
// a marker. Strip them before matching — Pi re-wraps each render call, so
// width-preserving is not required.
const CURSOR_RE = /\x1b\[[0-9;]*m/g;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extOf(p: string): string {
	const dot = p.lastIndexOf(".");
	return dot >= 0 ? p.slice(dot).toLowerCase() : "";
}

function isImagePath(p: string): boolean {
	return IMAGE_EXTS.has(extOf(p));
}

function makeMarker(id: number, charCount: number): string {
	return `[paste #${id} ${charCount} chars]`;
}

// ─── Editor internals (Pi's TS-private fields are runtime-public JS) ─────────

type EditorInternals = {
	pastes: Map<number, string>;
	pasteCounter: number;
};

// expandPasteMarkers is TS-private on the base Editor but runtime-public JS.
// We reimplement its loop (rather than call super) so we can wrap each
// replacement, and to avoid depending on a non-exported private method.
type ExpandInternals = {
	pastes: Map<number, string>;
};

type ExpandPasteHandler = { expandPasteMarkers(text: string): string };

// Mirror of the base Editor's paste-marker grammar, per-id at expand time.
function markerReFor(pasteId: number): RegExp {
	return new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
}

/**
 * Expand every paste marker in `text` to its content wrapped in
 * `<paste>…</paste>`. Mirrors the base Editor's expansion loop but adds a
 * boundary per blob (text and image alike) so adjacent pastes can't merge
 * into one indistinguishable wall in the model-facing text.
 */
export function expandPasteMarkers(text: string, pastes: Map<number, string>): string {
	let result = text;
	for (const [pasteId, pasteContent] of pastes) {
		result = result.replace(
			markerReFor(pasteId),
			() => `${PASTE_OPEN}${pasteContent}${PASTE_CLOSE}`,
		);
	}
	return result;
}

// ─── Path → marker rewriter ──────────────────────────────────────────────────

/**
 * Walk `text`, for each image path: allocate a new paste ID, register the
 * real path in editor.pastes, remember the ID as an image, and emit a
 * Pi-format marker so deletion is atomic.
 *
 * Exported for integration testing: composed with `expandPasteMarkers`, this
 * reproduces the full clipboard-image round-trip (path insert → marker →
 * boundary-wrapped expansion) without standing up a live TUI editor.
 */
export function replaceImagePaths(
	text: string,
	internals: EditorInternals,
	imageIds: Set<number>,
): string {
	return text.replace(PATH_RE, (_, prefix: string, rawPath: string) => {
		if (!isImagePath(rawPath)) return prefix + rawPath;
		internals.pasteCounter += 1;
		const id = internals.pasteCounter;
		internals.pastes.set(id, rawPath);
		imageIds.add(id);
		return prefix + makeMarker(id, rawPath.length);
	});
}

// ─── Display rewriter ────────────────────────────────────────────────────────

/**
 * Re-style every paste marker in a rendered line:
 *   image  → `󰋩 image #N` with blue icon/label
 *   text   → `󰉿 text Lines lines` or `󰉿 text Chars chars` with green icon/label
 *
 * Width-preserving is not required — Pi re-wraps each render call.
 */
export function restyleMarkers(line: string, imageIds: Set<number>): string {
	// Strip cursor inversion codes the TUI embeds when the cursor
	// intersects a marker — plain MARKER_RE handles the rest.
	const clean = line.includes("\x1b") ? line.replace(CURSOR_RE, "") : line;
	return clean.replace(MARKER_RE, (_full, idStr, _g2, _g3, linesStr, charsStr) => {
		const id = Number.parseInt(idStr, 10);
		if (imageIds.has(id)) {
			return chip(FG_BLUE, icon("paste.image"), "image", `#${id}`);
		}
		if (linesStr) {
			return chip(FG_GREEN, icon("paste.text"), "text", `${linesStr} lines`);
		}
		if (charsStr) {
			return chip(FG_GREEN, icon("paste.text"), "text", `${compactNumber(charsStr)} chars`);
		}
		return chip(FG_GREEN, icon("paste.text"), "text", `#${id}`);
	});
}

function chip(color: string, icon: string, label: string, meta: string): string {
	return `${color}${BOLD}${icon} ${label}${RST}${FG_DIM} ${meta}${RST}`;
}

/** True when `text` ends with a Pi paste marker (chip), e.g. `[paste #1 58 chars]`. */
export function endsWithMarker(text: string): boolean {
	return /\[paste #\d+[^\]]*\]$/.test(text);
}

function compactNumber(raw: string): string {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return raw;
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

// ─── Custom editor ────────────────────────────────────────────────────────────

// handlePaste is TS-private in CustomEditor but runtime-public JS. We patch it
// per-instance, capturing the base implementation, so large text pastes get the
// same trailing-space treatment as image chips.
type PasteHandler = { handlePaste(text: string): void };

class ChipEditor extends CustomEditor {
	private readonly imageIds = new Set<number>();

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		this.patchHandlePaste();
		this.patchExpandPasteMarkers();
	}

	override insertTextAtCursor(text: string): void {
		const internals = this as unknown as EditorInternals;
		const replaced = replaceImagePaths(text, internals, this.imageIds);
		// Append a trailing space when the insertion ends with a paste marker so
		// the cursor lands after the chip rather than inside it.
		super.insertTextAtCursor(endsWithMarker(replaced) ? `${replaced} ` : replaced);
	}

	/**
	 * Patch `expandPasteMarkers` (TS-private on the base Editor, runtime-public
	 * JS) so every paste expands to its content wrapped in `<paste>…</paste>`,
	 * giving the model an explicit boundary per blob — text and image alike.
	 * The base inlines content raw, letting adjacent pastes merge into one
	 * indistinguishable wall. Patched per-instance, mirroring patchHandlePaste.
	 */
	private patchExpandPasteMarkers(): void {
		const internals = this as unknown as ExpandInternals;
		const self = this as unknown as ExpandPasteHandler;
		self.expandPasteMarkers = (text: string): string => expandPasteMarkers(text, internals.pastes);
	}

	private patchHandlePaste(): void {
		const self = this as unknown as PasteHandler;
		const base = self.handlePaste.bind(self);
		self.handlePaste = (pastedText: string) => {
			const before = this.getText();
			base(pastedText);
			const after = this.getText();
			// Only nudge a space when the paste collapsed into a marker chip;
			// inline small pastes (no marker) are left untouched.
			if (endsWithMarker(after) && after !== before) {
				super.insertTextAtCursor(" ");
			}
		};
	}

	override render(width: number): string[] {
		const raw = super.render(width);
		return raw.map((line) => {
			const restyled = restyleMarkers(line, this.imageIds);
			// Restyling may widen lines (e.g. "#1" → "text"), so clamp to width.
			if (visibleWidth(restyled) > width) {
				return truncateToWidth(restyled, width, "");
			}
			return restyled;
		});
	}
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const factory: EditorFactory = (tui, theme, keybindings) =>
			new ChipEditor(tui, theme, keybindings);
		ctx.ui.setEditorComponent(factory);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent(undefined);
	});
}
