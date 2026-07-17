import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./extension.ts";
import { filterBtwMessages, shortModelName, summarizeLiveText } from "./index.ts";

afterEach(() => {
	delete (globalThis as { __pixOnce?: WeakMap<object, Set<string>> }).__pixOnce;
});

describe("display helpers", () => {
	test("prefers model display name and falls back to id", () => {
		expect(shortModelName({ id: "id", name: "Friendly" })).toBe("Friendly");
		expect(shortModelName({ id: "id", name: "  " })).toBe("id");
	});

	test("summarizes streaming output on one bounded line", () => {
		expect(summarizeLiveText("hello\n\nworld", 20)).toBe("hello world");
		expect(summarizeLiveText("abcdefghij", 6)).toBe("abcde…");
		expect(summarizeLiveText("   ")).toBe("thinking…");
	});

	test("filters BTW cards from LLM context without affecting the transcript", () => {
		const messages = [
			{ role: "user", content: "main question" },
			{ role: "custom", customType: "pix-btw-answer", content: "aside" },
			{ role: "custom", customType: "other", content: "keep" },
		];
		expect(filterBtwMessages(messages)).toEqual([
			{ role: "user", content: "main question" },
			{ role: "custom", customType: "other", content: "keep" },
		]);
		expect(messages).toHaveLength(3);
	});
});

describe("extension registration", () => {
	function host() {
		const commands: string[] = [];
		const renderers: string[] = [];
		const pi = {
			registerCommand(name: string) {
				commands.push(name);
			},
			registerMessageRenderer(name: string) {
				renderers.push(name);
			},
			on() {},
		} as unknown as ExtensionAPI;
		return { pi, commands, renderers };
	}

	test("registers /btw and its renderer once per Pi instance", () => {
		const { pi, commands, renderers } = host();
		extension(pi);
		extension(pi);
		expect(commands).toEqual(["btw"]);
		expect(renderers).toEqual(["pix-btw-answer"]);
	});

	test("registers again for a fresh Pi session", () => {
		const first = host();
		const second = host();
		extension(first.pi);
		extension(second.pi);
		expect(first.commands).toEqual(["btw"]);
		expect(second.commands).toEqual(["btw"]);
	});
});
