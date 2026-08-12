import { describe, expect, it } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

import {
	buildFdListArgs,
	buildFileCompletionValue,
	createFuzzyFileAutocompleteProvider,
	extractPathToken,
	type FileHit,
	fuzzyFindFiles,
	fuzzySubsequenceMatch,
	hitsToAutocompleteItems,
	isBareSlashCommand,
	normalizeSearchQuery,
	rankHitsLocally,
	resolveLocalBin,
	scoreHit,
	shouldFuzzyFileComplete,
} from "../src/fuzzy-file-autocomplete.js";

describe("extractPathToken", () => {
	it("parses @ attachments", () => {
		expect(extractPathToken("see @hand")).toEqual({
			prefix: "@hand",
			rawQuery: "hand",
			isAt: true,
			isQuoted: false,
		});
	});

	it("parses quoted @ and plain quotes", () => {
		expect(extractPathToken('@"src/foo')).toEqual({
			prefix: '@"src/foo',
			rawQuery: "src/foo",
			isAt: true,
			isQuoted: true,
		});
		expect(extractPathToken('"my file')).toEqual({
			prefix: '"my file',
			rawQuery: "my file",
			isAt: false,
			isQuoted: true,
		});
	});

	it("parses plain tokens after delimiters", () => {
		expect(extractPathToken("read src/comp")).toEqual({
			prefix: "src/comp",
			rawQuery: "src/comp",
			isAt: false,
			isQuoted: false,
		});
	});
});

describe("isBareSlashCommand", () => {
	it("detects command names only", () => {
		expect(isBareSlashCommand("/model")).toBe(true);
		expect(isBareSlashCommand("  /help")).toBe(true);
		expect(isBareSlashCommand("/model gpt")).toBe(false);
		expect(isBareSlashCommand("/usr/local/bin/x")).toBe(false);
		expect(isBareSlashCommand("src/foo")).toBe(false);
	});
});

describe("shouldFuzzyFileComplete", () => {
	it("skips bare slash commands", () => {
		expect(shouldFuzzyFileComplete("/model", { force: true })).toBeNull();
	});

	it("allows @ always", () => {
		expect(shouldFuzzyFileComplete("@util", { force: false })?.rawQuery).toBe("util");
	});

	it("allows path-like on natural trigger", () => {
		expect(shouldFuzzyFileComplete("src/", { force: false })?.rawQuery).toBe("src/");
		expect(shouldFuzzyFileComplete("handler", { force: false })).toBeNull();
	});

	it("allows bare words only when forced (Tab)", () => {
		expect(shouldFuzzyFileComplete("handler", { force: true })?.rawQuery).toBe("handler");
	});
});

describe("normalizeSearchQuery", () => {
	it("strips ./ ~/ and cwd absolute prefix", () => {
		expect(normalizeSearchQuery("./src/a", "/proj")).toBe("src/a");
		expect(normalizeSearchQuery("~/notes", "/proj")).toBe("notes");
		expect(normalizeSearchQuery("/proj/src/a", "/proj")).toBe("src/a");
		expect(normalizeSearchQuery("comp", "/proj")).toBe("comp");
	});
});

describe("buildFileCompletionValue / hitsToAutocompleteItems", () => {
	it("quotes paths with spaces and preserves @", () => {
		expect(buildFileCompletionValue("my file.ts", { isAt: true, isQuoted: false })).toBe(
			'@"my file.ts"',
		);
		expect(buildFileCompletionValue("src/a.ts", { isAt: false, isQuoted: false })).toBe("src/a.ts");
	});

	it("maps hits to items", () => {
		const items = hitsToAutocompleteItems([{ relativePath: "src/a.ts", fileName: "a.ts" }], {
			prefix: "@a",
			rawQuery: "a",
			isAt: true,
			isQuoted: false,
		});
		expect(items[0]).toEqual({
			value: "@src/a.ts",
			label: "a.ts",
			description: "src/a.ts",
		});
	});
});

describe("buildFdListArgs / resolveLocalBin", () => {
	it("excludes node_modules and other heavy dirs", () => {
		const args = buildFdListArgs("/proj", 100);
		expect(args).toContain("--exclude");
		expect(args).toContain("node_modules");
		expect(args).not.toContain("--follow");
	});

	it("finds fd on this machine when present", () => {
		const path = resolveLocalBin(["fd", "fdfind"]);
		// Environment-dependent; just ensure no throw and string|null
		expect(path === null || path.includes("fd")).toBe(true);
	});
});

describe("fuzzySubsequenceMatch", () => {
	it("matches across - _ . / separators", () => {
		expect(fuzzySubsequenceMatch("myappconfig", "my-app-config.json")).toBe(true);
		expect(fuzzySubsequenceMatch("myappconfig", "pkgs/my-app-config/README.md")).toBe(true);
		expect(fuzzySubsequenceMatch("mac", "my-app-config.json")).toBe(true);
		expect(fuzzySubsequenceMatch("zzzz", "my-app-config.json")).toBe(false);
	});
});

