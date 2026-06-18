/**
 * Welcome extension — ASCII art banner + startup health checks.
 *
 * Renders a coloured π logo above the editor on session start.
 * Runs checks in parallel while the banner is visible:
 *
 *   · pi version   — read installed version only
 *   · auth         — at least one provider configured in modelRegistry
 *   · gitignore    — auto-ignore Pi emissions (.ai/.pi-lens) in git repos
 *
 * Each check updates the banner live as results arrive.
 * Banner auto-dismisses on the first user turn (turn_start).
 *
 * Layout:
 *
 *   ██████╗ ██╗██╗  ██╗
 *   ██╔══██╗██║╚██╗██╔╝
 *   ██████╔╝██║ ╚███╔╝
 *   ██╔═══╝ ██║ ██╔██╗
 *   ██║     ██║██╔╝ ██╗
 *   ╚═╝     ╚═╝╚═╝  ╚═╝
 *
 *   ✓ PI      0.78.0
 *   ✓ Auth    connected
 *   ✓ Models  16 loaded
 *   ✓ Tools   24 loaded
 *   ✓ Ignore  up to date
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ─── Theme shim (same pattern as footer.ts) ───────────────────────────────────

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

// ─── ASCII logo ───────────────────────────────────────────────────────────────

export type Tag = "heading" | "model" | "cwd" | "ready" | "";

export const LOGO_ROWS: [string, Tag][] = [
	["██████╗ ██╗██╗  ██╗", ""],
	["██╔══██╗██║╚██╗██╔╝", "heading"],
	["██████╔╝██║ ╚███╔╝ ", ""],
	["██╔═══╝ ██║ ██╔██╗ ", "model"],
	["██║     ██║██╔╝ ██╗", "cwd"],
	["╚═╝     ╚═╝╚═╝  ╚═╝", "ready"],
];

// ─── Check result ─────────────────────────────────────────────────────────────

export type CheckStatus = "pending" | "ok" | "warn" | "error";

export interface CheckResult {
	label: string;
	status: CheckStatus;
	detail?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const shortCwd = (cwd: string, home?: string): string => {
	const h = home ?? process.env.HOME ?? "";
	return h && cwd.startsWith(h) ? `~${cwd.slice(h.length)}` : cwd;
};

export const PI_IGNORE_RULES = [".pi/", ".pi-lens/"];
const PI_IGNORE_SECTION_HEADER = "# Pix Agent";

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkPiVersion(pi: ExtensionAPI): Promise<CheckResult> {
	try {
		const localRes = await pi.exec("pi", ["--version"], { timeout: 2_000 });
		const local = (localRes.stdout.trim() || localRes.stderr.trim()).replace(
			/^v/,
			"",
		);
		return { label: "PI", status: "ok", detail: local || "installed" };
	} catch {
		return { label: "PI", status: "warn", detail: "version unavailable" };
	}
}

type ExecResult = {
	stdout: string;
	stderr: string;
	exitCode?: number;
	code?: number;
};

function exitCode(r: ExecResult): number {
	return r.exitCode ?? r.code ?? 0;
}

function execOpts(cwd: string, timeout: number): { timeout?: number } {
	return { cwd, timeout } as unknown as { timeout?: number };
}

async function checkPiIgnore(
	pi: ExtensionAPI,
	cwd: string,
): Promise<CheckResult> {
	try {
		// Find repo root — avoids creating .gitignore in a subfolder
		const rootRes = await pi.exec(
			"git",
			["rev-parse", "--show-toplevel"],
			execOpts(cwd, 2_000),
		);
		if (exitCode(rootRes) !== 0) {
			return { label: "Ignore", status: "ok", detail: "not git" };
		}
		const repoRoot = rootRes.stdout.trim();
		if (!repoRoot) return { label: "Ignore", status: "ok", detail: "not git" };

		// Determine which rules are missing
		const missing: string[] = [];
		for (const rule of PI_IGNORE_RULES) {
			const hasRule = await pi.exec(
				"grep",
				["-qxF", rule, ".gitignore"],
				execOpts(repoRoot, 1_000),
			);
			if (exitCode(hasRule) !== 0) missing.push(rule);
		}

		if (missing.length === 0) {
			return { label: "Ignore", status: "ok", detail: "up to date" };
		}

		// Rewrite .gitignore — strip any existing Pix Agent section, then append
		// a clean block with all rules under a single header.
		const gitignorePath = `${repoRoot}/.gitignore`;
		const allRules = PI_IGNORE_RULES;
		const addRules = await pi.exec(
			"node",
			[
				"-e",
				[
					"const fs = require('fs');",
					`const p = ${JSON.stringify(gitignorePath)};`,
					`const header = ${JSON.stringify(PI_IGNORE_SECTION_HEADER)};`,
					`const rules = ${JSON.stringify(allRules)};`,
					"const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';",
					// Strip existing Pix Agent section (header line + consecutive rule lines)
					"const stripped = existing.replace(/(?:^|\\n)# Pix Agent\\n(?:[^\\n]*\\n)*/g, '\\n').trimEnd();",
					"const block = [header, ...rules].join('\\n');",
					"const content = (stripped ? stripped + '\\n\\n' : '') + block + '\\n';",
					"fs.writeFileSync(p, content, 'utf8');",
				].join("\n"),
			],
			execOpts(repoRoot, 5_000),
		);

		return exitCode(addRules) === 0
			? {
					label: "Ignore",
					status: "ok",
					detail: `added ${missing.length} rule${missing.length === 1 ? "" : "s"}`,
				}
			: { label: "Ignore", status: "warn", detail: "write failed" };
	} catch {
		return { label: "Ignore", status: "warn", detail: "check failed" };
	}
}

