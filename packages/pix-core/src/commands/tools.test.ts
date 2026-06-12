/**
 * Smoke tests for the command extensions merged from pix-tools.
 * Each default export must be a registrable (pi) => void function.
 */

import { describe, expect, it } from "bun:test";

describe("merged pix-tools commands", () => {
	for (const name of ["diff"]) {
		it(`${name} exports a register function`, async () => {
			const mod = await import(`./${name}/${name}.ts`);
			expect(mod.default).toBeFunction();
		});
	}
});
