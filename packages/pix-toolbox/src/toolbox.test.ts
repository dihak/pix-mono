import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerToolbox, {
	buildRows,
	parseTargets,
	renderList,
	type ToggleOps,
	type ToolRow,
	toggleTool,
} from "./toolbox.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const toolInfo = (name: string, source = "builtin") =>
	({
		name,
		description: `${name} does things.`,
		parameters: {},
		sourceInfo: { source, path: "", scope: "user", origin: "package" },
	}) as never;

const mcpToolInfo = (name: string) => toolInfo(name, "mcp:context7");

// ─── buildRows ──────────────────────────────────────────────────────────────

describe("buildRows", () => {
	test("excludes core tools (bash, edit, read, write)", () => {
		const rows = buildRows([
			toolInfo("bash"),
			toolInfo("edit"),
			toolInfo("read"),
			toolInfo("write"),
			toolInfo("grep"),
			toolInfo("ls"),
		]);
		expect(rows.map((r) => r.name)).toEqual(["grep", "ls"]);
		expect(rows.every((r) => !r.mcp)).toBe(true);
	});

	test("flags MCP tools", () => {
		const rows = buildRows([mcpToolInfo("ctx_search")]);
		expect(rows[0].mcp).toBe(true);
	});

	test("empty input returns empty", () => {
		expect(buildRows([])).toEqual([]);
	});
});

// ─── parseTargets ───────────────────────────────────────────────────────────

describe("parseTargets", () => {
	test("splits on commas, spaces, newlines", () => {
		expect(parseTargets("ls, find  grep\nfetch")).toEqual([
			"ls",
			"find",
			"grep",
			"fetch",
		]);
	});

	test("dedupes", () => {
		expect(parseTargets("ls, ls")).toEqual(["ls"]);
	});

	test("empty yields empty", () => {
		expect(parseTargets("")).toEqual([]);
		expect(parseTargets("  , ")).toEqual([]);
	});
});

// ─── renderList ─────────────────────────────────────────────────────────────

describe("renderList", () => {
	const rows: ToolRow[] = [
		{ name: "read", description: "Read files.", mcp: false },
		{ name: "grep", description: "Search files.", mcp: false },
		{ name: "ctx", description: "MCP search.", mcp: true },
	];
	const isActive = (n: string) => n === "read";

	test("shows status for each tool", () => {
		const out = renderList(rows, isActive);
		expect(out).toContain("✓ active  read");
		expect(out).toContain("# gated  grep");
		expect(out).toContain("# gated  ctx");
		expect(out).toContain("[MCP]");
	});

	test("filters by query", () => {
		const out = renderList(rows, isActive, "grep");
		expect(out).toContain("grep");
		expect(out).not.toContain("read");
	});

	test("no match message", () => {
		const out = renderList(rows, isActive, "zzz");
		expect(out).toContain('No tools matched "zzz"');
	});

	test("empty rows", () => {
		expect(renderList([], isActive)).toContain("No tools registered");
	});
});

// ─── toggleTool ─────────────────────────────────────────────────────────────

describe("toggleTool", () => {
	const rows: ToolRow[] = [
		{ name: "read", description: "Read.", mcp: false },
		{ name: "grep", description: "Search.", mcp: false },
	];

	test("enable calls onActivate", () => {
		let called = "";
		const ops: ToggleOps = {
			onActivate: (n) => {
				called = n;
				return true;
			},
			onDeactivate: () => false,
			isActive: () => false,
		};
		const msg = toggleTool("enable", "grep", rows, ops);
		expect(called).toBe("grep");
		expect(msg).toContain("Enabled grep");
	});

	test("disable calls onDeactivate", () => {
		let called = "";
		const ops: ToggleOps = {
			onActivate: () => false,
			onDeactivate: (n) => {
				called = n;
				return true;
			},
			isActive: () => true,
		};
		const msg = toggleTool("disable", "read", rows, ops);
		expect(called).toBe("read");
		expect(msg).toContain("Disabled read");
	});

	test("unknown tool returns error", () => {
		const ops: ToggleOps = {
			onActivate: () => false,
			onDeactivate: () => false,
			isActive: () => false,
		};
		expect(toggleTool("enable", "nope", rows, ops)).toContain("Unknown");
	});

	test("already active returns already message", () => {
		const ops: ToggleOps = {
			onActivate: () => false,
			onDeactivate: () => false,
			isActive: () => true,
		};
		expect(toggleTool("enable", "read", rows, ops)).toContain("already");
	});

	test("already gated returns already message", () => {
		const ops: ToggleOps = {
			onActivate: () => false,
			onDeactivate: () => false,
			isActive: () => false,
		};
		expect(toggleTool("disable", "read", rows, ops)).toContain("already");
	});
});

