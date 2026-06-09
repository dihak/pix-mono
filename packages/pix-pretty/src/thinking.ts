/**
 * Render leaked reasoning tags as styled, visually distinct blocks.
 *
 * Some openai-compatible providers leak raw <think>/<thinking> tags into the
 * visible assistant `content[].text` (the real reasoning travels the proper
 * `reasoning_content` channel). Instead of stripping them, we render them
 * with clear visual styling so they're useful for debugging but don't
 * interfere with the actual response.
 *
 * Approach:
 *   - During streaming (`message_update`), re-render the event's message so
 *     reasoning blocks appear as styled blockquotes the moment the open tag
 *     streams in — no waiting for the close tag. The dangling-open-block
 *     handling in renderThinking() covers the not-yet-closed case, and a
 *     trailing half-streamed tag (e.g. "<thin") is stripped so it never
 *     flashes as literal text.
 *
 *     Safety: `event.message` is a per-event shallow copy, but its content
 *     blocks are the provider's LIVE accumulating objects (providers do
 *     `block.text += delta`). We therefore never mutate text blocks in
 *     place — we replace `message.content` with fresh block objects. The
 *     TUI receives the same event object after extensions run, so the
 *     restyled content is what gets rendered live.
 *
 *   - On `message_end`, extract and reformat every reasoning block with
 *     visual markers, then return the styled message via the supported
 *     replacement channel. (The finalized message comes from
 *     `response.result()` — a fresh object that never saw the streaming
 *     restyling — so this step is still required for persistence.)
 *
 * `content[].text` is MARKDOWN rendered by pi's TUI Markdown component.
 * The TUI does NOT parse HTML — <details>/<summary> would render as literal
 * junk text. We use a Markdown BLOCKQUOTE instead, which the TUI renders
 * natively via the `mdQuote`/`mdQuoteBorder` theme tokens.
 *
 * To add a new tag variant, append to TAG_NAMES below.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Reasoning tag names to render. Add new variants here.
const TAG_NAMES = ["think", "thinking"] as const;
const TAG_ALT = TAG_NAMES.join("|");

// Closed block: <think>...</think>
const CLOSED_BLOCK_RE = new RegExp(`<(${TAG_ALT})>([\\s\\S]*?)<\\/\\1>`, "gi");
// Dangling open block with no close (stream cut off, or close never emitted)
const OPEN_TAIL_RE = new RegExp(`<(${TAG_ALT})>([\\s\\S]*)$`, "i");
// Any orphan tags left over.
const ORPHAN_TAG_RE = new RegExp(`<\\/?(${TAG_ALT})>`, "gi");

interface TextBlock {
	type: "text";
	text: string;
}
type Block = TextBlock | { type: string; [k: string]: unknown };
interface Msg {
	role?: string;
	content?: Block[];
}

// Trailing half-streamed tag, e.g. "<", "</", "<thin", "</thinkin".
// Only used during streaming so an incomplete tag never flashes as text.
const PARTIAL_TAIL_RE = /<\/?([a-zA-Z]*)$/;

function stripPartialTailTag(text: string): string {
	const match = text.match(PARTIAL_TAIL_RE);
	if (!match) return text;
	const fragment = match[1].toLowerCase();
	if (TAG_NAMES.some((tag) => tag.startsWith(fragment))) {
		return text.slice(0, match.index);
	}
	return text;
}

// Render a reasoning body as a markdown blockquote.
function asQuote(body: string, _label: string): string {
	const lines = body.split("\n");
	const quoted = lines.map((line) => `> ${line}`).join("\n");
	return `\n\n${quoted}\n\n`;
}

function renderThinking(text: string): string {
	// Replace closed blocks with a clearly-marked blockquote
	text = text.replace(CLOSED_BLOCK_RE, (_match, _tag, content) => {
		const trimmed = content.trim();
		if (!trimmed) return "";
		return asQuote(trimmed, "⚙ Reasoning");
	});

	// Replace dangling open blocks (stream cut off before close tag)
	text = text.replace(OPEN_TAIL_RE, (_match, _tag, content) => {
		const trimmed = content.trim();
		if (!trimmed) return "";
		return asQuote(trimmed, "⚙ Reasoning (incomplete)");
	});

	// Clean up any orphan tags
	text = text.replace(ORPHAN_TAG_RE, "");

	// Clean up excessive newlines
	return text.replace(/\n{4,}/g, "\n\n\n").replace(/^\s+/, "");
}

// Export for testing
export { renderThinking, stripPartialTailTag };

export default function thinkingExtension(pi: ExtensionAPI) {
	// Live styling during streaming: restyle the event's message so reasoning
	// renders as soon as the open tag appears, token by token.
	pi.on("message_update", (event) => {
		const ev = event as {
			message?: Msg;
			assistantMessageEvent?: { type?: string };
		};
		const msg = ev.message;
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;

		// Only text stream events can change text blocks; skip toolcall/thinking
		// channel deltas to avoid pointless re-renders.
		const streamType = ev.assistantMessageEvent?.type;
		if (streamType && !streamType.startsWith("text_")) return;

		msg.content = msg.content.map((block) => {
			if (block.type !== "text") return block;
			const tb = block as TextBlock;
			if (typeof tb.text !== "string" || !tb.text.includes("<")) return block;
			const stripped = stripPartialTailTag(tb.text);
			const lower = stripped.toLowerCase();
			const hasTag = TAG_NAMES.some((t) => lower.includes(`<${t}`));
			// Nothing reasoning-related: leave unrelated "<" text alone entirely.
			if (!hasTag && stripped === tb.text) return block;
			const rendered = hasTag ? renderThinking(stripped) : stripped;
			if (rendered === tb.text) return block;
			// New object — never mutate the provider's accumulating block.
			return { ...block, text: rendered };
		});
	});

	pi.on("message_end", (event) => {
		const msg = (event as { message?: Msg }).message;
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;

		let changed = false;
		for (const block of msg.content) {
			if (block.type !== "text") continue;
			const tb = block as TextBlock;
			if (typeof tb.text !== "string") continue;
			if (!TAG_NAMES.some((t) => tb.text.includes(`<${t}`))) continue;
			const rendered = renderThinking(tb.text);
			if (rendered !== tb.text) {
				tb.text = rendered;
				changed = true;
			}
		}

		// Return the replacement so the styled message is what gets persisted.
		if (changed) return { message: msg as unknown as never };
	});
}
