/**
 * Pure / side-effect-free helpers extracted from index.ts so they can be
 * unit-tested without spawning real sudo or loading the Pi extension host.
 */

import { spawn } from "node:child_process";

export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_OUTPUT_LINES = 2000;

// ── Output truncation ────────────────────────────────────────────────────────

export function truncate(
	text: string,
	maxLines = MAX_OUTPUT_LINES,
	maxBytes = MAX_OUTPUT_BYTES,
): { text: string; truncated: boolean } {
	const lines = text.split("\n");
	const byteLen = Buffer.byteLength(text, "utf8");

	if (lines.length <= maxLines && byteLen <= maxBytes) {
		return { text, truncated: false };
	}

	const kept = lines.slice(0, maxLines);
	let result = kept.join("\n");
	if (Buffer.byteLength(result, "utf8") > maxBytes) {
		result = Buffer.from(result, "utf8").slice(0, maxBytes).toString("utf8");
	}
	return { text: result, truncated: true };
}

// ── sudo stderr filter ───────────────────────────────────────────────────────

/** Strip the "[sudo] password for …:" prompt lines that sudo writes to stderr. */
export function filterSudoPrompt(raw: string): string {
	return raw
		.split("\n")
		.filter((l) => !/^\[sudo\] password/i.test(l))
		.join("\n");
}

// ── Auth-failure detection ───────────────────────────────────────────────────

export function detectAuthFailure(code: number, stderr: string): boolean {
	if (code === 0) return false;
	const lower = stderr.toLowerCase();
	return (
		lower.includes("incorrect password") ||
		lower.includes("authentication failure") ||
		lower.includes("sorry,") ||
		stderr.includes("3 incorrect password attempts")
	);
}

// ── sudo runner ──────────────────────────────────────────────────────────────

export interface SudoResult {
	stdout: string;
	stderr: string;
	code: number;
}

/**
 * True when sudo has a valid cached PAM ticket — `sudo -n true` exits 0
 * without prompting. Lets the caller skip the password stage on repeat calls
 * within the system sudoers timeout (default ~15 min).
 */
export function hasValidTicket(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("sudo", ["-n", "true"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.on("error", () => resolve(false));
		proc.on("close", (code) => resolve(code === 0));
	});
}

/**
 * Run `command` via `sudo -S -- sh -c <command>`, piping `password` to stdin.
 * Drops `-k` so sudo's PAM timestamp cache persists across calls — a valid
 * ticket means an empty `password` still succeeds without a prompt. Returns
 * stdout, stderr (prompt lines stripped), and exit code.
 */
export function runWithSudo(
	command: string,
	password: string,
	signal?: AbortSignal,
): Promise<SudoResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn("sudo", ["-S", "--", "sh", "-c", command], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			const filtered = filterSudoPrompt(chunk.toString());
			if (filtered) stderr += filtered;
		});

		proc.on("error", reject);
		proc.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 1 });
		});

		proc.stdin.write(`${password}\n`);
		proc.stdin.end();

		if (signal) {
			signal.addEventListener("abort", () => {
				proc.kill("SIGTERM");
				reject(new Error("Cancelled"));
			});
		}
	});
}
