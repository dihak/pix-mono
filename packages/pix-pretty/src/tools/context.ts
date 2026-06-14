import type { CursorStore, FffState } from "../fff.js";
import type { TextComponentCtor } from "../types.js";

// ── Shared context passed to each tool registrar ───────────────────────

export interface ToolContext {
	/** Current working directory */
	cwd: string;
	/** Shorten a path for display */
	sp: (p: string) => string;
	/** Text component constructor */
	TextComponent: TextComponentCtor;
	/** FFF state (shared across tools) */
	fffState: FffState;
	/** FFF cursor store */
	cursorStore: CursorStore;
}
