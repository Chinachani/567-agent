import { act, cleanup, render, screen } from "@testing-library/react";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("docx-preview", () => ({ renderAsync: engine.render }));
import { DocxPreview } from "../src/components/DocxPreview";
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
	engine.render.mockReset();
	vi.unstubAllGlobals();
});
function file(name: string): PluginPreviewFile {
	return { name, getUrl: () => "", readBytes: async () => new ArrayBuffer(0) } as PluginPreviewFile;
}

it("keeps a late third-party parser from mutating the newly selected document", async () => {
	const finishes: Array<() => void> = [];
	engine.render.mockImplementation(
		(_bytes: ArrayBuffer, container: HTMLElement) =>
			new Promise<void>((resolve) => {
				const index = finishes.length;
				finishes.push(() => {
					container.innerHTML = `<section class="docx">Document ${index}</section>`;
					resolve();
				});
			}),
	);
	const view = render(<DocxPreview file={file("old.docx")} />);
	await act(async () => {});
	expect(finishes).toHaveLength(1);
	view.rerender(<DocxPreview file={file("new.docx")} />);
	await act(async () => {});
	expect(finishes).toHaveLength(2);
	await act(async () => {
		finishes[1]();
	});
	expect(screen.getByText("Document 1")).toBeTruthy();
	await act(async () => {
		finishes[0]();
	});
	expect(screen.queryByText("Document 0")).toBeNull();
	expect(screen.getByText("Document 1")).toBeTruthy();
});

it("reports a renderer that finishes without producing any document pages", async () => {
	engine.render.mockResolvedValue(undefined);
	render(<DocxPreview file={file("unsupported.docx")} />);
	expect(await screen.findByText("docx.error")).toBeTruthy();
});
