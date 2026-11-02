import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ build: vi.fn(), failSlide: false }));
vi.mock("@vetta-org/plugin-sdk", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@aiden0z/pptx-renderer", () => ({
	parseZip: async () => ({}),
	buildPresentation: engine.build,
	PptxViewer: class {
		load() {}
		destroy() {}
		renderSlideToContainer(index: number, stage: HTMLElement) {
			if (index === 1 && engine.failSlide) {
				engine.failSlide = false;
				throw new Error("unavailable slide");
			}
			stage.textContent = `Slide ${index + 1}`;
			return { ready: Promise.resolve(), dispose() {} };
		}
		renderThumbnailToContainer() {
			return { ready: Promise.resolve(), dispose() {} };
		}
	},
}));
import { PptxPreview } from "../src/components/PptxPreview";
beforeEach(() => {
	engine.build.mockReset();
	engine.failSlide = false;
	engine.build.mockResolvedValue({ slides: [{}, {}], width: 960, height: 540 });
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function file(): PluginPreviewFile {
	return { name: "slides.pptx", getUrl: () => "", readBytes: async () => new ArrayBuffer(0) } as PluginPreviewFile;
}

it("reports an empty presentation instead of showing a blank preview", async () => {
	engine.build.mockResolvedValue({ slides: [], width: 960, height: 540 });
	render(<PptxPreview file={file()} />);
	expect(await screen.findByText("pptx.error: pptx.empty")).toBeTruthy();
});

it("allows retrying the same slide after an individual rendering failure", async () => {
	const user = userEvent.setup();
	render(<PptxPreview file={file()} />);
	await screen.findByText("Slide 1");
	engine.failSlide = true;
	await user.click(screen.getAllByRole("button", { name: "pptx.slideLabel" })[1]);
	expect(await screen.findByRole("alert")).toBeTruthy();
	await user.click(screen.getAllByRole("button", { name: "pptx.slideLabel" })[1]);
	expect(await screen.findByText("Slide 2")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});
