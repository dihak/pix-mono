import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import {
	BTW_SYSTEM_PROMPT,
	lastAssistantText,
	makeLeanExtensions,
	selectBtwTools,
	snapshotMainSettings,
} from "./session.ts";

describe("BTW system prompt", () => {
	test("is the exact lean Pix identity", () => {
		expect(BTW_SYSTEM_PROMPT).toBe(
			"You are Pix Coding Agent. You help users accomplish any task they request.",
		);
	});
});

describe("snapshotMainSettings", () => {
	test("captures model, thinking, cwd, and a defensive copy of active tools", () => {
		const tools = ["read", "fetch"];
		const model = { id: "model-id", name: "Model" } as Model<Api>;
		const snapshot = snapshotMainSettings({ cwd: "/project", model } as never, "high", tools);
		tools.push("write");
		expect(snapshot.cwd).toBe("/project");
		expect(snapshot.model).toBe(model);
		expect(snapshot.thinkingLevel).toBe("high");
		expect(snapshot.activeToolNames).toEqual(["read", "fetch"]);
	});

	test("rejects invocation when the main session has no model", () => {
		expect(() =>
			snapshotMainSettings({ cwd: "/project", model: undefined } as never, "medium", []),
		).toThrow("No model is selected");
	});
});

describe("selectBtwTools", () => {
	test("uses the main active tools and removes duplicates without reordering", () => {
		expect(selectBtwTools(["read", "fetch", "read", "agent"])).toEqual(["read", "fetch", "agent"]);
	});
});

describe("makeLeanExtensions", () => {
	test("removes discovered before_agent_start mutators but preserves inline override", () => {
		const regularHandlers = new Map<string, never[]>([
			["before_agent_start", []],
			["tool_call", []],
		]);
		const inlineHandlers = new Map<string, never[]>([["before_agent_start", []]]);
		const base = {
			extensions: [
				{ path: "/extensions/other-ext.ts", handlers: regularHandlers },
				{ path: "<inline:1>", handlers: inlineHandlers },
			],
			errors: [],
			runtime: {},
		} as unknown as LoadExtensionsResult;

		const result = makeLeanExtensions(base);
		expect(result.extensions[0]?.handlers.has("before_agent_start")).toBe(false);
		expect(result.extensions[0]?.handlers.has("tool_call")).toBe(true);
		expect(result.extensions[1]?.handlers.has("before_agent_start")).toBe(true);
		// Do not mutate the loader's original extension records.
		expect(regularHandlers.has("before_agent_start")).toBe(true);
	});
});

describe("lastAssistantText", () => {
	test("returns text from the latest assistant response", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "old" }] },
			{ role: "user", content: "question" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "latest" },
				],
			},
		];
		expect(lastAssistantText(messages)).toBe("latest");
	});

	test("returns an empty string when there is no assistant text", () => {
		expect(lastAssistantText([{ role: "user", content: "hello" }])).toBe("");
	});
});
