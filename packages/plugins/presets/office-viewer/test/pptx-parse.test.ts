import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPresentation, parseZip } from "@aiden0z/pptx-renderer";
import { expect, it } from "vitest";

it("reads a real two-slide PPTX without losing either slide's content", async () => {
	const bytes = Uint8Array.from(readFileSync(resolve(__dirname, "fixtures/two-slides.pptx")));
	const parsed = await parseZip(bytes.buffer);
	const presentation = await buildPresentation(parsed);
	expect(presentation.slides).toHaveLength(2);
	expect(presentation.width).toBeGreaterThan(0);
	expect(JSON.stringify(presentation.slides[0])).toContain("First slide sample");
	expect(JSON.stringify(presentation.slides[1])).toContain("Second slide sample");
});
