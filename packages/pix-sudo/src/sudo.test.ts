import { describe, expect, test } from "bun:test";
import {
	detectAuthFailure,
	filterSudoPrompt,
	MAX_OUTPUT_BYTES,
	MAX_OUTPUT_LINES,
	truncate,
} from "./lib.ts";

// ── truncate ─────────────────────────────────────────────────────────────────

describe("truncate", () => {
	test("short text passes through unchanged", () => {
		const result = truncate("hello\nworld");
		expect(result).toEqual({ text: "hello\nworld", truncated: false });
	});

	test("exact-limit line count is not truncated", () => {
		const text = Array.from(
			{ length: MAX_OUTPUT_LINES },
			(_, i) => `line ${i}`,
		).join("\n");
		const result = truncate(text);
		expect(result.truncated).toBe(false);
	});

	test("one-over line limit truncates", () => {
		const text = Array.from(
			{ length: MAX_OUTPUT_LINES + 1 },
			(_, i) => `line ${i}`,
		).join("\n");
		const result = truncate(text);
		expect(result.truncated).toBe(true);
		expect(result.text.split("\n")).toHaveLength(MAX_OUTPUT_LINES);
	});

	test("byte limit truncates independently of line count", () => {
		// 4 lines, each 20 KB — well over 50 KB total but only 4 lines
		const bigLine = "x".repeat(20 * 1024);
		const text = [bigLine, bigLine, bigLine, bigLine].join("\n");
		const result = truncate(text);
		expect(result.truncated).toBe(true);
		expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
			MAX_OUTPUT_BYTES,
		);
	});

	test("custom maxLines override", () => {
		const text = "a\nb\nc\nd\ne";
		const result = truncate(text, 3, MAX_OUTPUT_BYTES);
		expect(result.truncated).toBe(true);
		expect(result.text).toBe("a\nb\nc");
	});

	test("custom maxBytes override", () => {
		const text = "abcde";
		const result = truncate(text, MAX_OUTPUT_LINES, 3);
		expect(result.truncated).toBe(true);
		expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(3);
	});

	test("empty string passes through", () => {
		expect(truncate("")).toEqual({ text: "", truncated: false });
	});

	test("single long line truncated by bytes keeps valid utf8", () => {
		// Mix of ASCII and multi-byte chars
		const text = "café ".repeat(5000);
		const result = truncate(text, MAX_OUTPUT_LINES, 100);
		expect(result.truncated).toBe(true);
		// Should not throw — valid UTF-8 string
		expect(() => Buffer.from(result.text, "utf8")).not.toThrow();
	});
});

// ── filterSudoPrompt ─────────────────────────────────────────────────────────

describe("filterSudoPrompt", () => {
	test("strips standard sudo password prompt line", () => {
		const raw = "[sudo] password for alice:\ncommand output here";
		expect(filterSudoPrompt(raw)).not.toContain("[sudo] password");
		expect(filterSudoPrompt(raw)).toContain("command output here");
	});

	test("strips prompt with different username", () => {
		const raw = "[sudo] password for root:\nsome error";
		expect(filterSudoPrompt(raw)).not.toContain("[sudo]");
	});

	test("case-insensitive match", () => {
		const raw = "[SUDO] Password for bob:\nok";
		expect(filterSudoPrompt(raw)).not.toContain("[SUDO]");
	});

	test("preserves non-prompt stderr lines", () => {
		const raw =
			"real error: file not found\n[sudo] password for x:\nanother line";
		const out = filterSudoPrompt(raw);
		expect(out).toContain("real error: file not found");
		expect(out).toContain("another line");
		expect(out).not.toContain("[sudo] password");
	});

	test("empty string returns empty string", () => {
		expect(filterSudoPrompt("")).toBe("");
	});

	test("no prompt lines unchanged", () => {
		const raw = "stdout line\nstderr line";
		expect(filterSudoPrompt(raw)).toBe(raw);
	});
});

// ── detectAuthFailure ────────────────────────────────────────────────────────

describe("detectAuthFailure", () => {
	test("code 0 is never an auth failure", () => {
		expect(detectAuthFailure(0, "incorrect password")).toBe(false);
		expect(detectAuthFailure(0, "authentication failure")).toBe(false);
		expect(detectAuthFailure(0, "sorry, try again")).toBe(false);
	});

	test("detects 'incorrect password' in stderr", () => {
		expect(detectAuthFailure(1, "sudo: incorrect password")).toBe(true);
	});

	test("detects 'authentication failure' in stderr", () => {
		expect(detectAuthFailure(1, "pam: authentication failure")).toBe(true);
	});

	test("detects 'sorry,' in stderr (sudo try-again message)", () => {
		expect(detectAuthFailure(1, "Sorry, try again.")).toBe(true);
	});

	test("detects '3 incorrect password attempts'", () => {
		expect(detectAuthFailure(1, "sudo: 3 incorrect password attempts")).toBe(
			true,
		);
	});

	test("non-zero exit with unrelated stderr is not auth failure", () => {
		expect(detectAuthFailure(1, "No such file or directory")).toBe(false);
		expect(detectAuthFailure(127, "command not found")).toBe(false);
	});

	test("case-insensitive for 'incorrect password'", () => {
		expect(detectAuthFailure(1, "Incorrect Password")).toBe(true);
	});

	test("case-insensitive for 'authentication failure'", () => {
		expect(detectAuthFailure(1, "Authentication Failure")).toBe(true);
	});

	test("empty stderr with non-zero code is not auth failure", () => {
		expect(detectAuthFailure(1, "")).toBe(false);
	});
});

