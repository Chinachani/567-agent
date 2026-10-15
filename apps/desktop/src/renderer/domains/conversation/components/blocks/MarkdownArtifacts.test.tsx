// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const environment = { theme: "dark" as const, labels: { copy: "Copy", copied: "Copied" }, getFileIconClass: () => "", onOpenUrl: () => undefined };
const files = (count: number) => Array.from({ length: count }, (_, i) => `- [file ${i}](/output/image-${i}.jpg)`).join("\n");
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());
describe("file artifacts in assistant Markdown", () => {
	it("collapses a long file list, opens the original file and collapses again", () => {
		const open = vi.fn();
		render(<MarkdownContent {...environment} text={`Artifacts:\n\n${files(15)}`} onOpenFile={open} />);
		expect(screen.queryByRole("button", { name: "image-14.jpg" })).toBeNull();
		const toggle = screen.getByRole("button", { expanded: false });
		fireEvent.click(toggle);
		fireEvent.click(screen.getByRole("button", { name: "image-14.jpg" }));
		expect(open).toHaveBeenCalledWith("/output/image-14.jpg");
		fireEvent.click(toggle);
		expect(screen.queryByRole("button", { name: "image-14.jpg" })).toBeNull();
	});
	it("keeps three files immediately accessible and ordinary or mixed lists intact", () => {
		const view = render(<MarkdownContent {...environment} text={files(3)} onOpenFile={() => undefined} />);
		expect(screen.getAllByRole("button")).toHaveLength(3);
		view.rerender(<MarkdownContent {...environment} text={"- [file](/x.jpg) with explanation\n- Do the next step\n- [website](https://example.test)"} onOpenFile={() => undefined} />);
		expect(view.container.querySelectorAll("li")).toHaveLength(3);
		expect(screen.getByText(/with explanation/)).toBeTruthy();
		expect(screen.queryByRole("button", { expanded: false })).toBeNull();
	});
	it("does not turn code examples or table cells into artifact groups", () => {
		const source = `\`\`\`md\n${files(4)}\n\`\`\`\n\n| File | Meaning |\n|---|---|\n| [one](/x.jpg) | important |`;
		const view = render(<MarkdownContent {...environment} text={source} onOpenFile={() => undefined} />);
		expect(view.container.querySelector("table")).toBeTruthy();
		expect(screen.queryByRole("button", { expanded: false })).toBeNull();
	});
});
