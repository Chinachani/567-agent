import { describe, expect, it } from "vitest";
import { parseStyleKitCatalog } from "../src/design-systems/stylekit-catalog";

const style = {
	slug: "editorial",
	name: "编辑杂志风",
	nameEn: "Editorial",
	description: "暖米色背景与杂志排版。",
	descriptionEn: "Warm editorial typography and spacing.",
	styleType: "visual",
	category: "minimal",
	keywords: ["杂志排版", "留白"],
	colors: { primary: "#1C1C1C", secondary: "#F9F8F6", accent: ["#816d70"] },
};

describe("parseStyleKitCatalog", () => {
	it("adapts StyleKit records into attributed Vetta design systems", () => {
		const [system] = parseStyleKitCatalog({ total: 1, styles: [style] }) ?? [];
		expect(system).toMatchObject({
			id: "stylekit-editorial",
			name: "编辑杂志风 · StyleKit",
			category: "editorial",
			vibe: "light",
			source: "https://github.com/AnxForever/stylekit",
			license: "MIT",
		});
		expect(system.themeCss).toContain("--color-primary: #1C1C1C");
		expect(system.designMd).toContain("暖米色背景与杂志排版");
	});

	it("rejects malformed catalogs, unsafe slugs, and invalid colors", () => {
		expect(parseStyleKitCatalog({ styles: [] })).toBeNull();
		expect(parseStyleKitCatalog({ styles: [{ ...style, slug: "../escape" }] })).toBeNull();
		expect(parseStyleKitCatalog({ styles: [{ ...style, colors: { ...style.colors, primary: "#12345" } }] })).toBeNull();
	});
});
