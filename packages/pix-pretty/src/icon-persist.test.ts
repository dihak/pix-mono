import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reloadPixConfig } from "@dihak/pix-data/pix-config";
import { getIconMode, setIconMode } from "./icon-catalog.ts";
import { initIconMode, loadIconMode, saveIconMode } from "./icon-persist.ts";

let tmpAgentDir: string;
let origHome: string | undefined;

beforeAll(() => {
	tmpAgentDir = mkdtempSync(join(tmpdir(), "pretty-persist-test-"));
	origHome = process.env.HOME;
	// Point HOME at the temp dir so pixConfig() reads from there, not the real ~/.pi/agent/pix.json
	process.env.HOME = tmpAgentDir;
	process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
	// Force pix-config to re-read from the temp HOME (clears cached real config).
	reloadPixConfig();
});

afterAll(() => {
	process.env.HOME = origHome;
	delete process.env.PI_CODING_AGENT_DIR;
	try {
		rmSync(tmpAgentDir, { recursive: true });
	} catch {
		// already gone — ignore
	}
});

describe("icon-persist", () => {
	afterEach(() => setIconMode("nerd"));

	it("returns default (nerd) in a fresh config", () => {
		expect(loadIconMode()).toBe("nerd");
	});

	it("round-trips a mode across save/load (new-session sim)", () => {
		saveIconMode("unicode");
		expect(loadIconMode()).toBe("unicode");
	});

	it("rejects an invalid persisted mode", () => {
		saveIconMode("ascii");
		expect(loadIconMode()).toBe("ascii");
	});

	it("initIconMode applies the persisted choice to the catalog", () => {
		saveIconMode("ascii");
		setIconMode("nerd"); // pretend env default
		initIconMode();
		expect(getIconMode()).toBe("ascii");
	});
});
