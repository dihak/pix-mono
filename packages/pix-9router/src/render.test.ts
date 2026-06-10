import { expect, test } from "bun:test";
import { makeRenderCall, makeRenderResult } from "./render.js";

const theme = {
	fg: (t: string, s: string) => `[${t}]${s}`,
	bold: (s: string) => `*${s}*`,
} as never;

function stubComponent() {
	let captured = "";
	const component = {
		setText: (s: string) => {
			captured = s;
		},
		render: () => [],
		invalidate: () => {},
	};
	return { component, get: () => captured };
}

test("renderCall shows title + accent arg", () => {
	const stub = stubComponent();
	const rc = makeRenderCall<{ url: string }>("fetch", (a) => a.url);
	rc({ url: "https://x.com" }, theme, {
		lastComponent: stub.component as never,
		isError: false,
	});
	expect(stub.get()).toBe("[toolTitle]*fetch* [accent]https://x.com");
});

test("renderResult dims every line", () => {
	const stub = stubComponent();
	const rr = makeRenderResult();
	rr(
		{ content: [{ type: "text", text: "a\nb" }] } as never,
		{ expanded: true, isPartial: false },
		theme,
		{ lastComponent: stub.component as never, isError: false },
	);
	expect(stub.get()).toBe("  [dim]a\n  [dim]b");
});

test("renderResult caps preview when not expanded", () => {
	const stub = stubComponent();
	const rr = makeRenderResult();
	const body = Array.from({ length: 37 }, (_, i) => `L${i}`).join("\n");
	rr(
		{ content: [{ type: "text", text: body }] } as never,
		{ expanded: false, isPartial: false },
		theme,
		{ lastComponent: stub.component as never, isError: false },
	);
	expect(stub.get()).toContain("… 5 more lines"); // 37 lines − 32 cap
});

test("renderResult renders empty body marker", () => {
	const stub = stubComponent();
	const rr = makeRenderResult();
	rr(
		{ content: [{ type: "text", text: "   " }] } as never,
		{ expanded: false, isPartial: false },
		theme,
		{ lastComponent: stub.component as never, isError: false },
	);
	expect(stub.get()).toBe("  [dim](empty)");
});

test("renderResult uses error token on failure", () => {
	const stub = stubComponent();
	const rr = makeRenderResult();
	rr(
		{ content: [{ type: "text", text: "boom" }] } as never,
		{ expanded: false, isPartial: false },
		theme,
		{ lastComponent: stub.component as never, isError: true },
	);
	expect(stub.get()).toBe("  [error]boom");
});
