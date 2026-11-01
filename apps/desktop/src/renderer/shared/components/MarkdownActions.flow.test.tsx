// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("copies a rendered table as TSV, acknowledges success for 1.5s and does not acknowledge failure", async () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	const writeText = vi.fn(async () => {});
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
	render(
		<MarkdownContent
			text={"| Name | Value |\n| --- | --- |\n| 测试 | 42 |"}
			theme="dark"
			labels={{ copy: "Copy", copyTable: "Copy table", copied: "Copied" }}
			getFileIconClass={() => ""}
			onOpenFile={() => {}}
			onOpenUrl={() => {}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Copy table" }));
	await screen.findByRole("button", { name: "Copied" });
	expect(writeText).toHaveBeenCalledWith("Name\tValue\n测试\t42");
	cleanup();
	vi.useFakeTimers();
	const { MarkdownTable } = await import("@vetta-org/theme-ui/shared");
	render(
		<MarkdownTable labels={{ copy: "Copy table", copied: "Copied" }}>
			<tbody>
				<tr>
					<td>Exact cell</td>
				</tr>
			</tbody>
		</MarkdownTable>,
	);
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Copy table" }));
	});
	expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
	act(() => vi.advanceTimersByTime(1500));
	writeText.mockRejectedValueOnce(new Error("denied"));
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Copy table" }));
	});
	expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});

it("offers source preview and save only after code generation finishes, preserving source literally", async () => {
	const previewCode = vi.fn();
	const saveCode = vi.fn(async () => {});
	const { createMarkdownHostFixture } = await import(
		"../../domains/conversation/components/blocks/markdown-host.fixture"
	);
	const { host } = createMarkdownHostFixture();
	const source = "const value = `user text`;";
	const props = {
		text: `\`\`\`typescript\n${source}\n\`\`\``,
		theme: "dark" as const,
		labels: { copy: "Copy", copied: "Copied" },
		getFileIconClass: () => "",
		onOpenFile: () => {},
		onOpenUrl: () => {},
		host: { ...host, previewCode, saveCode },
	};
	const view = render(<MarkdownContent {...props} isStreamingTail />);
	expect(screen.queryByRole("button", { name: "Save as file" })).toBeNull();
	view.rerender(<MarkdownContent {...props} />);
	fireEvent.click(await screen.findByRole("button", { name: "Preview to the side" }, { timeout: 5000 }));
	fireEvent.click(screen.getByRole("button", { name: "Save as file" }));
	await waitFor(() => expect(saveCode).toHaveBeenCalledWith(source, "typescript"));
	expect(previewCode).toHaveBeenCalledWith(source, "typescript");
});

it("renders in-memory HTML as source without fetching, launching scripts or invoking file readers", async () => {
	const { PreviewBody } = await import("../../domains/file-preview/components/PreviewContent");
	const source = '<script>window.secret = "never executed";</script>';
	const view = render(<PreviewBody item={{ name: "code.html", text: source }} />);
	await waitFor(() => expect(view.container.textContent).toContain(source));
	expect(view.container.querySelector("iframe")).toBeNull();
});