// ─── Integration: /toolbox command ──────────────────────────────────────────

// Isolate from real ~/.pi/agent/toolbox.json on disk
let tmpAgentDir: string;
beforeAll(() => {
	tmpAgentDir = mkdtempSync(join(tmpdir(), "toolbox-test-"));
	process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
});
afterAll(() => {
	delete process.env.PI_CODING_AGENT_DIR;
	try {
		rmSync(tmpAgentDir, { recursive: true });
	} catch {
		// temp dir may already be gone — safe to ignore
	}
});

function makeHost(toolNames: string[]) {
	const handlers: Record<string, Array<(p: unknown) => unknown>> = {};
	let active: string[] = [...toolNames];
	const commands: Array<{
		name: string;
		handler: (...args: unknown[]) => unknown;
	}> = [];
	const pi = {
		on(ev: string, fn: (p: unknown) => unknown) {
			if (!handlers[ev]) handlers[ev] = [];
			handlers[ev].push(fn);
		},
		emit(ev: string, payload: unknown, ctx?: unknown) {
			return Promise.all(
				(handlers[ev] ?? []).map((f) =>
					(f as (...args: unknown[]) => unknown)(payload, ctx),
				),
			);
		},
		getAllTools() {
			return toolNames.map((name) => ({
				name,
				description: `${name} does things.`,
				parameters: {},
				sourceInfo: { source: "builtin" },
			}));
		},
		getActiveTools() {
			return active;
		},
		setActiveTools(names: string[]) {
			active = [...names];
		},
		getCommands() {
			return [];
		},
		appendEntry() {},
		registerTool() {},
		registerCommand(
			name: string,
			def: { handler: (...args: unknown[]) => unknown },
		) {
			commands.push({ name, handler: def.handler });
		},
	} as never;
	const emit = (ev: string, payload: unknown, ctx?: unknown) =>
		Promise.all(
			(handlers[ev] ?? []).map((f) =>
				(f as (...args: unknown[]) => unknown)(payload, ctx),
			),
		);
	return {
		pi,
		emit,
		getActive: () => active,
		command: (name: string) => commands.find((c) => c.name === name),
	};
}

function makeCtx() {
	const notes: Array<{ text: string; level?: string }> = [];
	const ctx = {
		ui: {
			notify(text: string, level?: string) {
				notes.push({ text, level });
			},
		},
	} as never;
	return { ctx, notes };
}

describe("/toolbox command", () => {
	const ALL = ["read", "write", "bash", "grep", "find"];

	async function boot() {
		const host = makeHost(ALL);
		registerToolbox(host.pi);
		// session_start triggers init
		await host.emit("session_start", {}, {});
		return host;
	}

	test("registers a /toolbox command", async () => {
		const host = await boot();
		expect(host.command("toolbox")).toBeDefined();
	});

	test("bare /toolbox falls back to listing when no custom UI", async () => {
		const host = await boot();
		const { ctx, notes } = makeCtx();
		await host.command("toolbox")?.handler("", ctx);
		expect(notes.length).toBe(1);
		// only non-core tools shown, all start active
		expect(notes[0].text).toContain("✓ active  grep");
		expect(notes[0].text).toContain("✓ active  find");
		// core tools excluded from toolbox
		expect(notes[0].text).not.toContain("  read");
		expect(notes[0].text).not.toContain("  bash");
	});

	test("/toolbox list shows non-core tools with status", async () => {
		const host = await boot();
		const { ctx, notes } = makeCtx();
		await host.command("toolbox")?.handler("list", ctx);
		expect(notes[0].text).toContain("grep");
		expect(notes[0].text).toContain("find");
		expect(notes[0].text).not.toContain("  bash");
	});

	test("/toolbox list <query> filters", async () => {
		const host = await boot();
		const { ctx, notes } = makeCtx();
		await host.command("toolbox")?.handler("list fin", ctx);
		expect(notes[0].text).toContain("find");
		expect(notes[0].text).not.toContain("✓ active  read");
	});

	test("opens interactive picker when ctx.ui.custom exists", async () => {
		const host = await boot();
		let customCalled = 0;
		const notes: Array<{ text: string; level?: string }> = [];
		const ctx = {
			ui: {
				notify(text: string, level?: string) {
					notes.push({ text, level });
				},
				async custom() {
					customCalled++;
					return null;
				},
			},
		} as never;
		await host.command("toolbox")?.handler("", ctx);
		expect(customCalled).toBe(1);
		expect(notes.length).toBe(0);
	});
});
