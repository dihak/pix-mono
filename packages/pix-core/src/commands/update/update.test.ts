import { describe, expect, it } from "bun:test";
import {
	commandFor,
	formatUpdateSummary,
	type InstallMethod,
	isTransient,
	PACKAGE_NAME,
} from "./update.ts";

describe("isTransient", () => {
	it("matches network errors", () => {
		expect(isTransient("ETIMEDOUT")).toBe(true);
		expect(isTransient("ECONNRESET")).toBe(true);
		expect(isTransient("ECONNREFUSED")).toBe(true);
		expect(isTransient("socket hang up")).toBe(true);
		expect(isTransient("network error occurred")).toBe(true);
	});

	it("matches HTTP status codes", () => {
		expect(isTransient("Error 429: Too many requests")).toBe(true);
		expect(isTransient("502 Bad Gateway")).toBe(true);
		expect(isTransient("503 Service Unavailable")).toBe(true);
		expect(isTransient("504 Gateway Timeout")).toBe(true);
	});

	it("matches timeout/temporary", () => {
		expect(isTransient("Request timeout after 30s")).toBe(true);
		expect(isTransient("temporary failure")).toBe(true);
		expect(isTransient("EAI_AGAIN")).toBe(true);
	});

	it("returns false for permanent errors", () => {
		expect(isTransient("permission denied")).toBe(false);
		expect(isTransient("command not found")).toBe(false);
		expect(isTransient("syntax error")).toBe(false);
		expect(isTransient("")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(isTransient("NETWORK FAILURE")).toBe(true);
		expect(isTransient("Timeout after 30s")).toBe(true);
	});
});

describe("commandFor", () => {
	it("returns correct command for each method", () => {
		const methods: InstallMethod[] = ["vp", "bun", "npm", "brew"];
		for (const m of methods) {
			const spec = commandFor(m);
			expect(spec).toBeDefined();
			expect(spec?.command).toBeTruthy();
			expect(spec?.label).toBeTruthy();
		}
	});

	it("vp uses vp add -g", () => {
		const spec = commandFor("vp")!;
		expect(spec.command).toBe("vp");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("bun uses bun add -g", () => {
		const spec = commandFor("bun")!;
		expect(spec.command).toBe("bun");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("npm uses npm install -g", () => {
		const spec = commandFor("npm")!;
		expect(spec.command).toBe("npm");
		expect(spec.args).toContain("-g");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("brew uses sh -lc", () => {
		const spec = commandFor("brew")!;
		expect(spec.command).toBe("/bin/sh");
		expect(spec.label).toContain("brew upgrade");
	});

	it("native returns undefined", () => {
		expect(commandFor("native")).toBeUndefined();
	});
});

describe("formatUpdateSummary", () => {
	it("shows updated message when version changed", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 1);
		expect(msg).toContain("0.75.0 → 0.76.0");
	});

	it("shows up-to-date when version unchanged", () => {
		const msg = formatUpdateSummary("0.76.0", "0.76.0", 1);
		expect(msg).toContain("up to date");
		expect(msg).toContain("0.76.0");
	});

	it("shows retry count when attempts > 1", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 3);
		expect(msg).toContain("Retried 2 transient failure");
	});

	it("no retry mention when attempts = 1", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 1);
		expect(msg).not.toContain("Retried");
	});

	it("handles unknown versions gracefully", () => {
		const msg = formatUpdateSummary("unknown", "unknown", 1);
		expect(msg).toContain("up to date");
	});
});
