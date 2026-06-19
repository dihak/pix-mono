import { describe, expect, it } from "bun:test";
import {
	type CheckResult,
	LABEL_WIDTH,
	LOGO_ROWS,
	PI_IGNORE_RULES,
	renderCheck,
	shortCwd,
	statusIcon,
	summariseSkills,
	summariseTools,
	type Theme,
} from "./welcome.ts";

const theme: Theme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

describe("shortCwd", () => {
	it("replaces home prefix with ~", () => {
		expect(shortCwd("/home/user/projects/foo", "/home/user")).toBe(
			"~/projects/foo",
		);
	});

	it("returns path unchanged when not under home", () => {
		expect(shortCwd("/tmp/foo", "/home/user")).toBe("/tmp/foo");
	});

	it("handles exact home match", () => {
		expect(shortCwd("/home/user", "/home/user")).toBe("~");
	});

	it("uses empty string home gracefully", () => {
		expect(shortCwd("/tmp/foo", "")).toBe("/tmp/foo");
	});
});

describe("statusIcon", () => {
	it("returns ○ for pending", () => {
		expect(statusIcon(theme, "pending")).toContain("○");
	});
	it("returns ✓ for ok", () => {
		expect(statusIcon(theme, "ok")).toContain("✓");
	});
	it("returns ⚠ for warn", () => {
		expect(statusIcon(theme, "warn")).toContain("⚠");
	});
	it("returns ✗ for error", () => {
		expect(statusIcon(theme, "error")).toContain("✗");
	});
});

describe("renderCheck", () => {
	it("includes icon, label, and detail", () => {
		const check: CheckResult = { label: "PIx", status: "ok", detail: "0.76.0" };
		const rendered = renderCheck(theme, check);
		expect(rendered).toContain("✓");
		expect(rendered).toContain("PIx");
		expect(rendered).toContain("0.76.0");
	});

	it("pads label to LABEL_WIDTH", () => {
		const check: CheckResult = { label: "PIx", status: "ok", detail: "x" };
		const rendered = renderCheck(theme, check);
		expect(rendered).toContain("PIx".padEnd(LABEL_WIDTH));
	});

	it("renders without detail when absent", () => {
		const check: CheckResult = { label: "Auth", status: "warn" };
		const rendered = renderCheck(theme, check);
		expect(rendered).toContain("⚠");
		expect(rendered).toContain("Auth");
	});
});

describe("LOGO_ROWS", () => {
	it("has 6 rows", () => expect(LOGO_ROWS.length).toBe(6));
	it("starts with empty tag", () => expect(LOGO_ROWS[0][1]).toBe(""));
	it("has heading, model, cwd, ready tags", () => {
		const tags = LOGO_ROWS.map((r) => r[1]);
		expect(tags).toContain("heading");
		expect(tags).toContain("model");
		expect(tags).toContain("cwd");
		expect(tags).toContain("ready");
	});
});

describe("summariseTools", () => {
	it("warns when no tools are active", () => {
		const r = summariseTools([]);
		expect(r.status).toBe("warn");
		expect(r.detail).toBe("none active");
	});

	it("counts builtin-only tools without ext suffix", () => {
		const r = summariseTools([
			{ sourceInfo: { source: "builtin" } },
			{ sourceInfo: { source: "builtin" } },
		]);
		expect(r.status).toBe("ok");
		expect(r.detail).toBe("2 loaded");
	});

	it("breaks out extension tools in the detail", () => {
		const r = summariseTools([
			{ sourceInfo: { source: "builtin" } },
			{ sourceInfo: { source: "my-extension" } },
			{ sourceInfo: { source: "sdk" } },
		]);
		expect(r.detail).toBe("3 loaded (+2 ext)");
	});

	it("treats missing sourceInfo as non-builtin", () => {
		const r = summariseTools([{}, { sourceInfo: {} }]);
		expect(r.detail).toBe("2 loaded (+2 ext)");
	});
});

describe("summariseSkills", () => {
	it("warns when no skills loaded", () => {
		const r = summariseSkills([]);
		expect(r.status).toBe("warn");
		expect(r.detail).toBe("none loaded");
	});

	it("reports count when skills present", () => {
		const r = summariseSkills([{}, {}, {}]);
		expect(r.status).toBe("ok");
		expect(r.detail).toBe("3 loaded");
	});

	it("excludes skills with disableModelInvocation", () => {
		const r = summariseSkills([{}, { disableModelInvocation: true }, {}]);
		expect(r.status).toBe("ok");
		expect(r.detail).toBe("2 loaded");
	});

	it("warns when all skills are disabled", () => {
		const r = summariseSkills([
			{ disableModelInvocation: true },
			{ disableModelInvocation: true },
		]);
		expect(r.status).toBe("warn");
		expect(r.detail).toBe("none loaded");
	});
});

describe("PI_IGNORE_RULES", () => {
	it("includes both rules", () => {
		expect(PI_IGNORE_RULES).toEqual([".pi/", ".pi-lens/"]);
	});
});
