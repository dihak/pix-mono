import { describe, expect, it } from "bun:test";
import {
	buildHelp,
	buildPrompt,
	DEFAULT_CONFIG,
	LEVEL_NUMBERS,
	LEVELS,
	type Level,
	parseConfig,
	resolveLevel,
	STATUS_LABELS,
	STOP_ALIASES,
	toggleLevel,
} from "./caveman.ts";

// ── LEVELS ────────────────────────────────────────────────────────────────────

describe("LEVELS", () => {
	it("contains off as first entry", () => {
		expect(LEVELS[0]).toBe("off");
	});

	it("contains all expected levels", () => {
		const expected: Level[] = ["off", "lite", "full", "ultra", "micro"];
		for (const l of expected) expect(LEVELS).toContain(l);
	});
});

// ── STOP_ALIASES ──────────────────────────────────────────────────────────────

describe("STOP_ALIASES", () => {
	it("includes off, stop, quit", () => {
		expect(STOP_ALIASES.has("off")).toBe(true);
		expect(STOP_ALIASES.has("stop")).toBe(true);
		expect(STOP_ALIASES.has("quit")).toBe(true);
	});

	it("does not include active levels", () => {
		expect(STOP_ALIASES.has("full")).toBe(false);
		expect(STOP_ALIASES.has("ultra")).toBe(false);
	});
});

// ── STATUS_LABELS ─────────────────────────────────────────────────────────────

describe("STATUS_LABELS", () => {
	it("has a label for every non-off level", () => {
		const nonOff = LEVELS.filter((l) => l !== "off") as Exclude<Level, "off">[];
		for (const l of nonOff) {
			expect(STATUS_LABELS[l]).toBeTruthy();
		}
	});

	it("latin levels are uppercase", () => {
		expect(STATUS_LABELS.lite).toBe("LITE");
		expect(STATUS_LABELS.full).toBe("FULL");
		expect(STATUS_LABELS.ultra).toBe("ULTRA");
		expect(STATUS_LABELS.micro).toBe("MICRO");
	});
});

// ── resolveLevel ──────────────────────────────────────────────────────────────

describe("resolveLevel", () => {
	it("resolves valid levels", () => {
		expect(resolveLevel("lite")).toBe("lite");
		expect(resolveLevel("full")).toBe("full");
		expect(resolveLevel("ultra")).toBe("ultra");
		expect(resolveLevel("micro")).toBe("micro");
		expect(resolveLevel("off")).toBe("off");
	});

	it("maps stop aliases to off", () => {
		expect(resolveLevel("stop")).toBe("off");
		expect(resolveLevel("quit")).toBe("off");
	});

	it("is case-insensitive", () => {
		expect(resolveLevel("FULL")).toBe("full");
		expect(resolveLevel("Ultra")).toBe("ultra");
		expect(resolveLevel("STOP")).toBe("off");
	});

	it("trims whitespace", () => {
		expect(resolveLevel("  full  ")).toBe("full");
	});

	it("returns null for unknown input", () => {
		expect(resolveLevel("unknown")).toBeNull();
		expect(resolveLevel("")).toBeNull();
		expect(resolveLevel("config")).toBeNull(); // config handled separately
	});
});

// ── numeric levels ────────────────────────────────────────────────────────────

describe("numeric levels", () => {
	it("maps 1/2/3 to lite/full/ultra", () => {
		expect(resolveLevel("1")).toBe("lite");
		expect(resolveLevel("2")).toBe("full");
		expect(resolveLevel("3")).toBe("ultra");
	});

	it("maps 0 to off", () => {
		expect(resolveLevel("0")).toBe("off");
	});

	it("LEVEL_NUMBERS only covers 1-3", () => {
		expect(Object.keys(LEVEL_NUMBERS).sort()).toEqual(["1", "2", "3"]);
	});

	it("rejects out-of-range numbers", () => {
		expect(resolveLevel("4")).toBeNull();
		expect(resolveLevel("9")).toBeNull();
	});

	it("trims whitespace around numbers", () => {
		expect(resolveLevel("  2  ")).toBe("full");
	});
});