describe("scoreHit / rankHitsLocally", () => {
	it("prefers filename prefix matches", () => {
		const a: FileHit = { relativePath: "pkg/handler.ts", fileName: "handler.ts" };
		const b: FileHit = { relativePath: "handler/util.ts", fileName: "util.ts" };
		expect(scoreHit(a, "hand")).toBeGreaterThan(scoreHit(b, "hand"));
	});

	it("ranks collapsed queries onto hyphenated paths", () => {
		const pool: FileHit[] = [
			{ relativePath: "my-app-config.json", fileName: "my-app-config.json" },
			{ relativePath: "pkgs/my-app-config/README.md", fileName: "README.md" },
			{ relativePath: "vendor/my-app-config/src/index.ts", fileName: "index.ts" },
			{ relativePath: "unrelated/foo.ts", fileName: "foo.ts" },
		];
		const ranked = rankHitsLocally(pool, "myappconfig", 10);
		expect(ranked.map((h) => h.relativePath)).not.toContain("unrelated/foo.ts");
		expect(ranked[0]?.relativePath).toBe("my-app-config.json");
		expect(ranked.some((h) => h.relativePath.includes("my-app-config"))).toBe(true);
	});
});

describe("fuzzyFindFiles", () => {
	it("prefers FFF hits over fd", async () => {
		const hits = await fuzzyFindFiles(
			"hand",
			{
				getCwd: () => "/proj",
				getFdPath: () => "/bin/fd",
				searchFff: () => [{ relativePath: "fff.ts", fileName: "fff.ts" }],
				searchFd: async () => [{ relativePath: "fd.ts", fileName: "fd.ts" }],
			},
			new AbortController().signal,
		);
		expect(hits.map((h) => h.relativePath)).toEqual(["fff.ts"]);
	});

	it("falls back to fd when FFF empty/unavailable", async () => {
		const hits = await fuzzyFindFiles(
			"hand",
			{
				getCwd: () => "/proj",
				getFdPath: () => "/bin/fd",
				searchFff: () => null,
				searchFd: async () =>
					rankHitsLocally(
						[
							{ relativePath: "z/hand.ts", fileName: "hand.ts" },
							{ relativePath: "hand/index.ts", fileName: "index.ts" },
						],
						"hand",
						20,
					),
			},
			new AbortController().signal,
		);
		expect(hits[0]?.fileName).toBe("hand.ts");
	});

	it("matches collapsed queries via fd candidate ranking", async () => {
		const hits = await fuzzyFindFiles(
			"myappconfig",
			{
				getCwd: () => "/proj",
				getFdPath: () => "/bin/fd",
				searchFff: () => null,
				searchFd: async (_q, _cwd, _fd, limit) =>
					rankHitsLocally(
						[
							{
								relativePath: "my-app-config.json",
								fileName: "my-app-config.json",
							},
							{
								relativePath: "pkgs/my-app-config/README.md",
								fileName: "README.md",
							},
						],
						"myappconfig",
						limit,
					),
			},
			new AbortController().signal,
		);
		expect(hits[0]?.relativePath).toBe("my-app-config.json");
	});
});

describe("createFuzzyFileAutocompleteProvider", () => {
	const base: AutocompleteProvider = {
		async getSuggestions() {
			return {
				prefix: "/model ",
				items: [{ value: "gpt", label: "gpt" }],
			};
		},
		applyCompletion(_lines, cursorLine, _cursorCol, item, prefix) {
			return {
				lines: [`${prefix}${item.value}`],
				cursorLine,
				cursorCol: prefix.length + item.value.length,
			};
		},
		shouldTriggerFileCompletion: () => true,
	};

	it("delegates slash command args when base has items", async () => {
		const provider = createFuzzyFileAutocompleteProvider(base, {
			getCwd: () => "/proj",
			getFdPath: () => null,
			searchFff: () => [{ relativePath: "x.ts", fileName: "x.ts" }],
		});
		const result = await provider.getSuggestions(["/model g"], 0, 8, {
			signal: new AbortController().signal,
			force: true,
		});
		expect(result?.items[0]?.value).toBe("gpt");
	});

	it("returns fuzzy file items for @query", async () => {
		const provider = createFuzzyFileAutocompleteProvider(base, {
			getCwd: () => "/proj",
			getFdPath: () => null,
			searchFff: () => [{ relativePath: "src/util.ts", fileName: "util.ts" }],
		});
		const result = await provider.getSuggestions(["@util"], 0, 5, {
			signal: new AbortController().signal,
		});
		expect(result).toEqual({
			prefix: "@util",
			items: [
				{
					value: "@src/util.ts",
					label: "util.ts",
					description: "src/util.ts",
				},
			],
		});
	});

	it("falls back to base when no hits", async () => {
		const emptyBase: AutocompleteProvider = {
			async getSuggestions() {
				return { prefix: "zzz", items: [{ value: "local", label: "local" }] };
			},
			applyCompletion: base.applyCompletion,
		};
		const provider = createFuzzyFileAutocompleteProvider(emptyBase, {
			getCwd: () => "/proj",
			getFdPath: async () => null,
			searchFff: () => [],
		});
		const result = await provider.getSuggestions(["zzz"], 0, 3, {
			signal: new AbortController().signal,
			force: true,
		});
		expect(result?.items[0]?.value).toBe("local");
	});
});