interface ToolInfo {
	sourceInfo?: { source?: string };
}

/**
 * Summarise loaded tools by source. Counts everything in `getActiveTools()`
 * and breaks out built-in vs. extension/custom tools for the detail line.
 */
export function summariseTools(tools: ToolInfo[]): CheckResult {
	const total = tools.length;
	if (total === 0) {
		return { label: "Tools", status: "warn", detail: "none active" };
	}
	const builtin = tools.filter(
		(t) => t.sourceInfo?.source === "builtin",
	).length;
	const extra = total - builtin;
	const detail =
		extra > 0 ? `${total} loaded (+${extra} ext)` : `${total} loaded`;
	return { label: "Tools", status: "ok", detail };
}

function checkTools(pi: { getActiveTools?: () => ToolInfo[] }): CheckResult {
	try {
		const tools = pi.getActiveTools?.() ?? [];
		return summariseTools(tools);
	} catch {
		return { label: "Tools", status: "warn", detail: "unavailable" };
	}
}

function checkAuth(ctx: {
	modelRegistry: { getAvailable(): unknown[] };
}): [CheckResult, CheckResult] {
	try {
		const models = ctx.modelRegistry.getAvailable();
		const count = models.length;
		if (count === 0) {
			return [
				{ label: "Auth", status: "warn", detail: "run /login" },
				{ label: "Models", status: "warn", detail: "0 loaded" },
			];
		}
		return [
			{ label: "Auth", status: "ok", detail: "connected" },
			{ label: "Models", status: "ok", detail: `${count} loaded` },
		];
	} catch {
		return [
			{ label: "Auth", status: "error", detail: "registry unavailable" },
			{ label: "Models", status: "error", detail: "unavailable" },
		];
	}
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function statusIcon(theme: Theme, status: CheckStatus): string {
	switch (status) {
		case "pending":
			return theme.fg("muted", "○");
		case "ok":
			return theme.fg("success", "✓");
		case "warn":
			return theme.fg("warning", "⚠");
		case "error":
			return theme.fg("error", "✗");
	}
}

export const LABEL_WIDTH = 6; // visual chars for label column

export function renderCheck(theme: Theme, c: CheckResult): string {
	const icon = statusIcon(theme, c.status);
	const labelColor =
		c.status === "error" ? "error" : c.status === "warn" ? "warning" : "muted";
	const label = theme.fg(labelColor, c.label.padEnd(LABEL_WIDTH));
	const detail = c.detail ? theme.fg("text", c.detail) : "";
	return `${icon} ${label}  ${detail}`;
}

function buildLogoLines(theme: Theme, model: string, cwd: string): string[] {
	const pad = "   ";
	return LOGO_ROWS.map(([logo, tag]) => {
		const l = theme.fg("accent", logo);
		switch (tag) {
			case "heading":
				return `${pad}${l}  ${theme.fg("muted", "PIx")}`;
			case "model":
				return `${pad}${l}  ${theme.fg("muted", "󰚩")}  ${theme.fg("text", model)}`;
			case "cwd":
				return `${pad}${l}  ${theme.fg("muted", "")}  ${theme.fg("text", cwd)}`;
			case "ready":
				return `${pad}${l}  ${theme.fg("success", "󰘳")}  ${theme.bold(theme.fg("success", "ready"))}`;
			default:
				return `${pad}${l}`;
		}
	});
}

function buildCheckLines(theme: Theme, checks: CheckResult[]): string[] {
	if (checks.length === 0) return [];
	const pad = "   ";
	const lines: string[] = [""];
	for (const c of checks) {
		lines.push(`${pad}${renderCheck(theme, c)}`);
	}
	return lines;
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let dismissed = false;
	let requestRender: (() => void) | null = null;

	const dismiss = (ctx: ExtensionContext) => {
		if (dismissed) return;
		dismissed = true;
		requestRender = null;
		ctx.ui?.setWidget?.("welcome", undefined);
	};

	pi.on("session_start", (_event, ctx) => {
		dismissed = false;

		// cwd is static; model can change via /model so keep it mutable
		const modelId = ctx.model?.id ?? "—";
		const cwd = shortCwd(ctx.cwd);

		// Pending placeholders — one per check
		const CHECKS: CheckResult[] = [
			{ label: "PI", status: "pending" },
			{ label: "Auth", status: "pending" },
			{ label: "Models", status: "pending" },
			{ label: "Tools", status: "pending" },
			{ label: "Ignore", status: "pending" },
		];

		// Auth + Models checks are synchronous — fill immediately
		const [authResult, modelsResult] = checkAuth(ctx);
		CHECKS[1] = authResult;
		CHECKS[2] = modelsResult;

		// Register widget
		if (!ctx.ui.setWidget) return;
		ctx.ui.setWidget(
			"welcome",
			(tui: { requestRender(): void }, theme: Theme) => {
				requestRender = () => tui.requestRender();

				return {
					render: () => {
						const t = theme as unknown as Theme;
						// Re-read modelId each render so /model changes show live
						const logoLines = buildLogoLines(t, modelId, cwd);
						return [...logoLines, ...buildCheckLines(t, CHECKS), ""];
					},
					dispose() {
						requestRender = null;
					},
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);

		// Run async checks in parallel; each updates CHECKS and re-renders
		const update = (idx: number, result: CheckResult) => {
			if (dismissed) return;
			CHECKS[idx] = result;
			requestRender?.();
		};

		void checkPiVersion(pi).then((r) => update(0, r));
		void checkPiIgnore(pi, ctx.cwd).then((r) => update(4, r));
		// auth already filled synchronously above; no async needed

		// Tools register during session_start (incl. other extensions); read on
		// next tick so dynamically registered tools are counted.
		setTimeout(
			() =>
				update(
					3,
					checkTools(pi as unknown as { getActiveTools?: () => ToolInfo[] }),
				),
			0,
		);
	});

	pi.on("turn_start", (_event, ctx) => {
		dismiss(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		dismiss(ctx);
	});
}
