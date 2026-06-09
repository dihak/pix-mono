/**
 * Tests for thinking tag rendering
 */

import { describe, expect, it } from "bun:test";
import { renderThinking, stripPartialTailTag } from "./thinking";

describe("thinking tag rendering", () => {
	describe("closed thinking blocks", () => {
		it("renders basic <thinking> block as blockquote", () => {
			const input = "<thinking>This is reasoning</thinking>";
			const output = renderThinking(input);
			expect(output).toBe(`> This is reasoning\n\n`);
		});

		it("renders basic <think> block as blockquote", () => {
			const input = "<think>This is reasoning</think>";
			const output = renderThinking(input);
			expect(output).toBe(`> This is reasoning\n\n`);
		});

		it("renders multi-line thinking block as blockquote", () => {
			const input = "<thinking>Line 1\nLine 2\nLine 3</thinking>";
			const output = renderThinking(input);
			expect(output).toBe(`> Line 1\n> Line 2\n> Line 3\n\n`);
		});

		it("renders multiple thinking blocks", () => {
			const input =
				"<thinking>First block</thinking> Some text <thinking>Second block</thinking>";
			const output = renderThinking(input);
			expect(output).toContain("First block");
			expect(output).toContain("Second block");
			expect(output).toContain("Some text");
			expect(output).toContain(">");
		});

		it("removes empty thinking blocks", () => {
			const input = "Before <thinking></thinking> After";
			const output = renderThinking(input);
			expect(output).not.toContain("thinking");
			expect(output).toContain("Before");
			expect(output).toContain("After");
		});

		it("removes thinking blocks with only whitespace", () => {
			const input = "Before <thinking>   \n  </thinking> After";
			const output = renderThinking(input);
			expect(output).not.toContain(">");
			expect(output).toContain("Before");
			expect(output).toContain("After");
		});

		it("trims whitespace from thinking content", () => {
			const input = "<thinking>\n  This is reasoning  \n</thinking>";
			const output = renderThinking(input);
			expect(output).toBe(`> This is reasoning\n\n`);
		});

		it("handles mixed case tag names", () => {
			const input =
				"<THINKING>uppercase</THINKING> <ThInKiNg>mixedcase</ThInKiNg>";
			const output = renderThinking(input);
			expect(output).toContain("uppercase");
			expect(output).toContain("mixedcase");
			expect(output).toContain(">");
		});
	});

	describe("dangling/unclosed blocks", () => {
		it("renders dangling <thinking> block at end of text", () => {
			const input = "Some text <thinking>Reasoning without close tag";
			const output = renderThinking(input);
			expect(output).toContain("Reasoning without close tag");
			expect(output).toContain("Some text");
			expect(output).toContain(">");
		});

		it("renders dangling <think> block at end of text", () => {
			const input = "Some text <think>Reasoning without close tag";
			const output = renderThinking(input);
			expect(output).toContain("Reasoning without close tag");
			expect(output).toContain("Some text");
			expect(output).toContain(">");
		});

		it("does not treat mid-text unclosed tag as dangling", () => {
			// Only dangling blocks at the END of text are processed by OPEN_TAIL_RE
			const input = "<thinking>Unclosed\nMore text after";
			const output = renderThinking(input);
			expect(output).toContain(">");
		});
	});

	describe("orphan tags", () => {
		it("removes orphan closing tags", () => {
			const input = "Some text </thinking> more text";
			const output = renderThinking(input);
			expect(output).not.toContain("</thinking>");
			expect(output).not.toContain("<thinking>");
			expect(output).toContain("Some text");
			expect(output).toContain("more text");
		});

		it("removes orphan opening tags after processing blocks", () => {
			const input = "Text <think> orphan tag";
			const output = renderThinking(input);
			expect(output).not.toContain("<think>");
			expect(output).toContain("Text");
		});

		it("removes multiple orphan tags", () => {
			const input = "</thinking> text </think> more <thinking> stuff </think>";
			const output = renderThinking(input);
			// Note: <thinking> at the end is treated as dangling block, creating a blockquote
			expect(output).not.toContain("<thinking>");
			expect(output).not.toContain("</thinking>");
			expect(output).not.toContain("</think>");
			expect(output).toContain("text");
			expect(output).toContain("stuff");
		});
	});

	describe("text without thinking tags", () => {
		it("returns text unchanged when no thinking tags present", () => {
			const input = "This is regular text without any tags";
			const output = renderThinking(input);
			expect(output).toBe(input);
		});

		it("preserves markdown formatting", () => {
			const input = "# Header\n\n**bold** and *italic*";
			const output = renderThinking(input);
			expect(output).toBe(input);
		});
	});

	describe("mixed content", () => {
		it("preserves text before thinking block", () => {
			const input = "Response text here\n\n<thinking>reasoning</thinking>";
			const output = renderThinking(input);
			expect(output).toContain("Response text here");
			expect(output).toContain("reasoning");
			expect(output).toContain(">");
		});

		it("preserves text after thinking block", () => {
			const input = "<thinking>reasoning</thinking>\n\nMore response text";
			const output = renderThinking(input);
			expect(output).toContain("reasoning");
			expect(output).toContain("More response text");
			expect(output).toContain(">");
		});

		it("preserves text between multiple thinking blocks", () => {
			const input =
				"<thinking>first</thinking>\n\nMiddle text\n\n<thinking>second</thinking>";
			const output = renderThinking(input);
			expect(output).toContain("first");
			expect(output).toContain("Middle text");
			expect(output).toContain("second");
			expect(output).toContain(">");
		});
	});

	describe("newline cleanup", () => {
		it("reduces excessive newlines to maximum of 3", () => {
			const input = "Text\n\n\n\n\n\nMore text";
			const output = renderThinking(input);
			expect(output).not.toContain("\n\n\n\n");
			expect(output).toBe("Text\n\n\nMore text");
		});

		it("removes leading whitespace", () => {
			const input = "   \n  \n  Text";
			const output = renderThinking(input);
			expect(output).toBe("Text");
		});

		it("preserves necessary newlines", () => {
			const input = "Line 1\n\nLine 2";
			const output = renderThinking(input);
			expect(output).toBe(input);
		});
	});

	describe("streaming (partial tail tags + live rendering)", () => {
		it("strips a half-streamed opening tag", () => {
			expect(stripPartialTailTag("Hello <thin")).toBe("Hello ");
			expect(stripPartialTailTag("Hello <")).toBe("Hello ");
			expect(stripPartialTailTag("Hello <thinking")).toBe("Hello ");
		});

		it("strips a half-streamed closing tag", () => {
			expect(stripPartialTailTag("reasoning </thinkin")).toBe("reasoning ");
			expect(stripPartialTailTag("reasoning </")).toBe("reasoning ");
		});

		it("keeps non-reasoning partial tags", () => {
			expect(stripPartialTailTag("a generic <div")).toBe("a generic <div");
			expect(stripPartialTailTag("math: 1 < 2")).toBe("math: 1 < 2");
		});

		it("keeps complete tags (only the trailing fragment is stripped)", () => {
			expect(stripPartialTailTag("<thinking>body")).toBe("<thinking>body");
		});

		it("renders an open block as blockquote before close tag arrives", () => {
			// Simulates mid-stream state: open tag + partial body, no close tag.
			const midStream = "<thinking>I am reasoning about";
			const output = renderThinking(stripPartialTailTag(midStream));
			expect(output).toBe("> I am reasoning about\n\n");
		});

		it("renders progressively without flashing partial close tag", () => {
			const step1 = renderThinking(stripPartialTailTag("<think>step one"));
			const step2 = renderThinking(
				stripPartialTailTag("<think>step one and two</thi"),
			);
			const step3 = renderThinking(
				stripPartialTailTag("<think>step one and two</think>\n\nAnswer"),
			);
			expect(step1).toBe("> step one\n\n");
			expect(step2).toBe("> step one and two\n\n");
			expect(step3).toContain("> step one and two");
			expect(step3).toContain("Answer");
			expect(step3).not.toContain("<think>");
		});
	});

	describe("edge cases", () => {
		it("handles empty string", () => {
			const input = "";
			const output = renderThinking(input);
			expect(output).toBe("");
		});

		it("handles string with only whitespace", () => {
			const input = "   \n  \n  ";
			const output = renderThinking(input);
			expect(output).toBe("");
		});

		it("handles nested-looking tags (not actually nested in HTML sense)", () => {
			const input =
				"<thinking>outer <thinking>inner</thinking> outer</thinking>";
			const output = renderThinking(input);
			// Regex will match first <thinking>...</thinking> pair
			expect(output).toContain(">");
		});

		it("handles thinking content with special characters", () => {
			const input = "<thinking>Special chars: $@#%^&*()</thinking>";
			const output = renderThinking(input);
			expect(output).toContain("Special chars: $@#%^&*()");
			expect(output).toContain(">");
		});

		it("handles thinking content with code-like syntax", () => {
			const input = "<thinking>const x = 5;\nreturn x + 1;</thinking>";
			const output = renderThinking(input);
			expect(output).toContain("const x = 5;");
			expect(output).toContain("return x + 1;");
			expect(output).toContain(">");
		});
	});
});
