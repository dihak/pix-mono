import { describe, expect, it } from "bun:test";
import {
	applyRtkRewrite,
	type BashCallEvent,
	rewriteChain,
	splitChain,
} from "./rtk.ts";

/** Build a fresh bash tool_call event for hook tests. */
function bashEvent(command: string): BashCallEvent {
	return { toolName: "bash", input: { command } };
}

describe("splitChain", () => {
	it("returns single segment for plain command", () => {
		expect(splitChain("git status")).toEqual(["git status"]);
	});

	it("splits on && keeping operator", () => {
		expect(splitChain("git add . && git push")).toEqual([
			"git add . ",
			"&&",
			" git push",
		]);
	});

	it("splits on ||, ;, |", () => {
		expect(splitChain("a || b")).toEqual(["a ", "||", " b"]);
		expect(splitChain("a ; b")).toEqual(["a ", ";", " b"]);
		expect(splitChain("a | b")).toEqual(["a ", "|", " b"]);
	});

	it("ignores operators inside double quotes", () => {
		expect(splitChain('git commit -m "a && b"')).toEqual([
			'git commit -m "a && b"',
		]);
	});

	it("ignores operators inside single quotes", () => {
		expect(splitChain("echo 'x | y'")).toEqual(["echo 'x | y'"]);
	});

	it("returns null on unbalanced quotes", () => {
		expect(splitChain('git commit -m "oops')).toBeNull();
	});
});

describe("rewriteChain", () => {
	it("prefixes a single known command", () => {
		expect(rewriteChain("git status")).toBe("rtk git status");
	});

	it("prefixes every segment in a chain", () => {
		expect(rewriteChain("git add . && git commit -m x && git push")).toBe(
			"rtk git add . && rtk git commit -m x && rtk git push",
		);
	});

	it("prefixes mixed known commands", () => {
		expect(rewriteChain("cargo build && npm test")).toBe(
			"rtk cargo build && rtk npm test",
		);
	});

	it("leaves unknown commands alone", () => {
		expect(rewriteChain("echo hi && mkdir x")).toBe("echo hi && mkdir x");
	});

	it("only prefixes known segments in a mixed chain", () => {
		expect(rewriteChain("cd /tmp && git status")).toBe(
			"cd /tmp && rtk git status",
		);
	});

	it("does not double-prefix already-rtk commands", () => {
		expect(rewriteChain("rtk git status")).toBe("rtk git status");
		expect(rewriteChain("rtk git add . && git push")).toBe(
			"rtk git add . && rtk git push",
		);
	});

	it("does not touch operators inside quotes", () => {
		expect(rewriteChain('git commit -m "a && b"')).toBe(
			'rtk git commit -m "a && b"',
		);
	});

	it("returns original on unbalanced quotes", () => {
		const cmd = 'git commit -m "oops';
		expect(rewriteChain(cmd)).toBe(cmd);
	});

	it("prefixes known commands across a pipe (ls, wc)", () => {
		expect(rewriteChain("ls -la | wc -l")).toBe("rtk ls -la | rtk wc -l");
	});

	it("truly leaves a chain of only-unknown commands untouched", () => {
		expect(rewriteChain("cd /tmp | sort | uniq")).toBe("cd /tmp | sort | uniq");
	});

	it("handles pipes between known commands", () => {
		expect(rewriteChain("git log | grep fix")).toBe(
			"rtk git log | rtk grep fix",
		);
	});
});

// Integration tests for the `tool_call` hook step. These guard the bug that
// silently disabled rewriting: wrong event name + wrong field + wrong patch
// mechanism. They assert on the IN-PLACE mutation contract the SDK requires.
describe("applyRtkRewrite (tool_call hook step)", () => {
	it("mutates event.input.command in place for a known bash command", () => {
		const event = bashEvent("git status");
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: true,
		});
		expect(changed).toBe(true);
		expect(event.input.command).toBe("rtk git status");
	});

	it("rewrites every segment of a chain in place", () => {
		const event = bashEvent("git add . && git push");
		applyRtkRewrite(event, { enabled: true, rtkAvailable: true });
		expect(event.input.command).toBe("rtk git add . && rtk git push");
	});

	it("does not mutate when disabled", () => {
		const event = bashEvent("git status");
		const changed = applyRtkRewrite(event, {
			enabled: false,
			rtkAvailable: true,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe("git status");
	});

	it("does not mutate when rtk binary is unavailable", () => {
		const event = bashEvent("git status");
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: false,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe("git status");
	});

	it("ignores non-bash tools", () => {
		const event: BashCallEvent = {
			toolName: "grep",
			input: { command: "git status" },
		};
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: true,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe("git status");
	});

	it("leaves unknown commands untouched", () => {
		const event = bashEvent("mkdir build && cd build");
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: true,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe("mkdir build && cd build");
	});

	it("does not double-prefix an already-rtk command", () => {
		const event = bashEvent("rtk git status");
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: true,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe("rtk git status");
	});

	it("handles missing / non-string command safely", () => {
		const event: BashCallEvent = { toolName: "bash", input: {} };
		expect(applyRtkRewrite(event, { enabled: true, rtkAvailable: true })).toBe(
			false,
		);
		const event2: BashCallEvent = { toolName: "bash", input: { command: 123 } };
		expect(applyRtkRewrite(event2, { enabled: true, rtkAvailable: true })).toBe(
			false,
		);
	});

	it("leaves command unchanged on unbalanced quotes", () => {
		const event = bashEvent('git commit -m "oops');
		const changed = applyRtkRewrite(event, {
			enabled: true,
			rtkAvailable: true,
		});
		expect(changed).toBe(false);
		expect(event.input.command).toBe('git commit -m "oops');
	});
});
