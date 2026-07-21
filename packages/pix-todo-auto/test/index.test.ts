import { describe, expect, it } from "bun:test";
import type { TodoItem } from "@dihak/pix-todo";
import { decideAutoContinue, wasUserAborted } from "../src/index.js";

const t = (id: number, status: TodoItem["status"]): TodoItem => ({ id, text: `#${id}`, status });

describe("decideAutoContinue", () => {
	it("stops on an empty list", () => {
		expect(decideAutoContinue([], undefined, 0).decision).toEqual({
			action: "stop",
			reason: "empty",
		});
	});

	it("stops when all items are done", () => {
		expect(decideAutoContinue([t(1, "done"), t(2, "done")], undefined, 0).decision).toEqual({
			action: "stop",
			reason: "done",
		});
	});

	it("stops when any item is blocked", () => {
		expect(decideAutoContinue([t(1, "pending"), t(2, "blocked")], undefined, 0).decision).toEqual({
			action: "stop",
			reason: "blocked",
		});
	});

	it("continues while a pending item remains", () => {
		const { decision } = decideAutoContinue([t(1, "pending"), t(2, "done")], undefined, 0);
		expect(decision.action).toBe("continue");
	});

	it("continues while an in_progress item remains", () => {
		const { decision } = decideAutoContinue([t(1, "in_progress")], undefined, 0);
		expect(decision.action).toBe("continue");
	});

	it("does not stall on the first nudge", () => {
		expect(decideAutoContinue([t(1, "pending")], undefined, 0).decision.action).toBe("continue");
	});

	it("resets the stall counter when the todo list changes", () => {
		// prevSig differs from current sig -> progress -> stalled resets to 0.
		const { decision, stalled } = decideAutoContinue(
			[t(1, "done"), t(2, "pending")],
			"1:pending,2:done",
			2,
		);
		expect(decision.action).toBe("continue");
		expect(stalled).toBe(0);
	});

	it("stops after MAX consecutive no-progress nudges", () => {
		// same sig as prev, already stalled twice -> third makes it 3 -> stop.
		const { decision } = decideAutoContinue([t(1, "pending")], "1:pending", 2);
		expect(decision).toEqual({ action: "stop", reason: "stall" });
	});

	it("keeps continuing while below the stall cap", () => {
		const { decision } = decideAutoContinue([t(1, "pending")], "1:pending", 1);
		expect(decision.action).toBe("continue");
	});
});

describe("wasUserAborted", () => {
	it("detects an Esc abort on the last assistant message", () => {
		expect(wasUserAborted([{ role: "user" }, { role: "assistant", stopReason: "aborted" }])).toBe(
			true,
		);
	});

	it("is false for a normal stop", () => {
		expect(wasUserAborted([{ role: "assistant", stopReason: "stop" }])).toBe(false);
	});

	it("reads the last assistant even with trailing tool results", () => {
		expect(
			wasUserAborted([{ role: "assistant", stopReason: "aborted" }, { role: "toolResult" }]),
		).toBe(true);
	});

	it("is false when there is no assistant message", () => {
		expect(wasUserAborted([{ role: "user" }])).toBe(false);
	});

	it("is false for empty or non-array input", () => {
		expect(wasUserAborted([])).toBe(false);
		expect(wasUserAborted(null)).toBe(false);
	});
});
