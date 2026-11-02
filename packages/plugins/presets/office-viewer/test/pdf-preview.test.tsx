import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => {
	URL.createObjectURL = () => "blob:pdf-worker-test";
	return { getDocument: vi.fn(), destroy: vi.fn(async () => {}), cancel: vi.fn() };
});
vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?raw", () => ({ default: "" }));
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: {},
	getDocument: engine.getDocument,
	RenderingCancelledException: class extends Error {},
}));
import { PdfPreview } from "../src/components/PdfPreview";

beforeEach(() => {
	engine.getDocument.mockReset();
	engine.destroy.mockClear();
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	engine.getDocument.mockReturnValue({
		destroy: engine.destroy,
		promise: Promise.resolve({
			numPages: 2,
			getPage: async () => ({
				getViewport: () => ({ width: 600, height: 800 }),
				render: () => ({ promise: Promise.resolve(), cancel: engine.cancel }),
			}),
		}),
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("previews a bytes-only PDF, draws both pages and releases the loading task", async () => {
	const bytes = new TextEncoder().encode("%PDF-test").buffer;
	const view = render(
		<PdfPreview file={{ name: "bytes.pdf", getUrl: () => "", readBytes: async () => bytes } as PluginPreviewFile} />,
	);
	await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(2));
	expect(engine.getDocument.mock.calls[0][0].data).toEqual(new Uint8Array(bytes));
	expect(engine.getDocument.mock.calls[0][0]).toMatchObject({
		cMapUrl: expect.stringContaining("/pdfjs/cmaps/"),
		standardFontDataUrl: expect.stringContaining("/pdfjs/standard_fonts/"),
		cMapPacked: true,
		useWorkerFetch: false,
	});
	expect(screen.queryByText("pdf.error")).toBeNull();
	view.unmount();
	expect(engine.destroy).toHaveBeenCalled();
});

it("reports a rejected PDF load instead of leaving a loading indicator indefinitely", async () => {
	engine.getDocument.mockReturnValue({
		destroy: engine.destroy,
		promise: Promise.reject(new Error("password or corrupt file")),
	});
	render(
		<PdfPreview
			file={{ name: "locked.pdf", getUrl: () => "https://example.invalid/locked.pdf" } as PluginPreviewFile}
		/>,
	);
	expect(await screen.findByText("pdf.error")).toBeTruthy();
});
