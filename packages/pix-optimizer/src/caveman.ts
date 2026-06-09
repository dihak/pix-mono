/**
 * caveman.ts — pure logic + Pi extension
 *
 * Pure helpers exported for tests; caveman(pi) is the extension entry,
 * called by index.ts alongside rtk(pi).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import type { OptimizerHandle, OptimizerStatus } from "./status.ts";

// ── Levels ────────────────────────────────────────────────────────────────────

export const LEVELS = ["off", "lite", "full", "ultra", "micro"] as const;

export type Level = (typeof LEVELS)[number];

export const STOP_ALIASES = new Set(["off", "stop", "quit", "0"]);

// Numeric shortcuts: /caveman 1|2|3
export const LEVEL_NUMBERS: Record<string, Level> = {
	"1": "lite",
	"2": "full",
	"3": "ultra",
};

export const CAVEMAN_COMMAND_OPTIONS = [
	{ value: "1", label: "1 (lite)", description: "Professional, no fluff" },
	{ value: "2", label: "2 (full)", description: "Classic caveman" },
	{ value: "3", label: "3 (ultra)", description: "Maximum compression" },
	{ value: "lite", label: "lite", description: "Professional, no fluff" },
	{ value: "full", label: "full", description: "Classic caveman" },
	{ value: "ultra", label: "ultra", description: "Maximum compression" },
	{
		value: "micro",
		label: "micro",
		description: "Experimental prompt-minimized mode",
	},
	{ value: "off", label: "off", description: "Disable caveman mode" },
	{ value: "stop", label: "stop", description: "Disable caveman mode" },
	{ value: "quit", label: "quit", description: "Disable caveman mode" },
	{ value: "config", label: "config", description: "Open settings dialog" },
] as const;

// ── Status labels ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<Exclude<Level, "off">, string> = {
	lite: "LITE",
	full: "FULL",
	ultra: "ULTRA",
	micro: "MICRO",
};

// ── Prompt fragments ──────────────────────────────────────────────────────────

const BASE = `\
IMPORTANT: You are in CAVEMAN MODE. Respond terse like smart caveman. \
All technical substance stay. Only fluff die.

Rules:
- Drop articles (a/an/the), filler (just/really/basically/actually/simply), \
pleasantries, hedging
- Fragments OK. Short synonyms preferred. Technical terms exact
- Code blocks unchanged. Errors quoted exact
- Pattern: [thing] [action] [reason]. [next step].

Bad: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Good: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"`;

const MICRO_PROMPT = `# Token efficiency
Respond like smart caveman. Cut all filler, keep technical substance.
- Drop articles (a, an, the), filler (just, really, basically, actually).
- Drop pleasantries (sure, certainly, happy to).
- No hedging. Fragments fine. Short synonyms.
- Technical terms stay exact. Code blocks unchanged.
- Pattern: [thing] [action] [reason]. [next step].`;

const INTENSITY: Record<Exclude<Level, "off" | "micro">, string> = {
	lite: `\
No filler/hedging. Keep articles + full sentences. Professional but tight.
Example: "Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."`,

	full: `\
Drop articles, fragments OK, short synonyms.
Example: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."`,

	ultra: `\
Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y).
Example: "Inline obj prop → new ref → re-render. \`useMemo\`."`,
};

const SAFETY = `\
Auto-clarity: drop caveman for security warnings, irreversible action confirmations, \
or when user is confused. Resume after.
Boundaries: write normal code. Only compress explanations. "stop caveman" or "normal mode" reverts.`;

/**
 * Build the system prompt injection for a given level.
 * Returns empty string when level is "off".
 */
export function buildPrompt(level: Level): string {
	if (level === "off") return "";
	if (level === "micro") return MICRO_PROMPT;
	return [BASE, "", `Intensity: ${INTENSITY[level]}`, "", SAFETY].join("\n");
}

// ── Level resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a raw command arg to a Level, or return null if unrecognised.
 * Handles stop aliases (stop/quit → "off") and valid level names.
 */
export function resolveLevel(arg: string): Level | null {
	const a = arg.trim().toLowerCase();
	if (STOP_ALIASES.has(a)) return "off";
	if (LEVEL_NUMBERS[a]) return LEVEL_NUMBERS[a];
	if (LEVELS.includes(a as Level)) return a as Level;
	return null;
}

