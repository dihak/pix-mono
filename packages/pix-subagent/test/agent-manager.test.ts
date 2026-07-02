/**
 * agent-manager.test.ts — Lifecycle tests for AgentManager queue/abort/drain.
 *
 * Uses the test-only injection point (__setRunAgentForTests) to replace
 * runAgent with a controllable fake, avoiding the need for real sessions.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	__resetAgentRunnersForTests,
	__setRunAgentForTests,
	AgentManager,
	type OnAgentComplete,
} from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal fake session — AgentManager only touches dispose/steer/subscribe/messages. */
function fakeSession(): AgentSession {
	return {
		dispose() {},
		steer: async () => {},
		subscribe: () => () => {},
		messages: [],
	} as unknown as AgentSession;
}

/** Minimal pi/ctx — our fake runAgent never uses them. */
const pi = {} as never;
const ctx = {} as never;

interface DeferredRunAgent {
	/** Resolve the runAgent promise with a successful result. */
	resolve(text?: string): void;
	/** Reject the runAgent promise. */
	reject(err: Error): void;
	/** The AbortSignal passed to runAgent (for abort assertions). */
	signal?: AbortSignal;
}

/**
 * Install a fake runAgent that captures each call into `calls` and returns a
 * deferred promise the test can resolve/reject at will.
 */
function installFakeRunAgent(): DeferredRunAgent[] {
	const calls: DeferredRunAgent[] = [];

	__setRunAgentForTests((_ctx, _type, _prompt, options): Promise<RunResult> => {
		// Capture the onSessionCreated callback and fire it with a fake session
		// so the manager wires up the session on the record.
		options.onSessionCreated?.(fakeSession());

		const deferred: DeferredRunAgent = {
			resolve: () => {},
			reject: () => {},
			signal: options.signal,
		};

		const promise = new Promise<RunResult>((resolve, reject) => {
			deferred.resolve = (text = "done") =>
				resolve({
					responseText: text,
					session: fakeSession(),
					aborted: false,
					steered: false,
				});
			deferred.reject = reject;
		});

		calls.push(deferred);
		return promise;
	});

	return calls;
}

// ── Tests ────────────────────────────────────────────────────────────────────

let manager: AgentManager;

afterEach(() => {
	manager?.dispose();
	__resetAgentRunnersForTests();
});

