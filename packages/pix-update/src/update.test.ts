import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	commandFor,
	currentVersion,
	detectInstallMethod,
	formatUpdateSummary,
	type InstallMethod,
	isTransient,
	PACKAGE_NAME,
	PIX_INSTALL_COMMAND,
	PIX_INSTALL_URL,
	PIX_UNINSTALL_URL,
	resolveCommand,
	runWithRetry,
	SPINNER,
	withSpinner,
} from "./update.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

type ExecResult = { stdout: string; stderr: string; code: number };

/** Build a minimal ExtensionAPI stub with a controllable exec implementation. */
function makePi(execImpl: (...args: unknown[]) => Promise<ExecResult>) {
	return { exec: execImpl } as unknown as ExtensionAPI;
}

/** Exec stub: returns a fixed path for `command -v <cmd>`, empty for others. */
function makePathPi(paths: Partial<Record<string, string>>) {
	return makePi(async (_cmd: unknown, args: unknown) => {
		const argv = args as string[];
		// `command -v <name> || true` → single shell arg in args[1]
		const match = (argv[1] ?? "").match(/command -v (\S+)/);
		if (match) {
			const found = paths[match[1] ?? ""];
			return { stdout: found ?? "", stderr: "", code: 0 };
		}
		// realpath call
		if ((argv[1] ?? "").startsWith("realpath")) {
			const piPath = paths.pi ?? "";
			return { stdout: piPath, stderr: "", code: 0 };
		}
		// npm-walk check (exits 0 = npm detected, exits 1 = not)
		if ((argv[1] ?? "").startsWith("p=")) {
			const piPath = paths.pi ?? "";
			const isNpm = piPath.includes("/npm-global/");
			return { stdout: "", stderr: "", code: isNpm ? 0 : 1 };
		}
		return { stdout: "", stderr: "", code: 0 };
	});
}

// ─── isTransient ─────────────────────────────────────────────────────────────

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

// ─── commandFor ──────────────────────────────────────────────────────────────

describe("commandFor", () => {
	it("returns a spec for every non-native method", () => {
		const methods: InstallMethod[] = ["vp", "bun", "npm", "brew"];
		for (const m of methods) {
			const spec = commandFor(m);
			expect(spec).toBeDefined();
			expect(spec?.command).toBeTruthy();
			expect(spec?.label).toBeTruthy();
		}
	});

	it("vp: command=vp, includes package@latest", () => {
		const spec = commandFor("vp");
		if (!spec) throw new Error("commandFor returned undefined");
		expect(spec.command).toBe("vp");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("bun: command=bun, includes package@latest", () => {
		const spec = commandFor("bun");
		if (!spec) throw new Error("commandFor returned undefined");
		expect(spec.command).toBe("bun");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("npm: command=npm, -g flag, includes package@latest", () => {
		const spec = commandFor("npm");
		if (!spec) throw new Error("commandFor returned undefined");
		expect(spec.command).toBe("npm");
		expect(spec.args).toContain("-g");
		expect(spec.args).toContain(`${PACKAGE_NAME}@latest`);
	});

	it("brew: delegates to sh -lc with brew upgrade", () => {
		const spec = commandFor("brew");
		if (!spec) throw new Error("commandFor returned undefined");
		expect(spec.command).toBe("/bin/sh");
		expect(spec.label).toContain("brew upgrade");
	});

	it("native: returns undefined (manual update required)", () => {
		expect(commandFor("native")).toBeUndefined();
	});
});

// ─── formatUpdateSummary ──────────────────────────────────────────────────────

describe("formatUpdateSummary", () => {
	it("shows upgrade arrow when version changed", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 1);
		expect(msg).toContain("0.75.0 → 0.76.0");
	});

	it("shows up-to-date when version unchanged", () => {
		const msg = formatUpdateSummary("0.76.0", "0.76.0", 1);
		expect(msg).toContain("up to date");
		expect(msg).toContain("0.76.0");
	});

	it("appends retry count when attempts > 1", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 3);
		expect(msg).toContain("Retried 2 transient failure");
	});

	it("no retry mention when attempts = 1", () => {
		const msg = formatUpdateSummary("0.75.0", "0.76.0", 1);
		expect(msg).not.toContain("Retried");
	});

	it("treats unknown→unknown as up-to-date (no arrow)", () => {
		const msg = formatUpdateSummary("unknown", "unknown", 1);
		expect(msg).not.toContain("→");
		expect(msg).toContain("up to date");
	});

	it("treats known→unknown as up-to-date (no arrow)", () => {
		// After an update the new version read fails; should not show a bad arrow.
		const msg = formatUpdateSummary("0.75.0", "unknown", 1);
		expect(msg).not.toContain("→");
	});
});