// ── execute integration (mock host) ──────────────────────────────────────────
//
// Tests the full execute() path with a fake ExtensionAPI + fake UI.
// No real sudo is spawned — runWithSudo is never reached unless the overlay
// resolves with choice="allow" + a non-blank password.
//
// UI shape after single-overlay refactor:
//   ctx.ui.custom()  — one overlay covering both confirm + password stages
//                      returns { choice, password? }
//   ctx.ui.notify()  — fire-and-forget (swallowed in mock)

import registerSudo from "./index.ts";

// Minimal theme stub: returns text unchanged so assertions match plain strings.
const stubTheme = {
	fg: (_color: string, t: string) => t,
	bold: (t: string) => t,
	bg: (_color: string, t: string) => t,
};

const stubTui = { requestRender: () => {} };

interface OverlayResult {
	choice: "allow" | "deny" | "timeout";
	password?: string;
}

type CustomCb<T> = (
	tui: typeof stubTui,
	theme: typeof stubTheme,
	kb: undefined,
	done: (v: T) => void,
) => {
	render: (w: number) => string[];
	invalidate: () => void;
	handleInput: (d: string) => void;
};

type ExecuteFn = (
	id: string,
	params: { command: string; reason?: string },
	signal: AbortSignal | undefined,
	onUpdate: undefined,
	ctx: {
		hasUI: boolean;
		ui: {
			custom: <T>(
				cb: CustomCb<T>,
				opts?: { overlay?: boolean },
			) => Promise<T | undefined>;
			notify: (msg: string, level: string) => void;
			theme: typeof stubTheme;
		};
	},
) => Promise<{
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}>;

function makeHost() {
	let capturedExecute: ExecuteFn | null = null;
	const pi = {
		registerTool(def: { name: string; execute: ExecuteFn }) {
			capturedExecute = def.execute;
		},
	} as never;
	registerSudo(pi);
	return {
		get execute(): ExecuteFn {
			if (!capturedExecute) throw new Error("tool not registered");
			return capturedExecute;
		},
	};
}

/**
 * overlayResult — what ctx.ui.custom() resolves to.
 *   choice="allow" + non-blank password       => runs sudo
 *   choice="deny"                             => cancelled by user
 *   choice="timeout"                          => auto-denied
 *   choice="allow" + blank/missing password   => cancelled
 *
 * onCustom — called with rendered lines after the component renders once.
 */
function makeCtx(
	opts: {
		hasUI?: boolean;
		overlayResult?: OverlayResult;
		onCustom?: (lines: string[]) => void;
	} = {},
) {
	const overlayResult: OverlayResult = opts.overlayResult ?? { choice: "deny" };
	return {
		hasUI: opts.hasUI ?? true,
		ui: {
			custom: async <T>(cb: CustomCb<T>): Promise<T | undefined> => {
				// Invoke the callback so components initialise and render.
				const comp = cb(stubTui, stubTheme, undefined, (_v: T) => {});
				const lines = comp.render(80);
				opts.onCustom?.(lines);
				// Return the preset overlay result.
				return overlayResult as T;
			},
			notify: (_msg: string, _level: string) => {},
			theme: stubTheme,
		},
	};
}

function text(result: { content: Array<{ type: string; text: string }> }) {
	return result.content.map((c) => c.text).join("\n");
}

describe("sudo_run tool execute()", () => {
	test("no UI returns error immediately", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ hasUI: false }),
		);
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("no UI available");
	});

	test("choice=deny => cancelled", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ overlayResult: { choice: "deny" } }),
		);
		expect(text(result)).toContain("Cancelled");
		expect(result.isError).toBeUndefined();
	});

	test("choice=timeout => cancelled", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ overlayResult: { choice: "timeout" } }),
		);
		expect(text(result)).toContain("Cancelled");
		expect(result.isError).toBeUndefined();
	});

	test("choice=allow + blank password => cancelled", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ overlayResult: { choice: "allow", password: "" } }),
		);
		expect(text(result)).toContain("Cancelled");
		expect(result.isError).toBeUndefined();
	});

	test("choice=allow + whitespace password => cancelled", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ overlayResult: { choice: "allow", password: "   " } }),
		);
		expect(text(result)).toContain("Cancelled");
	});

	test("choice=allow + undefined password => cancelled", async () => {
		const host = makeHost();
		const result = await host.execute(
			"id",
			{ command: "whoami" },
			undefined,
			undefined,
			makeCtx({ overlayResult: { choice: "allow", password: undefined } }),
		);
		expect(text(result)).toContain("Cancelled");
		expect(result.isError).toBeUndefined();
	});

	test("overlay renders the command", async () => {
		const host = makeHost();
		const rendered: string[] = [];
		await host.execute(
			"id",
			{ command: "rm -rf /tmp/test" },
			undefined,
			undefined,
			makeCtx({
				overlayResult: { choice: "deny" },
				onCustom: (lines) => rendered.push(...lines),
			}),
		);
		expect(rendered.join("\n")).toContain("rm -rf /tmp/test");
	});

	test("overlay renders the reason when provided", async () => {
		const host = makeHost();
		const rendered: string[] = [];
		await host.execute(
			"id",
			{
				command: "chmod 755 /usr/local/bin/foo",
				reason: "Make binary executable",
			},
			undefined,
			undefined,
			makeCtx({
				overlayResult: { choice: "deny" },
				onCustom: (lines) => rendered.push(...lines),
			}),
		);
		expect(rendered.join("\n")).toContain("Make binary executable");
	});

	test("overlay shows fallback when no reason provided", async () => {
		const host = makeHost();
		const rendered: string[] = [];
		await host.execute(
			"id",
			{ command: "id" },
			undefined,
			undefined,
			makeCtx({
				overlayResult: { choice: "deny" },
				onCustom: (lines) => rendered.push(...lines),
			}),
		);
		expect(rendered.join("\n")).toContain("No reason provided");
	});
});
