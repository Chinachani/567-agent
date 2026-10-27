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
	it("collects a tree of delivered links and keeps the following task notice outside the artifact control", () => {
		const open = vi.fn();
		const source = "Deliverables:\n\n├─ [parser.py](./parser.py)\n├─ [main.py](./main.py)\n├─ [database.py](./database.py)\n└─ [service-worker.js](./service-worker.js) 收到后台任务完成通知。无残留异常。";
		render(<MarkdownContent {...environment} text={source} onOpenFile={open} />);
		const toggle = screen.getByRole("button", {expanded:false});
		expect(screen.getByText(/收到后台任务完成通知/).closest("button")).toBeNull();
		expect(screen.queryByRole("button", {name:"parser.py"})).toBeNull();
		fireEvent.click(toggle);
		fireEvent.click(screen.getByRole("button", {name:"parser.py"}));
		expect(open).toHaveBeenCalledWith("./parser.py");
	});

	it("keeps Markdown in the following prose and leaves mixed trees and literal examples unchanged", () => {
		const source = "**Deliverables:**\n├─ [a](./a.py)\n├─ [b](./b.py)\n├─ [c](./c.py)\n└─ [d](./d.py) **收到通知**\n后续正文和 [网站](https://example.test)。";
		const view=render(<MarkdownContent {...environment} text={source} onOpenFile={() => undefined} />);
		expect(screen.getByRole("button",{expanded:false})).toBeTruthy();
		expect(screen.getByText("收到通知").tagName).toBe("STRONG");
		expect(screen.getByText("Deliverables:").tagName).toBe("STRONG");
		expect(screen.getByRole("link",{name:"网站"}).getAttribute("href")).toBe("https://example.test");
		view.rerender(<MarkdownContent {...environment} text={"```md\n"+source+"\n```"} onOpenFile={() => undefined} />);
		expect(screen.queryByRole("button",{expanded:false})).toBeNull();
		view.rerender(<MarkdownContent {...environment} text={"├─ [file](./a.py)\n└─ [website](https://example.test)"} onOpenFile={() => undefined} />);
		expect(view.container.textContent).toContain("├─");
		expect(screen.getByRole("link",{name:"website"})).toBeTruthy();
	});

});
