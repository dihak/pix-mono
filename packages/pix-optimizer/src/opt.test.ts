import { describe, expect, it } from "bun:test";
import { buildOptHelp, completeInvocation, parseInvocation } from "./opt.ts";
import type { OptimizerHandle, OptimizerTool } from "./status.ts";

/** Build a handle set with spy-able run/complete. */
function fakeHandles(): Record<OptimizerTool, OptimizerHandle> {
	const mk = (name: OptimizerTool): OptimizerHandle => ({
		name,
		help: `${name} help`,
		run: () => {},
		complete: (prefix: string) =>
			["on", "off"]
				.filter((v) => v.startsWith(prefix.trim().toLowerCase()))
				.map((v) => ({ value: v, label: v, description: v })),
	});
	return { caveman: mk("caveman"), rtk: mk("rtk"), toon: mk("toon") };
}

describe("parseInvocation", () => {
	it("empty args → empty name", () => {
		expect(parseInvocation("")).toEqual({ name: "", rest: "" });
		expect(parseInvocation("   ")).toEqual({ name: "", rest: "" });
	});

	it("single token → name only", () => {
		expect(parseInvocation("rtk")).toEqual({ name: "rtk", rest: "" });
		expect(parseInvocation("  RTK  ")).toEqual({ name: "rtk", rest: "" });
	});

	it("splits name from rest", () => {
		expect(parseInvocation("caveman ultra")).toEqual({
			name: "caveman",
			rest: "ultra",
		});
		expect(parseInvocation("rtk on extra")).toEqual({
			name: "rtk",
			rest: "on extra",
		});
	});
});

describe("completeInvocation", () => {
	it("completes tool names before any space", () => {
		const handles = fakeHandles();
		const out = completeInvocation("r", handles);
		expect(out?.map((i) => i.value)).toEqual(["rtk"]);
	});

	it("returns all tool names for empty prefix", () => {
		const handles = fakeHandles();
		const out = completeInvocation("", handles);
		expect(out?.map((i) => i.value)).toEqual(["caveman", "rtk", "toon"]);
	});

	it("delegates to the tool completer after the name", () => {
		const handles = fakeHandles();
		const out = completeInvocation("rtk o", handles);
		expect(out?.map((i) => i.value)).toEqual(["on", "off"]);
	});

	it("null for unknown tool", () => {
		const handles = fakeHandles();
		expect(completeInvocation("nope x", handles)).toBeNull();
	});
});

describe("buildOptHelp", () => {
	it("lists every tool's help line", () => {
		const help = buildOptHelp(fakeHandles());
		expect(help).toContain("/opt caveman help");
		expect(help).toContain("/opt rtk help");
		expect(help).toContain("/opt toon help");
		expect(help).toContain("Usage: /opt <tool> [args]");
	});
});

describe("dispatch via run", () => {
	it("routes rest to the matching handle", () => {
		const handles = fakeHandles();
		let received: string | null = null;
		handles.rtk.run = (args: string) => {
			received = args;
		};
		const { name, rest } = parseInvocation("rtk off");
		expect(name).toBe("rtk");
		void handles[name as OptimizerTool].run(rest, {} as never);
		// `received` is mutated inside the run() callback above; TS narrows it to
		// `null` here since it can't see the side effect, so read it through an
		// untyped cast before asserting.
		expect(received as string | null).toBe("off");
	});
});
