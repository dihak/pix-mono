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

import type {
	ExtensionAPI,
	KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Upstream stopped re-exporting `EditorFactory` from the package entry point,
// so we reconstruct its signature locally from the still-exported primitives.
// This matches ctx.ui.setEditorComponent's expected factory shape.
type EditorFactory = (
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => CustomEditor;

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Path → marker rewriter ──────────────────────────────────────────────────

/**
 * Walk `text`, for each image path: allocate a new paste ID, register the
 * real path in editor.pastes, remember the ID as an image, and emit a
 * Pi-format marker so deletion is atomic.
 */
function replaceImagePaths(
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
 *   image  → `[paste image #N]`
 *   text   → `[paste text +Lines]` or `[paste text Chars]`
 *
 * Width-preserving is not required — Pi re-wraps each render call.
 */
export function restyleMarkers(line: string, imageIds: Set<number>): string {
	return line.replace(
		MARKER_RE,
		(_full, idStr, _g2, _g3, linesStr, charsStr) => {
			const id = Number.parseInt(idStr, 10);
			if (imageIds.has(id)) {
				return `[paste image #${id}]`;
			}
			if (linesStr) {
				return `[paste text +${linesStr}]`;
			}
			if (charsStr) {
				return `[paste text ${charsStr} chars]`;
			}
			return `[paste text #${id}]`;
		},
	);
}

// ─── Custom editor ────────────────────────────────────────────────────────────

class ChipEditor extends CustomEditor {
	private readonly imageIds = new Set<number>();

	override insertTextAtCursor(text: string): void {
		const internals = this as unknown as EditorInternals;
		super.insertTextAtCursor(replaceImagePaths(text, internals, this.imageIds));
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
