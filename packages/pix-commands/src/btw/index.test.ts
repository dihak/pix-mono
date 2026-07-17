import { describe, expect, test } from "bun:test";
import { filterBtwMessages, shortModelName, summarizeLiveText } from "./index.ts";

describe("BTW display helpers", () => {
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
