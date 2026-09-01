import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	redirectModelCommandIntercept,
	redirectModelSelectAction,
	stripBuiltinModelCommand,
} from "./patch-builtin.ts";

const MODEL_ACTION = `        this.defaultEditor.onAction("app.model.select", () => this.showModelSelector());
        this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
`;

const UNPATCHED = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model (opens selector UI)" },
    { name: "login", description: "Configure provider authentication" },
];
`;

const CURRENT_PI = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
    { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
];
`;

describe("patch-builtin /model removal", () => {
	it("removes the built-in /model line and keeps neighbors", () => {
		const out = stripBuiltinModelCommand(UNPATCHED);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("is idempotent — second pass is a no-op", () => {
		const once = stripBuiltinModelCommand(UNPATCHED);
		const twice = stripBuiltinModelCommand(once);
		expect(twice).toBe(once);
	});

	it("leaves an already-clean file untouched", () => {
		const clean = `export const X = [\n    { name: "login" },\n];\n`;
		expect(stripBuiltinModelCommand(clean)).toBe(clean);
	});

	it("does not strip the plural /models entry", () => {
		const withPlural = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "models", description: "Enhanced picker" },
    { name: "model", description: "Select model (opens selector UI)" },
];`;
		const out = stripBuiltinModelCommand(withPlural);
		expect(out).toContain('name: "models"');
		expect(out).not.toContain('{ name: "model", description');
	});

	it("removes Pi's current /model form with an argument hint", () => {
		const out = stripBuiltinModelCommand(CURRENT_PI);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "scoped-models"');
	});

	it("does not alter /model text outside the built-in command array", () => {
		const source = `const source = '{ name: "model" }';
export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
];
`;
		expect(stripBuiltinModelCommand(source)).toBe(source);
	});

	it("removes a multi-line /model command without touching adjacent entries", () => {
		const multiline = `export const BUILTIN_SLASH_COMMANDS = [
    { name: "settings", description: "Open settings menu" },
    {
        name: "model",
        description: "Select model (opens selector UI)",
        argumentHint: "<provider/model>",
    },
    { name: "login", description: "Configure provider authentication" },
];
`;
		const out = stripBuiltinModelCommand(multiline);
		expect(out).not.toContain('name: "model"');
		expect(out).toContain('name: "settings"');
		expect(out).toContain('name: "login"');
	});

	it("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "pix-patch-"));
		const file = join(dir, "slash-commands.js");
		writeFileSync(file, CURRENT_PI, "utf8");
		writeFileSync(file, stripBuiltinModelCommand(readFileSync(file, "utf8")), "utf8");
		expect(readFileSync(file, "utf8")).not.toContain('name: "model"');
	});
});

describe("patch-builtin app.model.select redirect", () => {
	it("redirects the action to run /models, keeps neighbors", () => {
		const out = redirectModelSelectAction(MODEL_ACTION);
		expect(out).toContain('this.session.prompt("/models")');
		expect(out).not.toContain("showModelSelector()");
		expect(out).toContain("toggleToolOutputExpansion()");
		expect(out).toContain('onAction("app.model.select"');
	});

	it("is idempotent", () => {
		const once = redirectModelSelectAction(MODEL_ACTION);
		expect(redirectModelSelectAction(once)).toBe(once);
	});

	it("is a no-op when the action is absent", () => {
		const clean = `        this.defaultEditor.onAction("app.tools.expand", () => this.x());\n`;
		expect(redirectModelSelectAction(clean)).toBe(clean);
	});
});

const BUNDLED =
	'var BUILTIN_SLASH_COMMANDS=[{name:"settings",description:"Open settings menu"},{name:"model",description:"Select model (opens selector UI)",argumentHint:"<provider/model>"},{name:"scoped-models",description:"Enable/disable models for Ctrl+P cycling"},{name:"tree",description:"Navigate session tree"}];';

const BUNDLED_ACTION =
	'this.defaultEditor.onAction("app.model.select",()=>this.showModelSelector()),this.defaultEditor.onAction("app.tools.expand",()=>this.toggleToolOutputExpansion())';

const BUNDLED_INTERCEPT =
	'if(text==="/model"||text.startsWith("/model ")){let searchTerm=text.startsWith("/model ")?text.slice(7).trim():void 0;this.editor.setText(""),await this.handleModelCommand(searchTerm);return}';

const PRETTY_INTERCEPT = `            if (text === "/model" || text.startsWith("/model ")) {
                const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
                this.editor.setText("");
                await this.handleModelCommand(searchTerm);
                return;
            }
`;

describe("patch-builtin minified bundle (live pi bin)", () => {
	it('strips {name:"model"} without touching scoped-models', () => {
		const out = stripBuiltinModelCommand(BUNDLED);
		expect(out).not.toContain('name:"model"');
		expect(out).toContain('name:"scoped-models"');
		expect(out).toContain('name:"settings"');
		expect(out).toContain('name:"tree"');
	});

	it("redirects minified app.model.select without requiring a semicolon", () => {
		const out = redirectModelSelectAction(BUNDLED_ACTION);
		expect(out).toContain('this.session.prompt("/models")');
		expect(out).not.toContain("showModelSelector()");
		expect(out).toContain("toggleToolOutputExpansion()");
	});

	it("redirects the /model submit intercept to /models", () => {
		const out = redirectModelCommandIntercept(BUNDLED_INTERCEPT);
		expect(out).not.toContain("this.handleModelCommand(searchTerm)");
		expect(out).toContain('this.session.prompt("/models")');
		expect(out).toContain('text==="/model"');
	});

	it("redirects the pretty /model intercept", () => {
		const out = redirectModelCommandIntercept(PRETTY_INTERCEPT);
		expect(out).not.toContain("this.handleModelCommand(searchTerm)");
		expect(out).toContain('this.session.prompt("/models")');
		expect(out).toContain("this.editor.setText");
	});

	it("does not rewrite the handleModelCommand method definition", () => {
		const def = `async handleModelCommand(searchTerm){if(!searchTerm){this.showModelSelector();return}`;
		expect(redirectModelCommandIntercept(def)).toBe(def);
	});
});
