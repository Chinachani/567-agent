import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { join } from "node:path";

it("targets the shipped 567-Agent.app bundle in both Applications locations", async () => {
	const source = await readFile(join(import.meta.dirname, "..", "build", "repair.applescript"), "utf8");
	assert.match(source, /Applications\/567-Agent\.app/);
	assert.match(source, /"\/Applications\/567-Agent\.app"/);
	assert.doesNotMatch(source, /Vetta\.app/);
});
