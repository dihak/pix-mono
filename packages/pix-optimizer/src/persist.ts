/**
 * persist.ts — disk-backed persistence for the /optimizer tool states.
 *
 * caveman/ponytail previously saved only to the session log (lost on a fresh
 * session); rtk/toon never persisted at all. This stores every tool's current
 * value in one file under the agent dir so the picker survives a full quit and
 * restart. Each tool reads its value on session_start and writes on run().
 *
 *   ~/.pi/agent/optimizer.json  →  { "caveman": "lite", "rtk": "on", ... }
 *
 * A reserved "iconMode" key (not a tool) stores the status-cell icon style.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ICON_MODES, type IconMode, type OptimizerTool } from "./status.ts";

/** Reserved (non-tool) key holding the icon presentation mode. */
const ICON_MODE_KEY = "iconMode";

type OptimizerConfig = Partial<Record<OptimizerTool, string>> & {
	[ICON_MODE_KEY]?: string;
};

function getStatePath(): string {
	return join(getAgentDir(), "optimizer.json");
}

function readAll(): OptimizerConfig {
	try {
		const sp = getStatePath();
		if (!existsSync(sp)) return {};
		const raw = JSON.parse(readFileSync(sp, "utf-8")) as OptimizerConfig;
		return raw && typeof raw === "object" ? raw : {};
	} catch {
		// Missing, corrupt, or no getAgentDir (tests/headless) — start clean.
		return {};
	}
}

/** Read a single tool's persisted value, or undefined if none. */
export function loadOptValue(tool: OptimizerTool): string | undefined {
	return readAll()[tool];
}

/** Persist a single tool's value, merging into the shared config file. */
export function saveOptValue(tool: OptimizerTool, value: string): void {
	try {
		const sp = getStatePath();
		mkdirSync(dirname(sp), { recursive: true });
		const next = { ...readAll(), [tool]: value };
		writeFileSync(sp, JSON.stringify(next, null, 2), "utf-8");
	} catch (err) {
		console.warn(`optimizer: persist ${tool} failed:`, err);
	}
}

/** Read the persisted icon mode, or undefined if unset/invalid. */
export function loadIconMode(): IconMode | undefined {
	const raw = readAll()[ICON_MODE_KEY];
	return ICON_MODES.includes(raw as IconMode) ? (raw as IconMode) : undefined;
}

/** Persist the icon mode, merging into the shared config file. */
export function saveIconMode(mode: IconMode): void {
	try {
		const sp = getStatePath();
		mkdirSync(dirname(sp), { recursive: true });
		const next = { ...readAll(), [ICON_MODE_KEY]: mode };
		writeFileSync(sp, JSON.stringify(next, null, 2), "utf-8");
	} catch (err) {
		console.warn("optimizer: persist iconMode failed:", err);
	}
}