/**
 * Help text shown when /caveman is run with no argument.
 */
export function buildHelp(current: Level): string {
	const statusLine =
		current === "off" ? "off" : `${STATUS_LABELS[current]} (${current})`;
	return [
		`Caveman mode: ${statusLine}`,
		"",
		"Usage: /caveman <level>",
		"  1  lite   - professional, no fluff",
		"  2  full   - classic caveman",
		"  3  ultra  - maximum compression",
		"  0  off    - disable (aliases: off, stop, quit)",
		"",
		"Other levels: micro",
		"  config    - open settings dialog",
	].join("\n");
}

/**
 * Toggle: off → full, anything else → off.
 */
export function toggleLevel(current: Level): Level {
	return current === "off" ? "full" : "off";
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface CavemanConfig {
	/** Level to apply on new sessions. "off" means don't auto-enable. */
	defaultLevel: Level;
	/** Whether to show the status bar indicator. */
	showStatus: boolean;
}

export const DEFAULT_CONFIG: CavemanConfig = {
	defaultLevel: "full",
	showStatus: true,
};

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "caveman.json");

export function parseConfig(raw: unknown): CavemanConfig {
	const parsed = raw as Record<string, unknown>;
	return {
		defaultLevel: LEVELS.includes(parsed?.defaultLevel as Level)
			? (parsed.defaultLevel as Level)
			: DEFAULT_CONFIG.defaultLevel,
		showStatus:
			typeof parsed?.showStatus === "boolean"
				? parsed.showStatus
				: DEFAULT_CONFIG.showStatus,
	};
}

let _saveQueue: Promise<void> = Promise.resolve();