// ── buildHelp ─────────────────────────────────────────────────────────────────

describe("buildHelp", () => {
	it("lists numeric shortcuts", () => {
		const help = buildHelp("off");
		expect(help).toContain("1");
		expect(help).toContain("lite");
		expect(help).toContain("2");
		expect(help).toContain("full");
		expect(help).toContain("3");
		expect(help).toContain("ultra");
	});

	it("shows current level when active", () => {
		expect(buildHelp("ultra")).toContain("ULTRA");
	});

	it("shows off when disabled", () => {
		expect(buildHelp("off")).toContain("off");
	});

	it("mentions config", () => {
		expect(buildHelp("off")).toContain("config");
	});

	it("does not mention wenyan", () => {
		expect(buildHelp("off").toLowerCase()).not.toContain("wenyan");
	});
});

// ── toggleLevel ───────────────────────────────────────────────────────────────

describe("toggleLevel", () => {
	it("off → full", () => {
		expect(toggleLevel("off")).toBe("full");
	});

	it("full → off", () => {
		expect(toggleLevel("full")).toBe("off");
	});

	it("any non-off level → off", () => {
		const nonOff = LEVELS.filter((l) => l !== "off") as Level[];
		for (const l of nonOff) {
			expect(toggleLevel(l)).toBe("off");
		}
	});
});

// ── buildPrompt ───────────────────────────────────────────────────────────────

describe("buildPrompt", () => {
	it("returns empty string for off", () => {
		expect(buildPrompt("off")).toBe("");
	});

	it("returns MICRO_PROMPT for micro (no BASE)", () => {
		const p = buildPrompt("micro");
		expect(p).toContain("Token efficiency");
		expect(p).not.toContain("CAVEMAN MODE");
	});

	it("includes BASE for all standard levels", () => {
		const standard = ["lite", "full", "ultra"] as Level[];
		for (const l of standard) {
			expect(buildPrompt(l)).toContain("CAVEMAN MODE");
		}
	});

	it("includes SAFETY clause for all standard levels", () => {
		const standard = ["lite", "full", "ultra"] as Level[];
		for (const l of standard) {
			expect(buildPrompt(l)).toContain("Auto-clarity");
		}
	});

	it("each level has distinct intensity instructions", () => {
		const lite = buildPrompt("lite");
		const ultra = buildPrompt("ultra");
		expect(lite).toContain("Keep articles");
		expect(ultra).toContain("Abbreviate");
		expect(lite).not.toContain("Abbreviate");
	});
});

// ── parseConfig ───────────────────────────────────────────────────────────────

describe("parseConfig", () => {
	it("parses valid config", () => {
		const cfg = parseConfig({ defaultLevel: "ultra", showStatus: false });
		expect(cfg.defaultLevel).toBe("ultra");
		expect(cfg.showStatus).toBe(false);
	});

	it("falls back to defaults for invalid defaultLevel", () => {
		const cfg = parseConfig({ defaultLevel: "invalid", showStatus: true });
		expect(cfg.defaultLevel).toBe(DEFAULT_CONFIG.defaultLevel);
	});

	it("falls back to defaults for missing fields", () => {
		const cfg = parseConfig({});
		expect(cfg.defaultLevel).toBe(DEFAULT_CONFIG.defaultLevel);
		expect(cfg.showStatus).toBe(DEFAULT_CONFIG.showStatus);
	});

	it("falls back to defaults for null/undefined", () => {
		const cfg = parseConfig(null);
		expect(cfg.defaultLevel).toBe(DEFAULT_CONFIG.defaultLevel);
		expect(cfg.showStatus).toBe(DEFAULT_CONFIG.showStatus);
	});

	it("accepts all valid levels as defaultLevel", () => {
		for (const l of LEVELS) {
			expect(
				parseConfig({ defaultLevel: l, showStatus: true }).defaultLevel,
			).toBe(l);
		}
	});
});
