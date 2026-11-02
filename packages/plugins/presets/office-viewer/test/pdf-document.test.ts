// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it } from "vitest";

it("reads a real CJK PDF offline using the shipped map and font resources", async () => {
	const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
	const task = getDocument({
		data: Uint8Array.from(readFileSync(resolve(__dirname, "fixtures/cjk-document.pdf"))),
		cMapUrl: `${join(pdfRoot, "cmaps")}/`,
		cMapPacked: true,
		standardFontDataUrl: `${join(pdfRoot, "standard_fonts")}/`,
		useSystemFonts: false,
	});
	try {
		const pdf = await task.promise;
		expect(pdf.numPages).toBe(1);
		const page = await pdf.getPage(1);
		const content = await page.getTextContent();
		expect(
			content.items
				.filter((item) => "str" in item)
				.map((item) => item.str)
				.join(""),
		).toBe("中文预览");
	} finally {
		await task.destroy();
	}
});