export async function loadConfig(): Promise<CavemanConfig> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		return parseConfig(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export async function saveConfig(config: CavemanConfig): Promise<void> {
	const snapshot = `${JSON.stringify(config, null, 2)}\n`;
	_saveQueue = _saveQueue.then(async () => {
		await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
		await writeFile(CONFIG_PATH, snapshot, "utf8");
	});
	return _saveQueue;
}

// ── Pi extension ────────────────────────────────────────────────────────────

export function caveman(
	pi: ExtensionAPI,
	status: OptimizerStatus,
): OptimizerHandle {
	let level: Level = "off";
	let config: CavemanConfig = { ...DEFAULT_CONFIG };
	let configLoadPromise: Promise<void> | null = null;

	const ensureConfigLoaded = async () => {
		if (!configLoadPromise) {
			configLoadPromise = (async () => {
				config = await loadConfig();
				if (level === "off" && config.defaultLevel !== "off") {
					level = config.defaultLevel;
				}
			})();
		}
		await configLoadPromise;
	};

	// -- Status: report into the shared optimizer indicator. --

	function syncStatus(ctx: Pick<ExtensionContext, "ui">) {
		const on = level !== "off" && config.showStatus;
		status.set("caveman", on, ctx);
	}

	// Inject caveman prompt via before_agent_start
	pi.on("before_agent_start", async (event, _ctx) => {
		const prompt = buildPrompt(level);
		if (!prompt) return undefined;
		const existing = event.systemPrompt ?? "";
		return { systemPrompt: `${prompt}\n\n${existing}` };
	});

	// -- Restore state on session load --

	pi.on("session_start", async (_event, ctx) => {
		await ensureConfigLoaded();

		let sessionLevel: Level | null = null;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "caveman-level") {
				sessionLevel = (entry.data as { level: Level })?.level ?? null;
			}
		}

		if (sessionLevel !== null) {
			level = sessionLevel;
		} else if (config.defaultLevel !== "off") {
			level = config.defaultLevel;
			pi.appendEntry("caveman-level", { level });
		}

		syncStatus(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		syncStatus(ctx);
	});
	pi.on("session_shutdown", async () => {});

	// -- Subcommand handler (dispatched by the merged /opt router) --

	async function run(
		args: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const arg = args.trim().toLowerCase();

		// No argument → show help
		if (!arg) {
			ctx.ui.notify(buildHelp(level), "info");
			return;
		}

		if (arg === "config") {
			await openConfig(ctx);
			return;
		}

		const resolved = resolveLevel(arg);
		if (resolved === null) {
			ctx.ui.notify(
				`Unknown: "${arg}". Use 1/2/3, ${LEVELS.join(", ")}, stop, quit, or config`,
				"error",
			);
			return;
		}
		level = resolved;

		pi.appendEntry("caveman-level", { level });
		syncStatus(ctx);

		ctx.ui.notify(
			level === "off"
				? "Caveman mode off."
				: `Caveman: ${STATUS_LABELS[level]}`,
			"info",
		);
	}

	function complete(prefix: string) {
		const normalized = prefix.trim().toLowerCase();
		const items = CAVEMAN_COMMAND_OPTIONS.filter((item) =>
			item.value.startsWith(normalized),
		);
		return items.length > 0 ? items.map((i) => ({ ...i })) : null;
	}

	// -- /caveman config: interactive SettingsList --

	async function openConfig(ctx: ExtensionContext) {
		await ensureConfigLoaded();

		await ctx.ui.custom((_tui, theme, _kb, done) => {
			const items: SettingItem[] = [
				{
					id: "defaultLevel",
					label: "Default level for new sessions",
					currentValue: config.defaultLevel,
					values: [...LEVELS],
				},
				{
					id: "showStatus",
					label: "Show status bar",
					currentValue: config.showStatus ? "on" : "off",
					values: ["on", "off"],
				},
			];

			const container = new Container();
			container.addChild(
				new Text(theme.fg("accent", theme.bold(" Caveman Config")), 0, 0),
			);
			container.addChild(
				new Text(theme.fg("dim", " Saved to ~/.pi/agent/caveman.json"), 0, 0),
			);
			container.addChild(
				new Text(
					theme.fg("dim", " Default level applies to future sessions."),
					0,
					0,
				),
			);
			container.addChild(new Text("", 0, 0));

			const applySettingChange = (id: string, newValue: string) => {
				if (id === "defaultLevel" && LEVELS.includes(newValue as Level)) {
					config.defaultLevel = newValue as Level;
				} else if (id === "showStatus") {
					config.showStatus = newValue === "on";
				}
				saveConfig(config);
				syncStatus(ctx);
			};

			const settingsList = new SettingsList(
				items,
				Math.min(items.length + 2, 10),
				getSettingsListTheme(),
				applySettingChange,
				() => done(undefined),
			);

			container.addChild(settingsList);
			container.addChild(
				new Text(
					theme.fg("dim", " ←→/hl/tab change • ↑↓/jk move • esc close"),
					0,
					0,
				),
			);

			const cycleSelectedValue = (direction: -1 | 1) => {
				const selectedIndex = (
					settingsList as unknown as { selectedIndex: number }
				).selectedIndex;
				const item = items[selectedIndex];
				if (!item?.values?.length) return;
				const currentIndex = item.values.indexOf(item.currentValue);
				const nextIndex =
					(currentIndex + direction + item.values.length) % item.values.length;
				const newValue = item.values[nextIndex]!;
				item.currentValue = newValue;
				settingsList.updateValue(item.id, newValue);
				applySettingChange(item.id, newValue);
			};

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (data === "j") data = "\u001b[B";
					else if (data === "k") data = "\u001b[A";
					else if (data === "h") {
						cycleSelectedValue(-1);
						_tui.requestRender();
						return;
					} else if (data === "l" || data === "\u001b[C" || data === "\t") {
						cycleSelectedValue(1);
						_tui.requestRender();
						return;
					} else if (data === "\u001b[D") {
						cycleSelectedValue(-1);
						_tui.requestRender();
						return;
					} else if (data === "\u001b" || data === "q") {
						done(undefined);
						return;
					}

					// SettingsList.handleInput now returns void; completion/cancel is
					// signalled through the onChange/onCancel callbacks passed to the
					// constructor (onCancel -> done(undefined)). Just forward input and
					// re-render.
					settingsList.handleInput(data);
					_tui.requestRender();
				},
			};
		});
	}

	return {
		name: "caveman",
		help: "caveman <1|2|3|lite|full|ultra|micro|off|config> — terse output",
		run,
		complete,
	};
}
