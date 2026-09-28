import { describe, expect, it } from "vitest";
import { prepareInputPrompt } from "./prepare";

describe("prepareInputPrompt newline handling", () => {
	it("normalizes CRLF to LF and preserves newlines", () => {
		const raw = "First line\r\nSecond line\r\nThird line";
		const prepared = prepareInputPrompt(raw);
		expect(prepared.text).toBe("First line\nSecond line\nThird line");
		expect(prepared.segments).toEqual([{ kind: "text", text: "First line\nSecond line\nThird line" }]);
	});

	it("preserves multiple newlines without collapsing into spaces", () => {
		const raw = "Paragraph 1\n\nParagraph 2";
		const prepared = prepareInputPrompt(raw);
		expect(prepared.text).toBe("Paragraph 1\n\nParagraph 2");
	});
});