// ─── constants ───────────────────────────────────────────────────────────────

describe("withSpinner", () => {
	type StatusCall = [string, string | undefined];
	it("sets a spinner line then clears it, even when work throws", async () => {
		const calls: Array<StatusCall> = [];
		const ui = {
			setStatus: (k: string, t: string | undefined) => calls.push([k, t]),
		};
		await expect(
			withSpinner(ui, "k", "Working", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		// first call sets a spinner frame, last call clears the line.
		const c0 = calls[0] as StatusCall;
		expect(c0[0]).toBe("k");
		expect(c0[1]).toContain("Working");
		expect(c0[1]?.[0]).toBe(SPINNER[0] ?? "");
		expect(calls.at(-1)).toEqual(["k", undefined]);
	});
});

describe("constants", () => {
	it("PIX_INSTALL_URL points to pix-mono main branch", () => {
		expect(PIX_INSTALL_URL).toContain("xynogen/pix-mono");
		expect(PIX_INSTALL_URL).toContain("install.sh");
	});

	it("PIX_INSTALL_COMMAND uninstalls then reinstalls via sh", () => {
		expect(PIX_INSTALL_COMMAND).toContain(PIX_UNINSTALL_URL);
		expect(PIX_INSTALL_COMMAND).toContain(PIX_INSTALL_URL);
		// uninstall must run before install
		expect(PIX_INSTALL_COMMAND.indexOf(PIX_UNINSTALL_URL)).toBeLessThan(
			PIX_INSTALL_COMMAND.indexOf(PIX_INSTALL_URL),
		);
		expect(PIX_INSTALL_COMMAND).toContain("&&");
	});
});

// ─── resolveCommand ───────────────────────────────────────────────────────────

describe("resolveCommand", () => {
	it("returns the path when command exists", async () => {
		const pi = makePi(async () => ({
			stdout: "/usr/bin/bun\n",
			stderr: "",
			code: 0,
		}));
		expect(await resolveCommand("bun", pi)).toBe("/usr/bin/bun");
	});

	it("returns undefined when command is absent (empty stdout)", async () => {
		const pi = makePi(async () => ({ stdout: "", stderr: "", code: 0 }));
		expect(await resolveCommand("vp", pi)).toBeUndefined();
	});

	it("returns only the first line when stdout has multiple lines", async () => {
		const pi = makePi(async () => ({
			stdout: "/usr/bin/bun\n/usr/local/bin/bun\n",
			stderr: "",
			code: 0,
		}));
		expect(await resolveCommand("bun", pi)).toBe("/usr/bin/bun");
	});
});

// ─── currentVersion ───────────────────────────────────────────────────────────

describe("currentVersion", () => {
	it("returns trimmed stdout when present", async () => {
		const pi = makePi(async () => ({
			stdout: "0.77.0\n",
			stderr: "",
			code: 0,
		}));
		expect(await currentVersion(pi)).toBe("0.77.0");
	});

	it("falls back to stderr when stdout is empty", async () => {
		const pi = makePi(async () => ({
			stdout: "",
			stderr: "0.77.0",
			code: 0,
		}));
		expect(await currentVersion(pi)).toBe("0.77.0");
	});

	it("returns 'unknown' when both streams are empty", async () => {
		const pi = makePi(async () => ({ stdout: "", stderr: "", code: 0 }));
		expect(await currentVersion(pi)).toBe("unknown");
	});
});

// ─── detectInstallMethod ─────────────────────────────────────────────────────

describe("detectInstallMethod", () => {
	it("detects vp from pi path containing /.vite-plus/", async () => {
		const pi = makePathPi({ pi: "/home/user/.vite-plus/bin/pi" });
		expect(await detectInstallMethod(pi)).toBe("vp");
	});

	it("detects bun from pi path containing /.bun/", async () => {
		const pi = makePathPi({ pi: "/home/user/.bun/bin/pi" });
		expect(await detectInstallMethod(pi)).toBe("bun");
	});

	it("detects brew from pi path containing /Homebrew/", async () => {
		const pi = makePathPi({ pi: "/opt/Homebrew/bin/pi" });
		expect(await detectInstallMethod(pi)).toBe("brew");
	});

	it("detects brew (lowercase homebrew path)", async () => {
		const pi = makePathPi({ pi: "/usr/local/homebrew/bin/pi" });
		expect(await detectInstallMethod(pi)).toBe("brew");
	});

	it("falls back to vp when pi path is unrecognised but vp is on PATH", async () => {
		const pi = makePathPi({ pi: "/usr/local/bin/pi", vp: "/usr/local/bin/vp" });
		// npm-walk exits 1 (no node_modules found for unrecognised path)
		expect(await detectInstallMethod(pi)).toBe("vp");
	});

	it("falls back to bun when pi path is unrecognised and bun is on PATH", async () => {
		const pi = makePathPi({
			pi: "/usr/local/bin/pi",
			bun: "/home/user/.bun/bin/bun",
		});
		expect(await detectInstallMethod(pi)).toBe("bun");
	});

	it("falls back to npm when pi path is unrecognised and npm is on PATH", async () => {
		const pi = makePathPi({
			pi: "/usr/local/bin/pi",
			npm: "/usr/bin/npm",
		});
		expect(await detectInstallMethod(pi)).toBe("npm");
	});

	it("falls back to brew when only brew is on PATH", async () => {
		const pi = makePathPi({
			pi: "/usr/local/bin/pi",
			brew: "/usr/local/bin/brew",
		});
		expect(await detectInstallMethod(pi)).toBe("brew");
	});

	it("returns native when pi not found and no package manager on PATH", async () => {
		const pi = makePathPi({});
		expect(await detectInstallMethod(pi)).toBe("native");
	});

	it("issues parallel exec calls for path probes (perf guard)", async () => {
		// All 5 probes (pi, vp, bun, npm, brew) + optional realpath + npm-walk
		// should be fired without blocking each other. Verify by tracking
		// in-flight count: if sequential, max concurrent is always 1.
		let inflight = 0;
		let maxInflight = 0;
		const pi = makePi(async (_cmd, args) => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await new Promise((r) => setTimeout(r, 5));
			inflight--;
			const argv = args as string[];
			// Return empty for all probes (→ native path)
			const isNpmWalk = (argv[1] ?? "").startsWith("p=");
			return { stdout: "", stderr: "", code: isNpmWalk ? 1 : 0 };
		});
		await detectInstallMethod(pi);
		// At least the 5 parallel probes must have overlapped.
		expect(maxInflight).toBeGreaterThanOrEqual(5);
	});
});

// ─── runWithRetry ─────────────────────────────────────────────────────────────

describe("runWithRetry", () => {
	const spec = {
		command: "bun",
		args: ["add", "-g", "pkg@latest"],
		label: "bun add -g pkg@latest",
	};

	it("returns ok=true on first success", async () => {
		const pi = makePi(async () => ({
			stdout: "Successfully installed",
			stderr: "",
			code: 0,
		}));
		const result = await runWithRetry(pi, spec);
		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(1);
		expect(result.output).toContain("Successfully installed");
	});

	it("retries on transient errors and succeeds on second attempt", async () => {
		let calls = 0;
		const pi = makePi(async () => {
			calls++;
			if (calls < 2) return { stdout: "", stderr: "ETIMEDOUT", code: 1 };
			return { stdout: "ok", stderr: "", code: 0 };
		});
		const result = await runWithRetry(pi, spec);
		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(2);
	});

	it("stops immediately on permanent (non-transient) error", async () => {
		let calls = 0;
		const pi = makePi(async () => {
			calls++;
			return { stdout: "", stderr: "permission denied", code: 1 };
		});
		const result = await runWithRetry(pi, spec);
		expect(result.ok).toBe(false);
		expect(result.attempts).toBe(1);
		expect(calls).toBe(1);
	});

	it("gives up after 3 transient failures", async () => {
		const pi = makePi(async () => ({
			stdout: "",
			stderr: "ETIMEDOUT",
			code: 1,
		}));
		const result = await runWithRetry(pi, spec);
		expect(result.ok).toBe(false);
		expect(result.attempts).toBe(3);
	});

	it("concatenates stdout + stderr into output", async () => {
		const pi = makePi(async () => ({
			stdout: "out line",
			stderr: "err line",
			code: 0,
		}));
		const result = await runWithRetry(pi, spec);
		expect(result.output).toContain("out line");
		expect(result.output).toContain("err line");
	});

	it("omits empty streams from output", async () => {
		const pi = makePi(async () => ({
			stdout: "only stdout",
			stderr: "",
			code: 0,
		}));
		const result = await runWithRetry(pi, spec);
		expect(result.output).toBe("only stdout");
	});

	it("treats code=undefined as success (0)", async () => {
		const pi = makePi(async () => ({
			stdout: "done",
			stderr: "",
			code: undefined as unknown as number,
		}));
		const result = await runWithRetry(pi, spec);
		expect(result.ok).toBe(true);
	});
});
