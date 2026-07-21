/**
 * persist.ts — disk-backed persistence for the /optimizer tool states.
 *
 * caveman/ponytail previously saved only to the session log (lost on a fresh
 * session); rtk/toon never persisted at all. This stores every tool's current
 * value in one file under the agent dir so the picker survives a full quit and
 * restart. Each tool reads its value on session_start and writes on run().
 *
 *   ~/.pi/agent/optimizer.json  →  { "caveman": "lite", "rtk": "on", ... }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pixConfig } from "@dihak/pix-data/pix-config";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { OptimizerTool } from "./status.ts";

type OptimizerFileConfig = Partial<Record<OptimizerTool, string>>;

function getStatePath(): string {
	return join(getAgentDir(), "optimizer.json");
}

function readFile(): OptimizerFileConfig {
	try {
		const sp = getStatePath();
		if (!existsSync(sp)) return {};
		const raw = JSON.parse(readFileSync(sp, "utf-8")) as OptimizerFileConfig;
		return raw && typeof raw === "object" ? raw : {};
	} catch {
		return {};
	}
}

/**
 * Read a single tool's persisted value.
 * Precedence: optimizer.json (runtime toggle) → pix.json → undefined
 */
export function loadOptValue(tool: OptimizerTool): string | undefined {
	const fromFile = readFile()[tool];
	if (fromFile !== undefined) return fromFile;
	// Fall back to pix.json
	const pix = pixConfig().optimizer;
	const val = pix[tool as keyof typeof pix];
	return val && val !== "off" ? val : undefined;
}

/** Persist a single tool's value, merging into the shared config file. */
export function saveOptValue(tool: OptimizerTool, value: string): void {
	try {
		const sp = getStatePath();
		mkdirSync(dirname(sp), { recursive: true });
		const next = { ...readFile(), [tool]: value };
		writeFileSync(sp, JSON.stringify(next, null, 2), "utf-8");
	} catch (err) {
		console.warn(`optimizer: persist ${tool} failed:`, err);
	}
}
