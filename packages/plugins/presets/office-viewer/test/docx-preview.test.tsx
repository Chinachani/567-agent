import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { DocxPreview } from "../src/components/DocxPreview";

vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function bytes(name: string): ArrayBuffer {
	const buffer = readFileSync(resolve(__dirname, "fixtures", name));
	return Uint8Array.from(buffer).buffer;
}
function file(name: string, readBytes = async () => bytes(name)): PluginPreviewFile {
	return { name, extension: "docx", getUrl: () => "", readBytes } as PluginPreviewFile;
}
beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("opens real DOCX paragraphs, formatting and merged tables, then switches documents", async () => {
	const view = render(<DocxPreview file={file("formatted-document.docx")} />);
	const text = await screen.findByText("Document preview sample");
	expect((text as HTMLElement).style.fontWeight).toBe("bold");
	expect(screen.getByText("Merged document table").closest("td")?.colSpan).toBe(2);
	expect(screen.getByText("Data remains readable")).toBeTruthy();
	view.rerender(<DocxPreview file={file("second-document.docx")} />);
	await screen.findByText("Second document selected");
	expect(screen.queryByText("Document preview sample")).toBeNull();
});

it("shows a readable failure for a damaged DOCX instead of remaining blank", async () => {
	render(<DocxPreview file={file("broken.docx", async () => new TextEncoder().encode("broken").buffer)} />);
	expect(await screen.findByText("docx.error")).toBeTruthy();
});