describe("AgentManager", () => {
	// 1. Queueing
	test("with maxConcurrent=1, second bg agent is queued then drains", async () => {
		const calls = installFakeRunAgent();
		manager = new AgentManager(undefined, 1);

		const id1 = manager.spawn(pi, ctx, "general-purpose", "task 1", {
			description: "first",
			isBackground: true,
		});
		const id2 = manager.spawn(pi, ctx, "general-purpose", "task 2", {
			description: "second",
			isBackground: true,
		});

		expect(manager.getRecord(id1)?.status).toBe("running");
		expect(manager.getRecord(id2)?.status).toBe("queued");

		// Resolve the first agent — should trigger drainQueue → second starts
		calls[0].resolve();
		// Allow microtasks to flush
		await new Promise((r) => setTimeout(r, 10));

		expect(manager.getRecord(id1)?.status).toBe("completed");
		expect(manager.getRecord(id2)?.status).toBe("running");

		// Clean up second agent
		calls[1].resolve();
		await new Promise((r) => setTimeout(r, 10));
	});

	// 2. abort() on queued agent
	test("abort() on queued agent → stopped, never starts", async () => {
		const calls = installFakeRunAgent();
		manager = new AgentManager(undefined, 1);

		manager.spawn(pi, ctx, "general-purpose", "task 1", {
			description: "first",
			isBackground: true,
		});
		const queuedId = manager.spawn(pi, ctx, "general-purpose", "task 2", {
			description: "second",
			isBackground: true,
		});

		expect(manager.getRecord(queuedId)?.status).toBe("queued");
		manager.abort(queuedId);
		expect(manager.getRecord(queuedId)?.status).toBe("stopped");

		// Resolve the first and wait — the second should NOT start
		calls[0].resolve();
		await new Promise((r) => setTimeout(r, 10));
		// Only 1 call to runAgent (the second was never started)
		expect(calls.length).toBe(1);
	});

	// 3. abort() on running agent
	test("abort() on running agent → stopped, abortController fired", () => {
		const calls = installFakeRunAgent();
		manager = new AgentManager(undefined, 4);

		const id = manager.spawn(pi, ctx, "general-purpose", "task", {
			description: "run",
			isBackground: true,
		});

		expect(manager.getRecord(id)?.status).toBe("running");
		// The signal passed to the fake should not be aborted yet
		expect(calls[0].signal?.aborted).toBe(false);

		manager.abort(id);
		expect(manager.getRecord(id)?.status).toBe("stopped");
		expect(calls[0].signal?.aborted).toBe(true);
	});

	// 4. spawn cwd validation
	test("spawn with relative cwd throws", () => {
		installFakeRunAgent();
		manager = new AgentManager(undefined, 4);
		expect(() =>
			manager.spawn(pi, ctx, "general-purpose", "task", {
				description: "test",
				cwd: "relative/path",
			}),
		).toThrow("absolute path");
	});

	test("spawn with non-existent absolute cwd throws", () => {
		installFakeRunAgent();
		manager = new AgentManager(undefined, 4);
		expect(() =>
			manager.spawn(pi, ctx, "general-purpose", "task", {
				description: "test",
				cwd: "/nonexistent-dir-xyz",
			}),
		).toThrow("does not exist");
	});

	test("spawn with undefined cwd is fine", () => {
		installFakeRunAgent();
		manager = new AgentManager(undefined, 4);
		// Should not throw
		const id = manager.spawn(pi, ctx, "general-purpose", "task", {
			description: "test",
			cwd: undefined,
		});
		expect(id).toBeTruthy();
	});

	// 5. abortAll()
	test("abortAll() stops 1 running + 1 queued, returns 2", async () => {
		const calls = installFakeRunAgent();
		manager = new AgentManager(undefined, 1);

		manager.spawn(pi, ctx, "general-purpose", "task 1", {
			description: "first",
			isBackground: true,
		});
		manager.spawn(pi, ctx, "general-purpose", "task 2", {
			description: "second",
			isBackground: true,
		});

		const count = manager.abortAll();
		expect(count).toBe(2);

		// Both should be stopped
		const agents = manager.listAgents();
		expect(agents.every((a) => a.status === "stopped")).toBe(true);

		// Clean up — resolve the first's promise so the .catch handler runs
		calls[0].resolve();
		await new Promise((r) => setTimeout(r, 10));
	});

	// 6. clearCompleted()
	test("clearCompleted removes completed record, keeps running", async () => {
		const calls = installFakeRunAgent();
		manager = new AgentManager(undefined, 4);

		const idA = manager.spawn(pi, ctx, "general-purpose", "task 1", {
			description: "first",
			isBackground: true,
		});
		const idB = manager.spawn(pi, ctx, "general-purpose", "task 2", {
			description: "second",
			isBackground: true,
		});

		// Complete the first agent
		calls[0].resolve();
		await new Promise((r) => setTimeout(r, 10));
		expect(manager.getRecord(idA)?.status).toBe("completed");
		expect(manager.getRecord(idB)?.status).toBe("running");

		manager.clearCompleted();

		expect(manager.getRecord(idA)).toBeUndefined();
		expect(manager.getRecord(idB)).toBeDefined();
		expect(manager.getRecord(idB)?.status).toBe("running");

		calls[1].resolve();
		await new Promise((r) => setTimeout(r, 10));
	});

	// 7. spawnAndWait returns record with completed status
	test("spawnAndWait returns completed record with result text", async () => {
		installFakeRunAgent();
		manager = new AgentManager(undefined, 4);

		// spawnAndWait is foreground — resolve immediately from the fake
		// We need to resolve after it starts. Use a setTimeout.
		__setRunAgentForTests(async (_ctx, _type, _prompt, options) => {
			options.onSessionCreated?.(fakeSession());
			return {
				responseText: "done",
				session: fakeSession(),
				aborted: false,
				steered: false,
			};
		});

		const record = await manager.spawnAndWait(
			pi,
			ctx,
			"general-purpose",
			"do the thing",
			{ description: "fg task" },
		);

		expect(record.status).toBe("completed");
		expect(record.result).toBe("done");
	});

	// 8. error path
	test("runAgent rejection → error status, error message, onComplete fired", async () => {
		let completedRecord: unknown = null;
		const onComplete: OnAgentComplete = (record) => {
			completedRecord = record;
		};

		const calls = installFakeRunAgent();
		manager = new AgentManager(onComplete, 4);

		const id = manager.spawn(pi, ctx, "general-purpose", "task", {
			description: "will fail",
			isBackground: true,
		});

		calls[0].reject(new Error("kaboom"));
		await new Promise((r) => setTimeout(r, 10));

		const record = manager.getRecord(id);
		expect(record?.status).toBe("error");
		expect(record?.error).toBe("kaboom");
		expect(completedRecord).toBeDefined();
	});
});
