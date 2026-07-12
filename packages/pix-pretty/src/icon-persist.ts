/**
 * icon-persist.ts — disk persistence for the global icon mode.
 *
 * Reads/writes the icon mode via the unified pix.json config
 * (`~/.pi/agent/pix.json` → `pretty.icons`). Kept separate from
 * icon-catalog.ts so the catalog resolver stays pure (no fs) and trivially
 * testable.
 *
 * Precedence: env PRETTY_ICONS → pix.json pretty.icons → default ("nerd")
 */

import { onPixConfigChange, pixConfig, savePixConfig } from "@xynogen/pix-data/pix-config";
import { ICON_MODES, type IconMode, setIconMode } from "./icon-catalog.js";

function isIconMode(m: string): m is IconMode {
	return (ICON_MODES as readonly string[]).includes(m);
}

/** Read the persisted icon mode from pix.json, or undefined if unset/invalid. */
export function loadIconMode(): IconMode | undefined {
	try {
		const mode = pixConfig().pretty.icons;
		if (mode == null) return undefined;
		return isIconMode(mode) ? mode : undefined;
	} catch {
		return undefined;
	}
}

/** Persist the icon mode to pix.json (`pretty.icons`). */
export function saveIconMode(mode: IconMode): void {
	try {
		savePixConfig({ pretty: { icons: mode } });
	} catch (err) {
		console.warn("pix-pretty: persist icon mode failed:", err);
	}
}

/**
 * Apply the persisted mode (if any) to the catalog and subscribe to live
 * changes from the /pix settings command. Called once at extension load.
 *
 * Precedence: env PRETTY_ICONS → pix.json pretty.icons → default ("nerd")
 */
export function initIconMode(): void {
	const pixIcons = pixConfig().pretty.icons;
	if (pixIcons && isIconMode(pixIcons)) setIconMode(pixIcons);

	// Keep the in-memory icon mode in sync when /pix changes pretty.icons.
	onPixConfigChange((cfg) => {
		const mode = cfg.pretty.icons;
		if (mode && isIconMode(mode)) setIconMode(mode);
	});
}
